// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../../libraries/UniswapUncollectedFeeHelper.sol";

contract MockUniswapUncollectedFeeHelper {
    ///@notice Get the uncollected fees of a position
    ///@param factoryAddress address of the factory
    ///@param nonfungiblePositionManagerAddress address of the nonfungiblePositionManager
    ///@param tokenId Id of the position
    ///@return output the output struct of getUncollectedFees
    function getUncollectedFees(
        address factoryAddress,
        address nonfungiblePositionManagerAddress,
        uint256 tokenId
    ) public view returns (UniswapUncollectedFeeHelper.GetUncollectedFeesOutput memory output) {
        return
            UniswapUncollectedFeeHelper.getUncollectedFees(factoryAddress, nonfungiblePositionManagerAddress, tokenId);
    }
}
