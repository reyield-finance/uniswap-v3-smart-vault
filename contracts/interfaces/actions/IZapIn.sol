// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IZapIn {
    ///@notice emitted when a UniswapNFT is zapped in
    ///@param positionManager address of PositionManager
    ///@param tokenId Id of zapped token
    ///@param tokenIn address of token zapped in
    ///@param amountIn amount of tokenIn zapped in
    ///@param amount0Deposited token0 amount deposited
    ///@param amount1Deposited token1 amount deposited
    ///@param amount0Leftover token0 amount leftover
    ///@param amount1Leftover token1 amount leftover
    event ZappedIn(
        address indexed positionManager,
        uint256 tokenId,
        address tokenIn,
        uint256 amountIn,
        uint256 amount0Deposited,
        uint256 amount1Deposited,
        uint256 amount0Leftover,
        uint256 amount1Leftover
    );

    ///@notice struct for input of the zapIn action
    ///@param token0Address address of the first token
    ///@param token1Address address of the second token
    ///@param isToken0In whether token0 is the token to be zapped in
    ///@param amountIn amount of zapIn token in position
    ///@param amountToSwap amount of token to swap
    ///@param tickLower lower tick of the position
    ///@param tickUpper upper tick of the position
    ///@param fee pool fee level
    struct ZapInInput {
        address token0;
        address token1;
        bool isToken0In;
        uint256 amountIn;
        int24 tickLower;
        int24 tickUpper;
        uint24 fee;
    }

    ///@notice struct for output of the zapIn action
    ///@param tokenId of minted NFT
    ///@param amount0Deposited token0 amount deposited
    ///@param amount1Deposited token1 amount deposited
    ///@param amount0Leftover token0 amount leftover
    ///@param amount1Leftover token1 amount leftover
    struct ZapInOutput {
        uint256 tokenId;
        uint256 amount0Deposited;
        uint256 amount1Deposited;
        uint256 amount0Leftover;
        uint256 amount1Leftover;
    }

    function zapIn(ZapInInput calldata inputs) external returns (ZapInOutput memory);
}
