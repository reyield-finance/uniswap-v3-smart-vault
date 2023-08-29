// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IReturnProfit {
    ///@notice emitted when profit is returned
    ///@param positionManager address of PositionManager
    ///@param returnedAmount0 amount of token0 returned
    ///@param returnedAmount1 amount of token1 returned
    event ProfitReturned(address indexed positionManager, uint256 returnedAmount0, uint256 returnedAmount1);

    ///@notice struct for input of the ReturnProfitInput action
    ///@param token0 address of the first token
    ///@param token1 address of the second token
    ///@param returnedToken address of the returned token
    ///@param amount0 amount of first token in position
    ///@param amount1 amount of second token in position
    struct ReturnProfitInput {
        address token0;
        address token1;
        address returnedToken;
        uint256 amount0;
        uint256 amount1;
    }

    ///@notice struct for output of the ReturnProfitInput action
    ///@param amount0Returned amount of token0 returned
    ///@param amount1Returned amount of token1 returned
    struct ReturnProfitOutput {
        uint256 amount0Returned;
        uint256 amount1Returned;
    }

    function returnProfit(ReturnProfitInput calldata inputs) external returns (ReturnProfitOutput memory);
}
