// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "./interfaces/IRegistry.sol";
import "./interfaces/IStrategyProviderWallet.sol";
import "./interfaces/IUniswapAddressHolder.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

contract StrategyProviderWallet is IStrategyProviderWallet {
    using SafeERC20 for IERC20;

    address public immutable owner;
    IRegistry public immutable registry;
    IUniswapAddressHolder public immutable uniswapAddressHolder;

    bytes16[] public strategyIds;
    mapping(bytes16 => StrategyInfo) public strategyIdToStrategyInfo;
    mapping(bytes16 => bool) public isStrategyExist;
    mapping(address => bool) public isReceivedTokenExist;
    address[] private receivedTokens;

    ///@notice emitted when a strategy is added to the wallet
    event StrategyAdded(
        address indexed from,
        bytes16 strategyId,
        address token0,
        address token1,
        uint24 fee,
        uint256 performanceFeeRatio,
        address recievedToken,
        uint32 licenseAmount
    );

    ///@notice emitted when a strategy is updated
    event StrategyUpdated(
        address indexed from,
        bytes16 strategyId,
        address pool,
        uint256 performanceFeeRatio,
        address recievedToken,
        uint32 licenseAmount
    );

    ///@notice emitted when token collected
    event Collect(address token, uint256 amount, address recipient);

    modifier onlyOwner() {
        require(msg.sender == owner, "SPWOO");
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == registry.governance(), "SPWOG");
        _;
    }

    //XXX: seems not used?
    modifier onlyFactory() {
        require(msg.sender == registry.strategyProviderWalletFactoryAddress(), "SPWOF");
        _;
    }

    modifier strategyNotExist(bytes16 strategyId) {
        require(!isStrategyExist[strategyId], "SPWSE");
        _;
    }

    constructor(address _owner, address _registry, address _uniswapAddressHolder) {
        owner = _owner;
        registry = IRegistry(_registry);
        uniswapAddressHolder = IUniswapAddressHolder(_uniswapAddressHolder);
    }

    ///@notice addStrategy adds a strategy to the wallet
    ///@param strategyId the id of the strategy
    ///@param token0 the first token of the pool
    ///@param token1 the second token of the pool
    ///@param fee the fee of the pool
    ///@param performanceFeeRatio the performance fee ratio of the strategy
    ///@param receivedToken the token that will be received from the strategy
    ///@param licenseAmount the amount of license of listing strategy
    function addStrategy(
        bytes16 strategyId,
        address token0,
        address token1,
        uint24 fee,
        uint24 performanceFeeRatio,
        address receivedToken, // if set 0x0 means received tokens are avaliable in both token0 and token1
        uint32 licenseAmount
    ) external onlyOwner strategyNotExist(strategyId) {
        //reorder
        (token0, token1) = token0 < token1 ? (token0, token1) : (token1, token0);

        address pool = IUniswapV3Factory(uniswapAddressHolder.uniswapV3FactoryAddress()).getPool(token0, token1, fee);
        require(pool != address(0), "SPWAP0");

        checkPerformanceFeeRatio(performanceFeeRatio);
        checkLicenseAmount(licenseAmount);

        addReceivedTokens(token0, token1, receivedToken);

        //XXX: what's the purpose of strategyIds?
        strategyIds.push(strategyId);
        isStrategyExist[strategyId] = true;
        strategyIdToStrategyInfo[strategyId] = StrategyInfo({
            pool: pool,
            performanceFeeRatio: performanceFeeRatio,
            receivedToken: receivedToken,
            licenseAmount: licenseAmount
        });

        emit StrategyAdded(
            msg.sender,
            strategyId,
            token0,
            token1,
            fee,
            performanceFeeRatio,
            receivedToken,
            licenseAmount
        );
    }

    function checkPerformanceFeeRatio(uint24 performanceFeeRatio) internal pure {
        require(performanceFeeRatio <= 10_000, "SPWPFR");
    }

    function checkLicenseAmount(uint32 licenseAmount) internal pure {
        require(licenseAmount > 0, "SPWLA");
    }

    function addReceivedTokens(address token0, address token1, address receivedToken) internal {
        require(receivedToken == token0 || receivedToken == token1 || receivedToken == address(0), "SPWART");

        if (receivedToken == address(0)) {
            if (!isReceivedTokenExist[token0]) {
                receivedTokens.push(token0);
                isReceivedTokenExist[token0] = true;
            }
            if (!isReceivedTokenExist[token1]) {
                receivedTokens.push(token1);
                isReceivedTokenExist[token1] = true;
            }
        } else {
            if (!isReceivedTokenExist[receivedToken]) {
                receivedTokens.push(receivedToken);
                isReceivedTokenExist[receivedToken] = true;
            }
        }
    }

    function updateStrategyReceivedToken(bytes16 strategyId, address receivedToken) external onlyOwner {
        //XXX: check receivedToken is valid?
        address pool = strategyIdToStrategyInfo[strategyId].pool;
        require(pool != address(0), "SPWNS");
        address token0 = IUniswapV3Pool(pool).token0();
        address token1 = IUniswapV3Pool(pool).token1();
        addReceivedTokens(token0, token1, receivedToken);

        strategyIdToStrategyInfo[strategyId].receivedToken = receivedToken;

        emit StrategyUpdated(
            msg.sender,
            strategyId,
            pool,
            strategyIdToStrategyInfo[strategyId].performanceFeeRatio,
            strategyIdToStrategyInfo[strategyId].receivedToken,
            strategyIdToStrategyInfo[strategyId].licenseAmount
        );
    }

    function getStrategyInfo(bytes16 _strategyId) external view override returns (StrategyInfo memory) {
        return strategyIdToStrategyInfo[_strategyId];
    }

    function collectFromStrategy(bytes16 strategyId, address recipient) external onlyOwner {
        StrategyInfo memory info = strategyIdToStrategyInfo[strategyId];
        require(info.pool != address(0), "SPWNS");
        if (info.receivedToken == address(0)) {
            _collect(
                IUniswapV3Pool(info.pool).token0(),
                IERC20(IUniswapV3Pool(info.pool).token0()).balanceOf(address(this)),
                recipient
            );
            _collect(
                IUniswapV3Pool(info.pool).token1(),
                IERC20(IUniswapV3Pool(info.pool).token1()).balanceOf(address(this)),
                recipient
            );
        } else {
            _collect(info.receivedToken, IERC20(info.receivedToken).balanceOf(address(this)), recipient);
        }
    }

    function collectFromToken(address token, uint256 amount, address recipient) external onlyOwner {
        _collect(token, amount, recipient);
    }

    function collectAll(address recipient) external onlyOwner {
        for (uint256 i = 0; i < receivedTokens.length; ++i) {
            uint256 amount = IERC20(receivedTokens[i]).balanceOf(address(this));
            if (amount == 0) {
                continue;
            }
            _collect(receivedTokens[i], amount, recipient);
        }
    }

    ///@notice get the array of received token addresses
    ///@param cursor is the aforementioned cursor. It simply indicates the starting index for enumeration. The first call should pass 0, and subsequent calls should pass the returned newCursor.
    ///@param howMany indicates how many items should be returned. If there aren’t enough remaining items in the array, the function will return fewer items.
    ///@return tokens address[] return array of received token addresses
    ///@return newCursor uint256 return the new cursor
    function getReceivedTokens(
        uint256 cursor,
        uint256 howMany
    ) external view returns (address[] memory tokens, uint256 newCursor) {
        uint256 length = howMany;
        if (length > receivedTokens.length - cursor) {
            length = receivedTokens.length - cursor;
        }

        tokens = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            tokens[i] = receivedTokens[cursor + i];
        }

        return (tokens, cursor + length);
    }

    function _collect(address token, uint256 amount, address recipient) internal {
        require(token != address(0), "SPWNR");
        require(recipient != address(0), "SPWNR");
        require(amount > 0, "SPWNA");
        IERC20(token).safeTransfer(recipient, amount);
        emit Collect(token, amount, recipient);
    }
}
