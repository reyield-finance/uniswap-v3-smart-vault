// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IStrategyProviderWalletFactory {
    function create(address provider) external returns (address);

    function providerToWallet(address _provider) external view returns (address);
}
