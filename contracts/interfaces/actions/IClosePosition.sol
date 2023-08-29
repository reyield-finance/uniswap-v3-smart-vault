// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IClosePosition {
    ///@notice emitted when a UniswapNFT position is closed
    ///@param positionManager address of PositionManager
    ///@param tokenId Id of the closed token
    ///@param amount0CollectedFee  uint256 amount of token0 collected fee
    ///@param amount1CollectedFee uint256 amount of token1 collected fee
    ///@param amount0Removed uint256 amount of token0 removed from liquidity
    ///@param amount1Removed  uint256 amount of token1 removed from liquidity
    event PositionClosed(
        address indexed positionManager,
        uint256 tokenId,
        uint256 amount0CollectedFee,
        uint256 amount1CollectedFee,
        uint256 amount0Removed,
        uint256 amount1Removed
    );

    function closePosition(
        uint256 tokenId,
        bool returnTokenToUser
    )
        external
        returns (
            uint256 amount0CollectedFee,
            uint256 amount1CollectedFee,
            uint256 amount0Removed,
            uint256 amount1Removed
        );
}
