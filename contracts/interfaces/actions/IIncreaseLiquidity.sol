// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IIncreaseLiquidity {
    ///@notice emitted when liquidity is increased
    ///@param positionManager address of the position manager which increased liquidity
    ///@param tokenId id of the position
    ///@param amount0Increased amount of token0 increased
    ///@param amount1Increased amount of token1 increased
    event LiquidityIncreased(
        address indexed positionManager,
        uint256 tokenId,
        uint256 amount0Increased,
        uint256 amount1Increased
    );

    ///@notice struct for input of the increaseLiquidity action
    ///@param tokenId the id of the position token
    ///@param token0Address address of the first token
    ///@param token1Address address of the second token
    ///@param fee pool fee level
    ///@param tickLower lower tick of the position
    ///@param tickUpper upper tick of the position
    ///@param amount0Desired amount of first token in position
    ///@param amount1Desired amount of second token in position
    struct IncreaseLiquidityInput {
        uint256 tokenId;
        address token0Address;
        address token1Address;
        uint256 amount0Desired;
        uint256 amount1Desired;
    }

    function increaseLiquidity(
        IncreaseLiquidityInput calldata inputs
    ) external returns (uint256 amount0Increased, uint256 amount1Increased);
}
