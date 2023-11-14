// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IRefundGasExpenseRecipes {
    ///@notice emitted when gas expense is refunded
    ///@param positionManager address of PositionManager
    ///@param from address of the user
    ///@param receiver address of the receiver
    ///@param amount amount of gas expense
    event GasExpenseRefunded(address indexed positionManager, address from, address receiver, uint256 amount);

    ///@notice refund gas expense
    ///@param amount amount of gas expense
    function refundGasExpense(uint256 amount) external;
}
