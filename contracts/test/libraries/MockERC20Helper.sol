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
        ERC20Helper._approveToken(token, spender, amount);
    }

    ///@notice transfer the token to the spender
    ///@dev _getBalance(address token, address account)
    ///@param token address of the token
    ///@param account address of the owner
    ///@return uint256 amount of the balance
    function getBalance(address token, address account) public view returns (uint256) {
        return ERC20Helper._getBalance(token, account);
    }

    ///@notice return the allowance of the token that spender is able to spend
    ///@dev _getAllowance(address token, address owner, address spender)
    ///@param token address of the token
    ///@param owner address of the owner
    ///@param spender address of the spender
    ///@return uint256 amount of the allowance
    function getAllowance(address token, address owner, address spender) public view returns (uint256) {
        return ERC20Helper._getAllowance(token, owner, spender);
    }

    ///@notice withdraw the tokens from the vault and send them to the user
    ///@dev _withdrawTokens(address token, address to, uint256 amount)
    ///@param token address of the token
    ///@param to address of the user
    ///@param amount address of the balance
    function withdrawTokens(address token, address to, uint256 amount) public {
        ERC20Helper._withdrawTokens(token, to, amount);
    }

    function approve(address token, address to) public {
        IERC20(token).approve(to, type(uint256).max);
        IERC20(token).approve(address(this), type(uint256).max);
    }
}
