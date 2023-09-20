// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../interfaces/IRegistryAddressHolder.sol";
import "../interfaces/IRegistry.sol";
import "@openzeppelin/contracts/introspection/ERC165Checker.sol";

contract RegistryAddressHolder is IRegistryAddressHolder {
    address public override registry;

    ///@notice restrict some function called only by governance
    modifier onlyGovernance() {
        require(msg.sender == IRegistry(registry).governance(), "RAHOG");
        _;
    }

    constructor(address _registry) {
        require(ERC165Checker.supportsInterface(_registry, type(IRegistry).interfaceId), "RAHERC165");
        registry = _registry;
    }

    ///@notice Set the address of registry
    ///@param newAddress new address of registry
    function setRegistryAddress(address newAddress) external override onlyGovernance {
        require(ERC165Checker.supportsInterface(newAddress, type(IRegistry).interfaceId), "RAHERC165");
        registry = newAddress;
    }
}
