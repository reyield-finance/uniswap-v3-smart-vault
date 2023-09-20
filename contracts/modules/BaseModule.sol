// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../interfaces/IRegistry.sol";
import "../interfaces/IRegistryAddressHolder.sol";
import "../interfaces/IPositionManager.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract BaseModule is Pausable {
    IRegistryAddressHolder public registryAddressHolder;

    modifier onlyWhitelistedKeeper() {
        require(registry().whitelistedKeepers(msg.sender), "BMOWLK");
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == registry().governance(), "BMOG");
        _;
    }

    constructor(address _registryAddressHolder) {
        require(_registryAddressHolder != address(0), "BMRAH0");
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
