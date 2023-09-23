// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

library ArrayHelper {
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
    ) internal pure returns (uint256[] memory newArr, uint256 newCursor) {
        uint256 length = arr.length;

        if (howMany > length - cursor) {
            howMany = length - cursor;
        }

        newArr = new uint256[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            newArr[i] = arr[cursor + i];
        }
        newCursor = cursor + howMany;
    }

    ///@notice get the slice of address from the given array
    ///@param arr array of address
    ///@param cursor starting index
    ///@param howMany how many elements to get
    ///@return newArr array of address
    ///@return newCursor new cursor
    function sliceAddress(
        address[] memory arr,
        uint256 cursor,
        uint256 howMany
    ) internal pure returns (address[] memory newArr, uint256 newCursor) {
        uint256 length = arr.length;

        if (howMany > length - cursor) {
            howMany = length - cursor;
        }

        newArr = new address[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            newArr[i] = arr[cursor + i];
        }

        newCursor = cursor + howMany;
    }
}
