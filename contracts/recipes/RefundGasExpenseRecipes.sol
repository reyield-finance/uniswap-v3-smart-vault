// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../interfaces/IPositionManager.sol";
import "../interfaces/IPositionManagerFactory.sol";
import "../interfaces/recipes/IRefundGasExpenseRecipes.sol";
import "../interfaces/actions/IWithdrawNativeToken.sol";
import "./BaseRecipes.sol";

///@notice RefundGasExpenseRecipes allows user to refund gas expense from PositionManager
contract RefundGasExpenseRecipes is BaseRecipes, IRefundGasExpenseRecipes {
    constructor(address _registryAddressHolder) BaseRecipes(_registryAddressHolder) {}

    ///@notice refund gas expense from PositionManager
    ///@param receiver address of the receiver
    ///@param amount amount of gas expense to refund
    function refundGasExpense(address payable receiver, uint256 amount) external override whenNotPaused {
        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(msg.sender);
        require(positionManager != address(0), "RGERPM0");

        ///@dev check if receiver is a contract
        require(!isContract(receiver), "RGERIC");

        ///@dev call withdrawNativeToken action
        IWithdrawNativeToken(positionManager).withdrawNativeToken(
            IWithdrawNativeToken.WithdrawNativeTokenInput({ amount: amount, receiver: receiver })
        );

        emit GasExpenseRefunded(positionManager, msg.sender, receiver, amount);
    }

    function isContract(address _addr) private view returns (bool) {
        uint32 size;
        assembly {
            size := extcodesize(_addr)
        }
        return (size > 0);
    }
}
