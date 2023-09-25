// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../interfaces/IRegistryAddressHolder.sol";
import "../interfaces/IRegistry.sol";
import "../interfaces/IPositionManager.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract BaseRecipes is Pausable {
    IRegistryAddressHolder public immutable registryAddressHolder;

    modifier onlyGovernance() {
        require(msg.sender == registry().governance(), "BROG");
        _;
    }

    constructor(address _registryAddressHolder) Pausable() {
        require(_registryAddressHolder != address(0), "BRRAH0");
        registryAddressHolder = IRegistryAddressHolder(_registryAddressHolder);
    }

    ///@notice get IRegistry from registryAddressHolder
    ///@return IRegistry interface of registry
    function registry() internal view returns (IRegistry) {
        return IRegistry(registryAddressHolder.registry());
    }

    function pause() external onlyGovernance {
        _pause();
    }

    function unpause() external onlyGovernance {
        _unpause();
    }
}
