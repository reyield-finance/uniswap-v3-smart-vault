// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../../libraries/ArrayHelper.sol";

contract MockArrayHelper {
    ///@notice get the slice of uint256 from the given array
    ///@param arr array of uint256
    ///@param cursor starting index
    ///@param howMany how many elements to get
    ///@return newArr array of uint256
    ///@return newCursor new cursor
    function sliceUint256(
        uint256[] memory arr,
        uint256 cursor,
        uint256 howMany
    ) external pure returns (uint256[] memory newArr, uint256 newCursor) {
        return ArrayHelper.sliceUint256(arr, cursor, howMany);
    }

    ///@notice get the slice of address from the given array
    ///@param arr array of address
    ///@param cursor starting index
    ///@param howMany how many elements to get
    ///@return newArr array of address
    ///@return newCursor new cursor
    function sliceAddress(
        address[] calldata arr,
        uint256 cursor,
        uint256 howMany
    ) external pure returns (address[] memory newArr, uint256 newCursor) {
        return ArrayHelper.sliceAddress(arr, cursor, howMany);
    }
}
