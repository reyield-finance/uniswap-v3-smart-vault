// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../interfaces/IERC20Extended.sol";

contract ERC20Extended {
    function decimals(address token) public view returns (uint8) {
        return IERC20Extended(token).decimals();
    }

    function symbol(address token) public view returns (string memory) {
        return IERC20Extended(token).symbol();
    }
}
