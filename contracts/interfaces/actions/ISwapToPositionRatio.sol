// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface ISwapToPositionRatio {
    ///@notice emitted when a positionManager swaps to ratio
    ///@param positionManager address of PositionManager
    ///@param amount0In token0 amount in
    ///@param amount1In token1 amount in
    ///@param amount0Out token0 amount out
    ///@param amount1Out token1 amount out
    event SwappedToPositionRatio(
        address indexed positionManager,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out
    );

    ///@notice input the decoder expects
    ///@param token0Address address of first token of the pool
    ///@param token1Address address of second token of the pool
    ///@param fee fee tier of the pool
    ///@param amount0In actual token0 amount to be deposited
    ///@param amount1In actual token1 amount to be deposited
    ///@param tickLower lower tick of position
    ///@param tickUpper upper tick of position
    struct SwapToPositionInput {
        address token0Address;
        address token1Address;
        uint24 fee;
        uint256 amount0In;
        uint256 amount1In;
        int24 tickLower;
        int24 tickUpper;
    }

    function swapToPositionRatio(
        SwapToPositionInput memory inputs
    ) external returns (uint256 amount0Out, uint256 amount1Out);
}
