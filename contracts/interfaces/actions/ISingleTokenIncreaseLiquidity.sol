// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface ISingleTokenIncreaseLiquidity {
    ///@notice emitted when liquidity is increased with a single token
    ///@param positionManager address of the position manager which increased liquidity
    ///@param tokenId id of the position
    ///@param tokenIn address of token zapped in
    ///@param amountIn amount of tokenIn zapped in
    ///@param amount0Increased amount of token0 increased
    ///@param amount1Increased amount of token1 increased
    ///@param amount0Leftover amount of token0 leftover
    ///@param amount1Leftover amount of token1 leftover
    event LiquidityIncreasedWithSingleToken(
        address indexed positionManager,
        uint256 tokenId,
        address tokenIn,
        uint256 amountIn,
        uint256 amount0Increased,
        uint256 amount1Increased,
        uint256 amount0Leftover,
        uint256 amount1Leftover
    );

    ///@notice struct for input of the singleTokenIncreaseLiquidity action
    ///@param tokenId id of the position
    ///@param token0 address of the first token
    ///@param token1 address of the second token
    ///@param isToken0In whether token0 is the token to be zapped in
    ///@param amountIn amount of zapIn token in position
    ///@param tickLower lower tick of the position
    ///@param tickUpper upper tick of the position
    ///@param fee pool fee level
    struct SingleTokenIncreaseLiquidityInput {
        uint256 tokenId;
        address token0;
        address token1;
        bool isToken0In;
        uint256 amountIn;
        int24 tickLower;
        int24 tickUpper;
        uint24 fee;
    }
    ///@notice struct for output of the singleTokenIncreaseLiquidity action
    ///@param amount0Increased the increased amount of token0
    ///@param amount1Increased the increased amount of token1
    ///@param amount0Leftover the leftover amount of token0
    ///@param amount1Leftover the leftover amount of token1
    struct SingleTokenIncreaseLiquidityOutput {
        uint256 amount0Increased;
        uint256 amount1Increased;
        uint256 amount0Leftover;
        uint256 amount1Leftover;
    }

    function singleTokenIncreaseLiquidity(
        SingleTokenIncreaseLiquidityInput calldata inputs
    ) external returns (SingleTokenIncreaseLiquidityOutput memory);
}
