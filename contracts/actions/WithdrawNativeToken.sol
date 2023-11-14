// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../Storage.sol";
import "../interfaces/actions/IWithdrawNativeToken.sol";

///@notice action to withdraw native token
contract WithdrawNativeToken is IWithdrawNativeToken {
    ///@notice withdraw native token to receiver
    ///@param input struct of withdrawNativeToken parameters
    function withdrawNativeToken(
        IWithdrawNativeToken.WithdrawNativeTokenInput calldata input
    ) external payable override {
        require(address(this).balance >= input.amount, "WNTMIB");

        ///@dev withdraw native token
        if (input.amount > 0) {
            (bool sent, ) = input.receiver.call{ value: input.amount }("");

            require(sent, "WNTMSE");
        }
        emit NativeTokenWithdrawn(address(this), input.receiver, input.amount);
    }
}
