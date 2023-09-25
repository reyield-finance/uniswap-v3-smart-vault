// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

library ERC20Helper {
    ///@dev library to interact with ERC20 token
    using SafeERC20 for IERC20;

    ///@notice approve the token to be able to transfer it
    ///@param token address of the token
    ///@param spender address of the spender
    ///@param amount amount to approve
    function approveToken(address token, address spender, uint256 amount) internal {
        uint256 allowance = IERC20(token).allowance(address(this), spender);
        if (allowance >= amount) {
            return;
        }
        IERC20(token).safeIncreaseAllowance(spender, amount - allowance);
    }

    ///@notice withdraw the tokens from the vault and send them to the user. Send all if the amount is greater than the vault's balance.
    ///@param token address of the token to withdraw
    ///@param to address of the user
    ///@param amount amount of tokens to withdraw
    function withdrawTokens(address token, address to, uint256 amount) internal returns (uint256 amountOut) {
        uint256 balance = IERC20(token).balanceOf(address(this));

        if (amount >= balance) {
            amountOut = balance;
        } else {
            amountOut = amount;
        }
        IERC20(token).safeTransfer(to, amountOut);
    }
}
