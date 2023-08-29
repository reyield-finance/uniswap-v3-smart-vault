// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
import "../../libraries/MathHelper.sol";

contract MockMathHelper {
    ///@dev cast uint56 to int24
    function fromInt56ToInt24(int56 value) public pure returns (int24 out) {
        return MathHelper.fromInt56ToInt24(value);
    }

    ///@dev case uint256 to uint128
    function fromUint256ToUint128(uint256 value) public pure returns (uint128 out) {
        return MathHelper.fromUint256ToUint128(value);
    }
}
