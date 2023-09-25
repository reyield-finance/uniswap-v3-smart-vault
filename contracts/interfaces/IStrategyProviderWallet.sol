// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IStrategyProviderWallet {
    enum ReceivedTokenType {
        Token0,
        Token1,
        Both
    }
    // Token0=0, Token1=1, Both=2

    struct StrategyInfo {
        address pool;
        uint16 performanceFeeRatio;
        ReceivedTokenType receivedTokenType;
        uint32 licenseAmount;
    }

    function getStrategyInfo(bytes16 _strategyId) external view returns (StrategyInfo memory);
}
