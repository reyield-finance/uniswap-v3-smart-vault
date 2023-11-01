// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/libraries/FullMath.sol";
import "@uniswap/v3-core/contracts/libraries/FixedPoint128.sol";

///@title library to interact with NFT token and do some useful function with it
library UniswapUncollectedFeeHelper {
    ///@notice the output struct of getUncollectedFees
    ///@param token0 address of the token0
    ///@param token1 address of the token1
    ///@param amount0 amount of token0
    ///@param amount1 amount of token1
    struct GetUncollectedFeesOutput {
        address token0;
        address token1;
        uint128 amount0;
        uint128 amount1;
    }

    ///@notice Get the uncollected fees of a position
    ///@param factoryAddress address of the factory
    ///@param nonfungiblePositionManagerAddress address of the nonfungiblePositionManager
    ///@param tokenId Id of the position
    ///@return output the output struct of getUncollectedFees
    function getUncollectedFees(
        address factoryAddress,
        address nonfungiblePositionManagerAddress,
        uint256 tokenId
    ) internal view returns (GetUncollectedFeesOutput memory output) {
        {
            uint128 liquidity;
            uint256 feeGrowthInside0LastX128;
            uint256 feeGrowthInside1LastX128;
            (
                ,
                ,
                output.token0,
                output.token1,
                ,
                ,
                ,
                liquidity,
                feeGrowthInside0LastX128,
                feeGrowthInside1LastX128,
                output.amount0,
                output.amount1
            ) = INonfungiblePositionManager(nonfungiblePositionManagerAddress).positions(tokenId);

            (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) = _getFeeGrowthInside(
                factoryAddress,
                nonfungiblePositionManagerAddress,
                tokenId
            );

            output.amount0 += uint128(
                FullMath.mulDiv(feeGrowthInside0X128 - feeGrowthInside0LastX128, liquidity, FixedPoint128.Q128)
            );
            output.amount1 += uint128(
                FullMath.mulDiv(feeGrowthInside1X128 - feeGrowthInside1LastX128, liquidity, FixedPoint128.Q128)
            );
        }
    }

    function _getFeeGrowthInside(
        address factoryAddress,
        address nonfungiblePositionManagerAddress,
        uint256 tokenId
    ) internal view returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) {
        GetFeeGrowthInsideData memory data = _preLoadDataForGetFeeGrowthInside(
            factoryAddress,
            nonfungiblePositionManagerAddress,
            tokenId
        );

        // calculate fee growth below
        uint256 feeGrowthBelow0X128;
        uint256 feeGrowthBelow1X128;
        if (data.tickCurrent >= data.tickLower) {
            feeGrowthBelow0X128 = data.lowerFeeGrowthOutside0X128;
            feeGrowthBelow1X128 = data.lowerFeeGrowthOutside1X128;
        } else {
            feeGrowthBelow0X128 = data.feeGrowthGlobal0X128 - data.lowerFeeGrowthOutside0X128;
            feeGrowthBelow1X128 = data.feeGrowthGlobal1X128 - data.lowerFeeGrowthOutside1X128;
        }

        // calculate fee growth above
        uint256 feeGrowthAbove0X128;
        uint256 feeGrowthAbove1X128;
        if (data.tickCurrent < data.tickUpper) {
            feeGrowthAbove0X128 = data.upperFeeGrowthOutside0X128;
            feeGrowthAbove1X128 = data.upperFeeGrowthOutside1X128;
        } else {
            feeGrowthAbove0X128 = data.feeGrowthGlobal0X128 - data.upperFeeGrowthOutside0X128;
            feeGrowthAbove1X128 = data.feeGrowthGlobal1X128 - data.upperFeeGrowthOutside1X128;
        }

        feeGrowthInside0X128 = data.feeGrowthGlobal0X128 - feeGrowthBelow0X128 - feeGrowthAbove0X128;
        feeGrowthInside1X128 = data.feeGrowthGlobal1X128 - feeGrowthBelow1X128 - feeGrowthAbove1X128;
    }

    struct GetFeeGrowthInsideData {
        int24 tickCurrent;
        int24 tickLower;
        int24 tickUpper;
        uint256 feeGrowthGlobal0X128; // SLOAD for gas optimization
        uint256 feeGrowthGlobal1X128; // SLOAD for gas optimization
        uint256 lowerFeeGrowthOutside0X128;
        uint256 lowerFeeGrowthOutside1X128;
        uint256 upperFeeGrowthOutside0X128;
        uint256 upperFeeGrowthOutside1X128;
    }

    function _preLoadDataForGetFeeGrowthInside(
        address factoryAddress,
        address nonfungiblePositionManagerAddress,
        uint256 tokenId
    ) internal view returns (GetFeeGrowthInsideData memory data) {
        {
            address token0;
            address token1;
            uint24 fee;
            (, , token0, token1, fee, data.tickLower, data.tickUpper, , , , , ) = INonfungiblePositionManager(
                nonfungiblePositionManagerAddress
            ).positions(tokenId);

            IUniswapV3Pool _pool = IUniswapV3Pool(
                PoolAddress.computeAddress(factoryAddress, PoolAddress.getPoolKey(token0, token1, fee))
            );

            data.feeGrowthGlobal0X128 = _pool.feeGrowthGlobal0X128(); // SLOAD for gas optimization
            data.feeGrowthGlobal1X128 = _pool.feeGrowthGlobal1X128(); // SLOAD for gas optimization

            (, data.tickCurrent, , , , , ) = _pool.slot0();
            (, , data.lowerFeeGrowthOutside0X128, data.lowerFeeGrowthOutside1X128, , , , ) = _pool.ticks(
                data.tickLower
            );

            (, , data.upperFeeGrowthOutside0X128, data.upperFeeGrowthOutside1X128, , , , ) = _pool.ticks(
                data.tickUpper
            );
        }
    }
}
