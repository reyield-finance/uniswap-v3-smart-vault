// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC721/ERC721Holder.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "./libraries/ERC20Helper.sol";
import "./libraries/ArrayHelper.sol";
import "./Storage.sol";

/**
 * @title   Position Manager
 * @notice  A vault that provides liquidity on Uniswap V3.
 * @notice  User can Deposit here its Uni-v3 position
 * @notice  If user does so, he is sure that idle liquidity will always be employed in protocols
 * @notice  User will pay fee to external keepers
 * @notice  vault works for multiple positions
 */

contract PositionManager is IPositionManager, ERC721Holder {
    using SafeMath for uint256;

    uint256 public override positionIdCounter;
    uint256[] private tokenIds;

    mapping(uint256 => PositionInfo) public positions;
    mapping(uint256 => PositionSettlement) public positionSettlement;
    mapping(uint256 => PositionStatus) public override positionStatus;
    mapping(uint256 => mapping(address => bytes32)) public positionToModuleData;

    ///@notice emitted when a ERC20 is withdrawn
    ///@param tokenAddress address of the ERC20
    ///@param to address of the user
    ///@param amount of the ERC20
    event ERC20Withdrawn(address tokenAddress, address to, uint256 amount);

    ///@notice emitted when a position is created
    ///@param from address of the caller
    ///@param positionId ID of the position
    ///@param tokenId ID of the NFT
    ///@param strategyProvider address of the strategy provider
    ///@param strategyId ID of the strategy
    ///@param token0Deposited amount of token0 deposited
    ///@param token1Deposited amount of token1 deposited
    ///@param amount0Leftover amount of token0 leftover after increase liquidity
    ///@param amount1Leftover amount of token1 leftover after increase liquidity
    ///@param tickLowerDiff difference between the current tick and the tickLower
    ///@param tickUpperDiff difference between the current tick and the tickUpper
    event PositionCreated(
        address indexed from,
        uint256 indexed positionId,
        uint256 tokenId,
        address strategyProvider,
        bytes16 strategyId,
        uint256 token0Deposited,
        uint256 token1Deposited,
        uint256 amount0Leftover,
        uint256 amount1Leftover,
        int24 tickLowerDiff,
        int24 tickUpperDiff
    );

    ///@notice emitted when a position is closed
    ///@param from address of the caller
    ///@param positionId ID of the position
    event PositionClosed(address indexed from, uint256 indexed positionId);

    ///@notice emitted when a position is rebalanced
    ///@param from address of the caller
    ///@param positionId ID of the position
    ///@param newTokenId ID of the new NFT
    ///@param tickLowerDiffAfterRebalanced difference between the current tick and the tickLower after rebalanced
    ///@param tickUpperDiffAfterRebalanced difference between the current tick and the tickUpper after rebalanced
    ///@param amount0CollectedFeeAfterRebalanced amount of token0 total collected fee after rebalanced
    ///@param amount1CollectedFeeAfterRebalanced amount of token1 total collected fee after rebalanced
    ///@param amount0LeftoverAfterRebalanced amount of token0 leftover after rebalanced
    ///@param amount1LeftoverAfterRebalanced amount of token1 leftover after rebalanced
    event PositionRebalanced(
        address indexed from,
        uint256 indexed positionId,
        uint256 newTokenId,
        int24 tickLowerDiffAfterRebalanced,
        int24 tickUpperDiffAfterRebalanced,
        uint256 amount0CollectedFeeAfterRebalanced,
        uint256 amount1CollectedFeeAfterRebalanced,
        uint256 amount0LeftoverAfterRebalanced,
        uint256 amount1LeftoverAfterRebalanced
    );

    ///@notice emitted when a position is increased liquidity
    ///@param from address of the caller
    ///@param positionId ID of the position
    ///@param token0DepositedAfterIncreased amount of token0 deposited after increase liquidity
    ///@param token1DepositedAfterIncreased amount of token1 deposited after increase liquidity
    ///@param amount0LeftoverAfterIncreased amount of token0 leftover after increase liquidity
    ///@param amount1LeftoverAfterIncreased amount of token1 leftover after increase liquidity
    event PositionIncreasedLiquidity(
        address indexed from,
        uint256 indexed positionId,
        uint256 token0DepositedAfterIncreased,
        uint256 token1DepositedAfterIncreased,
        uint256 amount0LeftoverAfterIncreased,
        uint256 amount1LeftoverAfterIncreased
    );

    ///@notice modifier to check if the msg.sender is the owner
    modifier onlyOwner() {
        require(msg.sender == PositionManagerStorage.getStorage().owner, "PMOO");
        _;
    }

    ///@notice modifier to check if the msg.sender is the governance
    modifier onlyGovernance() {
        require(msg.sender == registry().governance(), "PMOG");
        _;
    }

    ///@notice modifier to check if the msg.sender is whitelisted
    modifier onlyWhitelisted() {
        require(registry().activeModule(msg.sender) || msg.sender == address(this), "PMOW");
        _;
    }

    ///@notice modifier to check if the msg.sender is the PositionManagerFactory
    modifier onlyFactory() {
        require(registry().positionManagerFactoryAddress() == msg.sender, "PMOF");
        _;
    }

    ///@notice modifier to check if the position is owned by the positionManager
    modifier onlyOwnedPosition(uint256 tokenId) {
        require(
            INonfungiblePositionManager(
                PositionManagerStorage.getStorage().uniswapAddressHolder.nonfungiblePositionManagerAddress()
            ).ownerOf(tokenId) == address(this),
            "PMOOP"
        );
        _;
    }

    ///@notice modifier to check if the position is running
    modifier positionRunning(uint256 positionId) {
        require(_isPositionRunning(positionId), "PMPR");
        _;
    }

    constructor(
        address _owner,
        address _registryAddressHolder,
        address _uniswapAddressHolder,
        address _diamondCutFacet
    ) payable {
        PositionManagerStorage.setContractOwner(_owner);

        // Add the diamondCut external function from the diamondCutFacet
        IDiamondCut.FacetCut[] memory cut = new IDiamondCut.FacetCut[](1);
        bytes4[] memory functionSelectors = new bytes4[](1);
        functionSelectors[0] = IDiamondCut.diamondCut.selector;
        cut[0] = IDiamondCut.FacetCut({
            facetAddress: _diamondCutFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: functionSelectors
        });
        PositionManagerStorage.diamondCut(cut, address(0), "");
        StorageStruct storage Storage = PositionManagerStorage.getStorage();
        Storage.registryAddressHolder = IRegistryAddressHolder(_registryAddressHolder);
        Storage.uniswapAddressHolder = IUniswapAddressHolder(_uniswapAddressHolder);
    }

    ///@notice get IRegistry from registryAddressHolder
    ///@return IRegistry interface of registry
    function registry() private view returns (IRegistry) {
        return IRegistry(PositionManagerStorage.getStorage().registryAddressHolder.registry());
    }

    ///@notice generate position ID
    ///@return positionId ID of the position
    function _genPositionId() internal returns (uint256) {
        return ++positionIdCounter;
    }

    ///@notice create position
    ///@param inputs struct containing position info
    ///@return positionId ID of the position
    function createPosition(
        IPositionManager.CreatePositionInput calldata inputs
    ) external override onlyWhitelisted returns (uint256 positionId) {
        positionId = _genPositionId();
        positionStatus[positionId] = PositionStatus.Running;
        positions[positionId] = PositionInfo({
            tokenId: inputs.tokenId,
            strategyProvider: inputs.strategyProvider,
            strategyId: inputs.strategyId,
            amount0Deposited: inputs.amount0Deposited,
            amount1Deposited: inputs.amount1Deposited,
            amount0DepositedUsdValue: inputs.amount0DepositedUsdValue,
            amount1DepositedUsdValue: inputs.amount1DepositedUsdValue,
            amount0CollectedFee: 0,
            amount1CollectedFee: 0,
            amount0Leftover: inputs.amount0Leftover,
            amount1Leftover: inputs.amount1Leftover,
            tickLowerDiff: inputs.tickLowerDiff,
            tickUpperDiff: inputs.tickUpperDiff
        });

        _pushTokenId(inputs.tokenId);
        _setDefaultDataOfPosition(positionId);

        emit PositionCreated(
            msg.sender,
            positionId,
            inputs.tokenId,
            inputs.strategyProvider,
            inputs.strategyId,
            inputs.amount0Deposited,
            inputs.amount1Deposited,
            inputs.amount0Leftover,
            inputs.amount1Leftover,
            inputs.tickLowerDiff,
            inputs.tickUpperDiff
        );
    }

    ///@notice update position total deposit USD value
    ///@param positionId ID of the position
    ///@param amount0Deposited The amount of token0 deposited
    ///@param amount1Deposited The amount of token1 deposited
    ///@param amount0DepositedUsdValue The amount of token0 deposited in USD
    ///@param amount1DepositedUsdValue The amount of token1 deposited in USD
    ///@param amount0Leftover The amount of token0 leftover after increasing liquidity
    ///@param amount1Leftover The amount of token1 leftover after increasing liquidity
    function middlewareIncreaseLiquidity(
        uint256 positionId,
        uint256 amount0Deposited,
        uint256 amount1Deposited,
        uint256 amount0DepositedUsdValue,
        uint256 amount1DepositedUsdValue,
        uint256 amount0Leftover,
        uint256 amount1Leftover
    ) external override onlyWhitelisted positionRunning(positionId) {
        positions[positionId].amount0Deposited = amount0Deposited;
        positions[positionId].amount1Deposited = amount1Deposited;
        positions[positionId].amount0DepositedUsdValue = amount0DepositedUsdValue;
        positions[positionId].amount1DepositedUsdValue = amount1DepositedUsdValue;
        positions[positionId].amount0Leftover = amount0Leftover;
        positions[positionId].amount1Leftover = amount1Leftover;

        emit PositionIncreasedLiquidity(
            msg.sender,
            positionId,
            amount0Deposited,
            amount1Deposited,
            amount0Leftover,
            amount1Leftover
        );
    }

    ///@notice get position info from tokenId
    ///@param tokenId ID of the position
    ///@return positionId
    function getPositionIdFromTokenId(uint256 tokenId) external view override returns (uint256) {
        for (uint256 i = 1; i <= positionIdCounter; ++i) {
            uint256 positionId = i;
            if (positions[positionId].tokenId == tokenId) {
                return positionId;
            }
        }
        revert("PMGP");
    }

    ///@notice get position info from positionId
    ///@param positionId ID of the position
    ///@return positionInfo PositionInfo struct
    function getPositionInfo(uint256 positionId) external view override returns (PositionInfo memory positionInfo) {
        positionInfo = positions[positionId];
        require(positionInfo.tokenId != 0 && positionStatus[positionId] != PositionStatus.Initial, "PMGP");
    }

    ///@notice get position settlement info from positionId
    ///@param positionId ID of the position
    ///@return positionSettlementInfo PositionSettlement struct
    function getPositionSettlement(
        uint256 positionId
    ) external view override returns (PositionSettlement memory positionSettlementInfo) {
        positionSettlementInfo = positionSettlement[positionId];
    }

    ///@notice check if the position is running
    ///@param positionId ID of the position
    ///@return bool true if the position is running
    function isPositionRunning(uint256 positionId) external view override returns (bool) {
        return _isPositionRunning(positionId);
    }

    ///@notice middleware function to update position info for rebalance
    ///@param positionId ID of the position
    ///@param newTokenId ID of the new NFT
    ///@param tickLowerDiff The difference between the current tick and the tickLower
    ///@param tickUpperDiff The difference between the current tick and the tickUpper
    ///@param amount0CollectedFee The amount of token0 collected fee after rebalance
    ///@param amount1CollectedFee The amount of token1 collected fee after rebalance
    function middlewareRebalance(
        uint256 positionId,
        uint256 newTokenId,
        int24 tickLowerDiff,
        int24 tickUpperDiff,
        uint256 amount0CollectedFee,
        uint256 amount1CollectedFee,
        uint256 amount0Leftover,
        uint256 amount1Leftover
    ) external override onlyWhitelisted positionRunning(positionId) {
        positions[positionId].tokenId = newTokenId;
        positions[positionId].tickLowerDiff = tickLowerDiff;
        positions[positionId].tickUpperDiff = tickUpperDiff;
        positions[positionId].amount0CollectedFee = amount0CollectedFee;
        positions[positionId].amount1CollectedFee = amount1CollectedFee;
        positions[positionId].amount0Leftover = amount0Leftover;
        positions[positionId].amount1Leftover = amount1Leftover;

        _pushTokenId(newTokenId);

        emit PositionRebalanced(
            msg.sender,
            positionId,
            newTokenId,
            tickLowerDiff,
            tickUpperDiff,
            amount0CollectedFee,
            amount1CollectedFee,
            amount0Leftover,
            amount1Leftover
        );
    }

    ///@notice middleware function to update position info for withdraw
    ///@param input MiddlewareWithdrawInput struct
    function middlewareWithdraw(MiddlewareWithdrawInput memory input) external override onlyWhitelisted {
        positionStatus[input.positionId] = PositionStatus.Closed;

        positions[input.positionId].amount0CollectedFee = input.amount0CollectedFee;
        positions[input.positionId].amount1CollectedFee = input.amount1CollectedFee;
        positions[input.positionId].amount0Leftover = 0;
        positions[input.positionId].amount1Leftover = 0;

        positionSettlement[input.positionId] = PositionSettlement({
            amount0Returned: input.amount0Returned,
            amount1Returned: input.amount1Returned,
            amount0ReturnedUsdValue: input.amount0ReturnedUsdValue,
            amount1ReturnedUsdValue: input.amount1ReturnedUsdValue
        });
        emit PositionClosed(msg.sender, input.positionId);
    }

    ///@notice add tokenId in the uniswapNFTs array
    ///@param tokenId ID of the added NFT
    function _pushTokenId(uint256 tokenId) internal onlyOwnedPosition(tokenId) {
        tokenIds.push(tokenId);
    }

    ///@notice get the IDs of uniswap NFTs
    ///@param cursor is the aforementioned cursor. It simply indicates the starting index for enumeration. The first call should pass 0, and subsequent calls should pass the returned newCursor.
    ///@param howMany indicates how many items should be returned. If there aren’t enough remaining items in the array, the function will return fewer items.
    ///@return nfts uint256[] return array of uniswap nft tokenId
    ///@return newCursor uint256 return the new cursor
    function getUniswapNFTs(
        uint256 cursor,
        uint256 howMany
    ) public view returns (uint256[] memory nfts, uint256 newCursor) {
        return ArrayHelper.sliceUint256(tokenIds, cursor, howMany);
    }

    ///@notice return the length of the uniswap NFTs array
    ///@return length of the array
    function getUniswapNFTsLength() external view returns (uint256) {
        return tokenIds.length;
    }

    ///@notice set default data for every module
    ///@param positionId ID of the position
    function _setDefaultDataOfPosition(uint256 positionId) internal {
        bytes32[] memory moduleKeys = registry().getModuleKeys();

        uint256 moduleKeysLength = moduleKeys.length;
        for (uint256 i; i < moduleKeysLength; ++i) {
            IRegistry.Entry memory entry = registry().getModuleInfo(moduleKeys[i]);
            positionToModuleData[positionId][entry.contractAddress] = entry.defaultData;
        }
    }

    ///@notice sets the data of a module of position
    ///@param positionId ID of the position
    ///@param moduleAddress address of the module
    ///@param data data for the module
    function setModuleData(uint256 positionId, address moduleAddress, bytes32 data) external override onlyWhitelisted {
        positionToModuleData[positionId][moduleAddress] = data;
    }

    ///@notice get data for a module of position
    ///@param _positionId ID of the position
    ///@param _moduleAddress address of the module
    ///@return data of the module
    function getPositionModuleData(
        uint256 _positionId,
        address _moduleAddress
    ) public view override returns (bytes32 data) {
        return (positionToModuleData[_positionId][_moduleAddress]);
    }

    ///@notice return the address of this position manager owner
    ///@return address of the owner
    function getOwner() external view override returns (address) {
        return PositionManagerStorage.getStorage().owner;
    }

    ///@notice transfer ERC20 tokens stuck in Position Manager to owner
    ///@param tokenAddress address of the token to be withdrawn
    function withdrawERC20ToOwner(address tokenAddress, uint256 amount) external onlyGovernance {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();
        address owner = Storage.owner;
        uint256 got = ERC20Helper.withdrawTokens(tokenAddress, owner, amount);
        emit ERC20Withdrawn(tokenAddress, owner, got);
    }

    function _isPositionRunning(uint256 positionId) internal view returns (bool) {
        return positionStatus[positionId] == PositionStatus.Running;
    }

    fallback() external payable onlyWhitelisted {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();

        address facet = Storage.selectorToFacetAndPosition[msg.sig].facetAddress;
        require(facet != address(0), "PM");

        ///@dev Execute external function from facet using delegatecall and return any value.
        assembly {
            // copy function selector and any arguments
            calldatacopy(0, 0, calldatasize())
            // execute function call using the facet
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            // get any return value
            returndatacopy(0, 0, returndatasize())
            // return any return value or error back to the caller
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    receive() external payable {}
}
