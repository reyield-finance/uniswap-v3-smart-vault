// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../interfaces/IUniswapAddressHolder.sol";
import "../interfaces/IRegistryAddressHolder.sol";
import "../interfaces/IRegistry.sol";

contract UniswapAddressHolder is IUniswapAddressHolder {
    address public override nonfungiblePositionManagerAddress;
    address public override uniswapV3FactoryAddress;
    address public override swapRouterAddress;
    IRegistryAddressHolder public immutable registryAddressHolder;

    ///@notice restrict some function called only by governance
    modifier onlyGovernance() {
        require(msg.sender == IRegistry(registryAddressHolder.registry()).governance(), "UAHOG");
        _;
    }

    constructor(
        address _registryAddressHolder,
        address _nonfungiblePositionManagerAddress,
        address _uniswapV3FactoryAddress,
        address _swapRouterAddress
    ) {
        require(_registryAddressHolder != address(0), "UAHRAH0");
        require(_nonfungiblePositionManagerAddress != address(0), "UAHNPA0");
        require(_uniswapV3FactoryAddress != address(0), "UAHFA0");
        require(_swapRouterAddress != address(0), "UAHSRA0");

        registryAddressHolder = IRegistryAddressHolder(_registryAddressHolder);
        nonfungiblePositionManagerAddress = _nonfungiblePositionManagerAddress;
        uniswapV3FactoryAddress = _uniswapV3FactoryAddress;
        swapRouterAddress = _swapRouterAddress;
    }

    ///@notice Set the address of the non fungible position manager
    ///@param newAddress The address of the non fungible position manager
    function setNonFungibleAddress(address newAddress) external override onlyGovernance {
        require(newAddress != address(0), "UAHNPA0");
        nonfungiblePositionManagerAddress = newAddress;
    }

    ///@notice Set the address of the Uniswap V3 factory
    ///@param newAddress The address of the Uniswap V3 factory
    function setFactoryAddress(address newAddress) external override onlyGovernance {
        require(newAddress != address(0), "UAHFA0");
        uniswapV3FactoryAddress = newAddress;
    }

    ///@notice Set the address of the swap router
    ///@param newAddress The address of the swap router
    function setSwapRouterAddress(address newAddress) external override onlyGovernance {
        require(newAddress != address(0), "UAHSRA0");
        swapRouterAddress = newAddress;
    }
}
