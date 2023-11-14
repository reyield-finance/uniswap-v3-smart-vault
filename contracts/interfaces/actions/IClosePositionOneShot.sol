// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IClosePositionOneShot {
    ///@notice emitted when a UniswapNFT position is closed in one shot
    ///@param positionManager address of PositionManager
    ///@param tokenId Id of the closed token
    ///@param amount0Collected  uint256 amount of token0 collected
    ///@param amount1Collected uint256 amount of token1 collected

    event PositionClosed(
        address indexed positionManager,
        uint256 tokenId,
        uint256 amount0Collected,
        uint256 amount1Collected
    );

    struct ClosePositionOneShotInput {
        uint256 tokenId;
        bool returnTokenToUser;
    }

    struct ClosePositionOneShotOutput {
        uint256 amount0Collected;
        uint256 amount1Collected;
    }

    function closePositionOneShot(
        ClosePositionOneShotInput memory input
    ) external returns (ClosePositionOneShotOutput memory output);
}
