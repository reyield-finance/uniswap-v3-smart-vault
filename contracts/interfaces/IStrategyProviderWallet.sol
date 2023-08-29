// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IStrategyProviderWallet {
    struct StrategyInfo {
        address pool;
        uint24 performanceFeeRatio;
        address receivedToken;
        uint32 licenseAmount;
    }

    function getStrategyInfo(bytes16 _strategyId) external view returns (StrategyInfo memory);
}
