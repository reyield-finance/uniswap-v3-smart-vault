// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "./PositionManager.sol";
import "./interfaces/IPositionManagerFactory.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IStrategyProviderWalletFactory.sol";
import "./interfaces/IRegistry.sol";
import "./libraries/ArrayHelper.sol";

contract PositionManagerFactory is Pausable, IPositionManagerFactory {
    using SafeMath for uint256;

    address public immutable registryAddressHolder;
    address public immutable diamondCutFacet;
    address public immutable uniswapAddressHolder;
    address[] public positionManagers;
    IDiamondCut.FacetCut[] public actions;
    mapping(address => address) public override userToPositionManager;

    ///@notice emitted when a new position manager is created
    ///@param positionManager address of PositionManager
    ///@param user address of user
    event PositionManagerCreated(address indexed positionManager, address user);

    modifier onlyGovernance() {
        require(msg.sender == registry().governance(), "PFOG");
        _;
    }

    constructor(address _registryAddressHolder, address _uniswapAddressHolder, address _diamondCutFacet) Pausable() {
        require(_registryAddressHolder != address(0), "PFRAH0");
        require(_uniswapAddressHolder != address(0), "PFUAH0");
        require(_diamondCutFacet != address(0), "PFDC0");
        registryAddressHolder = _registryAddressHolder;
        uniswapAddressHolder = _uniswapAddressHolder;
        diamondCutFacet = _diamondCutFacet;
    }

    ///@notice pause the factory
    function pause() external onlyGovernance {
        _pause();
    }

    ///@notice unpause the factory
    function unpause() external onlyGovernance {
        _unpause();
    }

    ///@notice get IRegistry from registryAddressHolder
    ///@return IRegistry interface of registry
    function registry() private view returns (IRegistry) {
        return IRegistry(IRegistryAddressHolder(registryAddressHolder).registry());
    }

    ///@notice update actions already existing on positionManager
    ///@dev Add (0) Replace(1) Remove(2)
    ///@param positionManager address of the position manager on which one should modified an action
    ///@param actionsToUpdate contains the facet addresses and function selectors of the actions
    function updateDiamond(
        address positionManager,
        IDiamondCut.FacetCut[] memory actionsToUpdate
    ) external onlyGovernance {
        IDiamondCut(positionManager).diamondCut(actionsToUpdate, address(0), "");
    }

    ///@notice adds or removes an action to/from the factory
    ///@param facetAction facet of the action to add or remove from position manager factory
    function updateActionData(IDiamondCut.FacetCut calldata facetAction) external onlyGovernance {
        if (facetAction.action == IDiamondCut.FacetCutAction.Remove) {
            uint256 actionsLength = actions.length;
            for (uint256 i; i < actionsLength; ++i) {
                if (actions[i].facetAddress == facetAction.facetAddress) {
                    actions[i] = actions[actionsLength - 1];
                    actions.pop();
                    return;
                }
            }
            require(false, "PFU");
        }

        if (facetAction.action == IDiamondCut.FacetCutAction.Replace) {
            uint256 actionsLength = actions.length;
            for (uint256 i; i < actionsLength; ++i) {
                if (actions[i].facetAddress == facetAction.facetAddress) {
                    actions[i] = facetAction;
                    return;
                }
            }
            require(false, "PFU");
        }

        if (facetAction.action == IDiamondCut.FacetCutAction.Add) {
            uint256 actionsLength = actions.length;
            for (uint256 i; i < actionsLength; ++i) {
                require(actions[i].facetAddress != facetAction.facetAddress, "PFU");
            }
            actions.push(facetAction);
            return;
        }

        require(false, "PFU");
    }

    ///@notice deploy new positionManager and assign to userAddress
    ///@return address return new PositionManager address
    function create() external override whenNotPaused returns (address) {
        require(userToPositionManager[msg.sender] == address(0), "PFP");

        PositionManager manager = new PositionManager(
            msg.sender,
            registryAddressHolder,
            uniswapAddressHolder,
            diamondCutFacet
        );
        positionManagers.push(address(manager));
        userToPositionManager[msg.sender] = address(manager);

        IDiamondCut(address(manager)).diamondCut(actions, address(0), "");

        ///@dev create strategy provider wallet
        _createStrategyProviderWallet(msg.sender);

        emit PositionManagerCreated(address(manager), msg.sender);

        return address(manager);
    }

    ///@notice create strategy provider wallet
    function _createStrategyProviderWallet(address provider) internal {
        IStrategyProviderWalletFactory(
            IRegistry(IRegistryAddressHolder(registryAddressHolder).registry()).strategyProviderWalletFactoryAddress()
        ).create(provider);
    }

    ///@notice get the array of position manager addresses
    ///@param cursor is the aforementioned cursor. It simply indicates the starting index for enumeration. The first call should pass 0, and subsequent calls should pass the returned newCursor.
    ///@param howMany indicates how many items should be returned. If there aren’t enough remaining items in the array, the function will return fewer items.
    ///@return managers address[] return array of PositionManager addresses
    ///@return newCursor uint256 return the new cursor
    function getPositionManagers(
        uint256 cursor,
        uint256 howMany
    ) public view returns (address[] memory managers, uint256 newCursor) {
        return ArrayHelper.sliceAddress(positionManagers, cursor, howMany);
    }

    ///@notice get the length of position manager array
    ///@return uint256 return length of PositionManager array
    function getPositionManagersLength() external view returns (uint256) {
        return positionManagers.length;
    }
}
