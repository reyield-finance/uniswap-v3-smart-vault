// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;

library MathHelper {
    ///@dev cast uint56 to int24
    function fromInt56ToInt24(int56 value) internal pure returns (int24 out) {
        require((out = int24(value)) == value, "MH1");
    }

    ///@dev case uint256 to uint128
    function fromUint256ToUint128(uint256 value) internal pure returns (uint128 out) {
        require((out = uint128(value)) == value, "MH2");
    }
}
