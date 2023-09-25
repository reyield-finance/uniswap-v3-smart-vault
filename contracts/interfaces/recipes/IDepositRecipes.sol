// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IDepositRecipes {
    ///@notice emitted when a position is created
    ///@param positionManager address of the position manager
    ///@param from address of the user
    ///@param positionId ID of the position
    ///@param strategyId ID of the strategy
    event PositionDeposited(address indexed positionManager, address from, uint256 positionId, bytes16 strategyId);

    ///@notice emitted when a position is created
    ///@param positionManager address of the position manager
    ///@param from address of the user
    ///@param positionId ID of the position
    ///@param strategyId ID of the strategy
    ///@param strategyProvider address of the strategy provider
    event PositionDepositedListedStrategy(
        address indexed positionManager,
        address from,
        uint256 positionId,
        bytes16 strategyId,
        address strategyProvider
    );

    ///@notice struct for input of the Deposit
    ///@param token0 the first token to be deposited
    ///@param token1 the second token to be deposited
    ///@param fee fee tier of the pool to be deposited in
    ///@param tickLowerDiff the difference between current tick and lower bound of the position range
    ///@param tickUpperDiff the difference between current tick and upper bound of the position range
    ///@param amount0Desired the amount of the first token to be deposited
    ///@param amount1Desired the amount of the second token to be deposited
    ///@param strategyId ID of the strategy
    struct DepositInput {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLowerDiff;
        int24 tickUpperDiff;
        uint256 amount0Desired;
        uint256 amount1Desired;
        bytes16 strategyId;
    }

    ///@notice struct for input of the DepositListedStrategy
    ///@param token0 the first token to be deposited
    ///@param token1 the second token to be deposited
    ///@param fee fee tier of the pool to be deposited in
    ///@param tickLowerDiff the difference between current tick and lower bound of the position range
    ///@param tickUpperDiff the difference between current tick and upper bound of the position range
    ///@param amount0Desired the amount of the first token to be deposited
    ///@param amount1Desired the amount of the second token to be deposited
    ///@param strategyProvider address of the provider of strategy
    ///@param strategyId ID of the strategy
    struct DepositListedStrategyInput {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLowerDiff;
        int24 tickUpperDiff;
        uint256 amount0Desired;
        uint256 amount1Desired;
        bytes16 strategyId;
        address strategyProvider;
    }

    ///@notice struct for input of the SingleTokenDeposit
    ///@param token0 address token0 of the pool
    ///@param token1 address token1 of the pool
    ///@param isToken0In true if the input token is token0, false if the input token is token1
    ///@param amountIn amount of input token
    ///@param tickLowerDiff the difference between current tick and lower bound of the position range
    ///@param tickUpperDiff the difference between current tick and upper bound of the position range
    ///@param fee fee tier of the pool
    ///@param strategyId ID of the strategy
    struct SingleTokenDepositInput {
        address token0;
        address token1;
        bool isToken0In;
        uint256 amountIn;
        int24 tickLowerDiff;
        int24 tickUpperDiff;
        uint24 fee;
        bytes16 strategyId;
    }

    ///@notice struct for input of the SingleTokenDepositListedStrategy
    ///@param token0 address token0 of the pool
    ///@param token1 address token1 of the pool
    ///@param isToken0In true if the input token is token0, false if the input token is token1
    ///@param amountIn amount of input token
    ///@param tickLowerDiff the difference between current tick and lower bound of the position range
    ///@param tickUpperDiff the difference between current tick and upper bound of the position range
    ///@param fee fee tier of the pool
    ///@param strategyProvider address of the provider of strategy
    ///@param strategyId ID of the strategy
    struct SingleTokenDepositListedStrategyInput {
        address token0;
        address token1;
        bool isToken0In;
        uint256 amountIn;
        int24 tickLowerDiff;
        int24 tickUpperDiff;
        uint24 fee;
        address strategyProvider;
        bytes16 strategyId;
    }
}
