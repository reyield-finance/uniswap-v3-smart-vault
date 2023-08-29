// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IRepayRebalanceFee {
    ///@notice emitted when rebalance fee repaid
    ///@param positionManager address of PositionManager
    ///@param token0Repaid amount of token0 repaid
    ///@param token1Repaid amount of token1 repaid
    ///@param totalWETH9Repaid total amount of WETH9 repaid
    event RebalanceFeeRepaid(
        address indexed positionManager,
        uint256 token0Repaid,
        uint256 token1Repaid,
        uint256 totalWETH9Repaid
    );

    ///@notice struct for input of the RepayRebalanceFeeInput action
    ///@param token0 address of the first token
    ///@param token1 address of the second token
    ///@param amount0Quota amount of token0 used to repay
    ///@param amount1Quota amount of token1 used to repay
    ///@param rebalanceFee amount of rebalance fee
    ///@param receiver address of the receiver
    struct RepayRebalanceFeeInput {
        address token0;
        address token1;
        uint256 amount0Quota;
        uint256 amount1Quota;
        uint256 rebalanceFee;
        address payable receiver;
    }

    ///@notice struct for output of the RepayRebalanceFeeInput action
    ///@param token0Repaid amount of token0 repaid
    ///@param token1Repaid amount of token1 repaid
    ///@param totalWETH9Repaid amount of total value in WETH9 repaid
    struct RepayRebalanceFeeOutput {
        uint256 token0Repaid;
        uint256 token1Repaid;
        uint256 totalWETH9Repaid;
    }

    function repayRebalanceFee(
        RepayRebalanceFeeInput calldata inputs
    ) external payable returns (RepayRebalanceFeeOutput memory outputs);
}
