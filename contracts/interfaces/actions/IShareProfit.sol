// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IShareProfit {
    ///@notice emitted when profit is shared
    ///@param positionManager address of PositionManager
    ///@param performanceFeeRecipient address of performance fee recipient
    ///@param performanceFeeAmount0 amount of token0 performance fee
    ///@param performanceFeeAmount1 amount of token1 performance fee
    ///@param serviceFeeAmount0 amount of token0 service fee
    ///@param serviceFeeAmount1 amount of token1 service fee
    ///@param returnedAmount0 amount of token0 returned
    ///@param returnedAmount1 amount of token1 returned
    event ProfitShared(
        address indexed positionManager,
        address performanceFeeRecipient,
        uint256 performanceFeeAmount0,
        uint256 performanceFeeAmount1,
        uint256 serviceFeeAmount0,
        uint256 serviceFeeAmount1,
        uint256 returnedAmount0,
        uint256 returnedAmount1
    );

    ///@notice struct for input of the ShareProfitInput action
    ///@param token0 address of the first token
    ///@param token1 address of the second token
    ///@param returnedToken address of the returned token
    ///@param amount0 amount of first token in position
    ///@param amount1 amount of second token in position
    ///@param originalDepositUsdValue original deposit value in USD
    ///@param performanceFeeRecipient address of performance fee recipient
    ///@param performanceFeeReceivedToken address of performance fee received token
    ///@param performanceFeeRatio performance fee ratio
    ///@param serviceFeeRatio service fee ratio
    struct ShareProfitInput {
        address token0;
        address token1;
        address returnedToken;
        uint256 amount0;
        uint256 amount1;
        uint256 originalDepositUsdValue;
        address performanceFeeRecipient;
        address performanceFeeReceivedToken;
        uint24 performanceFeeRatio;
        uint32 serviceFeeRatio;
    }

    ///@notice struct for output of the ShareProfitInput action
    ///@param amount0Returned amount of token0 returned
    ///@param amount1Returned amount of token1 returned
    struct ShareProfitOutput {
        uint256 amount0Returned;
        uint256 amount1Returned;
    }

    struct _ShareParams {
        address token0;
        address token1;
        address performanceFeeRecipient;
        uint256 amount0PerformanceFee;
        uint256 amount1PerformanceFee;
        uint256 amount0Returned;
        uint256 amount1Returned;
        uint32 serviceFeeRatio;
    }

    struct _ShareResult {
        uint256 performanceFeeAmount0;
        uint256 performanceFeeAmount1;
        uint256 serviceFeeAmount0;
        uint256 serviceFeeAmount1;
        uint256 returnedAmount0;
        uint256 returnedAmount1;
    }

    function shareProfit(ShareProfitInput calldata inputs) external returns (ShareProfitOutput memory);
}
