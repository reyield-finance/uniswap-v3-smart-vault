// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IWithdrawNativeToken {
    ///@notice emitted when native token withdrawn
    ///@param positionManager address of PositionManager
    ///@param receiver address of the receiver
    ///@param amount amount of native token withdrawn
    event NativeTokenWithdrawn(address indexed positionManager, address receiver, uint256 amount);

    ///@notice struct for input of the WithdrawNativeTokenInput action
    ///@param amount amount of native token withdrawn
    ///@param receiver address of the receiver
    struct WithdrawNativeTokenInput {
        uint256 amount;
        address payable receiver;
    }

    function withdrawNativeToken(WithdrawNativeTokenInput calldata input) external payable;
}
