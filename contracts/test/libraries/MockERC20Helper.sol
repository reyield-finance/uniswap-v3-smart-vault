// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../../libraries/ERC20Helper.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockERC20Helper {
    ///@notice library to interact with ERC20 helper for testing

    ///@notice approve the token to be able to transfer it
    ///@dev _approveToken(address token, address spender, uint256 amount)
    ///@param token address of the token
    ///@param spender address of the spender
    ///@param amount amount to be approved
    function approveToken(address token, address spender, uint256 amount) public {
        ERC20Helper.approveToken(token, spender, amount);
    }

    ///@notice withdraw the tokens from the vault and send them to the user
    ///@dev _withdrawTokens(address token, address to, uint256 amount)
    ///@param token address of the token
    ///@param to address of the user
    ///@param amount address of the balance
    function withdrawTokens(address token, address to, uint256 amount) public {
        ERC20Helper.withdrawTokens(token, to, amount);
    }
}
