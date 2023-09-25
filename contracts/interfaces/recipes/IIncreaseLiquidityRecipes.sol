// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IIncreaseLiquidityRecipes {
    ///@notice emitted when a position is increased liquidity
    ///@param positionManager address of the position manager
    ///@param from address of the user
    ///@param positionId ID of the position
    event PositionIncreasedLiquidity(address indexed positionManager, address from, uint256 positionId);

    ///@notice struct for input of the IncreaseLiquidity
    ///@param positionId id of the position
    ///@param amount0Desired amount of token0 to be added to the position
    ///@param amount1Desired amount of token1 to be added to the position
    struct IncreaseLiquidityInput {
        uint256 positionId;
        uint256 amount0Desired;
        uint256 amount1Desired;
    }

    ///@notice struct for input of the SingleTokenIncreaseLiquidity
    ///@param positionId ID of the position
    ///@param amount amount of token to be deposited
    ///@param isToken0In true if the input token is token0, false if the input token is token1
    struct SingleTokenIncreaseLiquidityInput {
        uint256 positionId;
        uint256 amount;
        bool isToken0In;
    }
}
