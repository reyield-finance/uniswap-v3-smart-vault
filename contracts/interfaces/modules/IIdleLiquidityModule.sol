// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IIdleLiquidityModule {
    ///@notice emitted when a position is rebalanced
    ///@param positionManager address of the called position manager
    ///@param closedTokenId closed tokenId
    ///@param mintedTokenId minted tokenId
    ///@param removed0 amount of token0 removed
    ///@param removed1 amount of token1 removed
    ///@param collectedFee0 amount of token0 collected
    ///@param collectedFee1 amount of token1 collected
    ///@param repaid0 amount of token0 repaid
    ///@param repaid1 amount of token1 repaid
    event PositionRebalanced(
        address indexed positionManager,
        uint256 positionId,
        uint256 closedTokenId,
        uint256 mintedTokenId,
        uint256 removed0,
        uint256 removed1,
        uint256 collectedFee0,
        uint256 collectedFee1,
        uint256 repaid0,
        uint256 repaid1
    );

    ///@notice struct for rebalance input
    ///@param userAddress address of the user
    ///@param feeReceiver address of the fee receiver
    ///@param positionId positionId of the position manager
    ///@param estimatedGasFee estimated gas fee for the rebalance
    struct RebalanceInput {
        address userAddress;
        address payable feeReceiver;
        uint256 positionId;
        uint256 estimatedGasFee;
        bool isForced;
    }

    ///@notice struct for rebalance with tick diffs input
    ///@param userAddress address of the user
    ///@param feeReceiver address of the fee receiver
    ///@param positionId positionId of the position manager
    ///@param estimatedGasFee estimated gas fee for the rebalance
    ///@param tickLowerDiff tick lower diff to use for the rebalance
    ///@param tickUpperDiff tick upper diff to use for the rebalance
    struct RebalanceWithTickDiffsInput {
        address userAddress;
        address payable feeReceiver;
        uint256 positionId;
        uint256 estimatedGasFee;
        int24 tickLowerDiff;
        int24 tickUpperDiff;
        bool isForced;
    }

    ///@notice struct of the close and repay input
    ///@param positionManager address of the position manager
    ///@param feeReceiver address of the fee receiver
    ///@param tokenId tokenId of the position
    ///@param tickLower new tickLower of the position
    ///@param tickUpper new tickUpper of the position

    struct _CloseAndRepayRebalanceParams {
        address positionManager;
        address payable feeReceiver;
        uint256 tokenId;
        uint256 rebalanceFee;
        bool isForced;
        uint256 amount0Leftover;
        uint256 amount1Leftover;
    }

    ///@notice struct of the close and repay result
    ///@param amount0CollectedFee amount of token0 collected fee
    ///@param amount1CollectedFee amount of token1 collected fee
    ///@param amount0Removed amount of token0 removed
    ///@param amount1Removed amount of token1 removed
    ///@param amount0Repaid amount of token0 repaid
    ///@param amount1Repaid amount of token1 repaid
    struct _CloseAndRepayRebalanceResult {
        uint256 amount0CollectedFee;
        uint256 amount1CollectedFee;
        uint256 amount0Removed;
        uint256 amount1Removed;
        uint256 amount0Repaid;
        uint256 amount1Repaid;
    }

    ///@notice struct of the swap and mint input
    ///@param positionManager address of the position manager
    ///@param tokenId tokenId of the position
    ///@param amount0 amount0 to be swapped and mint
    ///@param amount1 amount1 to be swapped and mint
    ///@param tickLowerDiff diff of tickLower of the position
    ///@param tickUpperDiff diff of tickUpper of the position
    struct _SwapAndMintParams {
        address positionManager;
        uint256 tokenId;
        uint256 amount0;
        uint256 amount1;
        int24 tickLowerDiff;
        int24 tickUpperDiff;
    }

    ///@notice struct of the swap and mint result
    ///@param newTokenId new tokenId of the position
    ///@param amount0Leftover amount0 leftover from the swap
    ///@param amount1Leftover amount1 leftover from the swap
    struct _SwapAndMintResult {
        uint256 newTokenId;
        uint256 amount0Leftover;
        uint256 amount1Leftover;
    }
}
