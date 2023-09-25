// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IRegistryAddressHolder {
    ///@notice default getter for regitsry address
    ///@return address The address of the registry
    function registry() external view returns (address);

    ///@notice Set the address of registry
    ///@param newAddress new address of registry
    function setRegistryAddress(address newAddress) external;
}
