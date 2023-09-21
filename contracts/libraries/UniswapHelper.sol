// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol";
import "@uniswap/v3-core/contracts/libraries/SqrtPriceMath.sol";
import "@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol";
import "./MathHelper.sol";
import "./SafeInt24Math.sol";

///@title library to interact with NFT token and do some useful function with it
library UniswapHelper {
    using SafeInt24Math for int24;

    ///@notice get the pool address
    ///@param factory address of the UniswapV3Factory
    ///@param token0 address of the token0
    ///@param token1 address of the token1
    ///@param fee fee tier of the pool
    ///@return address address of the pool
    function _getPool(address factory, address token0, address token1, uint24 fee) internal view returns (address) {
        address pool = IUniswapV3Factory(factory).getPool(token0, token1, fee);
        require(pool != address(0), "UHP0");
        return pool;
    }

    ///@notice get the address of the tpkens from the tokenId
    ///@param tokenId id of the position (NFT)
    ///@param nonfungiblePositionManager instance of the nonfungiblePositionManager given by the caller (address)
    ///@return token0address address of the token0
    ///@return token1address address of the token1
    ///@return fee fee tier of the pool
    ///@return tickLower of position
    ///@return tickUpper of position
    function _getTokens(
        uint256 tokenId,
        INonfungiblePositionManager nonfungiblePositionManager
    )
        internal
        view
        returns (address token0address, address token1address, uint24 fee, int24 tickLower, int24 tickUpper)
    {
        (, , token0address, token1address, fee, tickLower, tickUpper, , , , , ) = nonfungiblePositionManager.positions(
            tokenId
        );
    }

    ///@notice get the amount of tokens from liquidity and tick ranges
    ///@param liquidity amount of liquidity to convert
    ///@param currentTick current tick
    ///@param tickLower lower tick range
    ///@param tickUpper upper tick range
    ///@param sqrtPriceX96 square root of the price
    ///@return amount0 uint256 amount of token0
    ///@return amount1 uint256 amount of token1
    function _getAmountsFromLiquidity(
        uint128 liquidity,
        int24 currentTick,
        int24 tickLower,
        int24 tickUpper,
        uint160 sqrtPriceX96
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        if (currentTick < tickLower) {
            // current tick is below the passed range; liquidity can only become in range by crossing from left to
            // right, when we'll need _more_ token0 (it's becoming more valuable) so user must provide it
            amount0 = SqrtPriceMath.getAmount0Delta(
                TickMath.getSqrtRatioAtTick(tickLower),
                TickMath.getSqrtRatioAtTick(tickUpper),
                liquidity,
                true
            );
        } else if (currentTick < tickUpper) {
            amount0 = SqrtPriceMath.getAmount0Delta(
                sqrtPriceX96,
                TickMath.getSqrtRatioAtTick(tickUpper),
                liquidity,
                true
            );
            amount1 = SqrtPriceMath.getAmount1Delta(
                TickMath.getSqrtRatioAtTick(tickLower),
                sqrtPriceX96,
                liquidity,
                true
            );
        } else {
            // current tick is above the passed range; liquidity can only become in range by crossing from right to
            // left, when we'll need _more_ token1 (it's becoming more valuable) so user must provide it
            amount1 = SqrtPriceMath.getAmount1Delta(
                TickMath.getSqrtRatioAtTick(tickLower),
                TickMath.getSqrtRatioAtTick(tickUpper),
                liquidity,
                true
            );
        }
    }

    ///@notice Computes the amount of liquidity for a given amount of token0, token1
    ///@param amount0 The amount of token0 being sent in
    ///@param amount1 The amount of token1 being sent in
    ///@param tickLower lower tick range
    ///@param tickUpper upper tick range
    ///@param sqrtRatioX96 square root of the ratio
    ///@return liquidity The amount of liquidity received
    function _getLiquidityFromAmounts(
        uint256 amount0,
        uint256 amount1,
        int24 tickLower,
        int24 tickUpper,
        uint160 sqrtRatioX96
    ) internal pure returns (uint128 liquidity) {
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);
        uint256 amount0Desired = amount0;
        uint256 amount1Desired = amount1;

        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);

        if (sqrtRatioX96 <= sqrtRatioAX96) {
            liquidity = LiquidityAmounts.getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0Desired);
        } else if (sqrtRatioX96 < sqrtRatioBX96) {
            if (amount0Desired == 0) {
                liquidity = LiquidityAmounts.getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioX96, amount1Desired);
            } else if (amount1Desired == 0) {
                liquidity = LiquidityAmounts.getLiquidityForAmount0(sqrtRatioX96, sqrtRatioBX96, amount0Desired);
            } else {
                uint128 liquidity0 = LiquidityAmounts.getLiquidityForAmount0(
                    sqrtRatioX96,
                    sqrtRatioBX96,
                    amount0Desired
                );
                uint128 liquidity1 = LiquidityAmounts.getLiquidityForAmount1(
                    sqrtRatioAX96,
                    sqrtRatioX96,
                    amount1Desired
                );
                liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
            }
        } else {
            liquidity = LiquidityAmounts.getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1Desired);
        }
    }

    ///@notice Reorder tokens to be in the correct order for the pool
    ///@param _token0 address of token0
    ///@param _token1 address of token1
    ///@return token0 address of token0 after reordering
    ///@return token1 address of token1 after reordering
    ///@return isOrderChanged bool if the order was changed
    function _reorderTokens(
        address _token0,
        address _token1
    ) internal pure returns (address token0, address token1, bool isOrderChanged) {
        if (_token0 > _token1) {
            token0 = _token1;
            token1 = _token0;
            isOrderChanged = true;
        } else {
            token0 = _token0;
            token1 = _token1;
            isOrderChanged = false;
        }
    }

    ///@notice Calculates the liquidity and amounts for a given position
    ///@param factory address of the UniswapV3Factory
    ///@param token0 address of the token0
    ///@param token1 address of the token1
    ///@param fee fee tier of the pool
    ///@param tickLower the lower bound of position
    ///@param tickUpper the upper bound of position
    ///@param amount0Desired amount of token0
    ///@param amount1Desired amount of token1
    function calLiquidityAndAmounts(
        address factory,
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) internal view returns (uint128 liquidity, uint256 amount0, uint256 amount1) {
        address poolAddress = UniswapHelper._getPool(factory, token0, token1, fee);

        IUniswapV3Pool pool = IUniswapV3Pool(poolAddress);
        (uint160 sqrtRatioX96, int24 tick, , , , , ) = pool.slot0();

        liquidity = UniswapHelper._getLiquidityFromAmounts(
            amount0Desired,
            amount1Desired,
            tickLower,
            tickUpper,
            sqrtRatioX96
        );

        (amount0, amount1) = UniswapHelper._getAmountsFromLiquidity(
            liquidity,
            tick,
            tickLower,
            tickUpper,
            sqrtRatioX96
        );
    }

    ///@notice find uniswap v3 deepest pool of specific pair
    ///@param factoryAddress address of the UniswapV3Factory
    ///@param token0 address of the token0
    ///@param token1 address of the token1
    ///@param feeTiers array of fee tiers to check
    function _findV3DeepestPool(
        address factoryAddress,
        address token0,
        address token1,
        uint24[] memory feeTiers
    ) internal view returns (address deepestPool) {
        uint128 largestLiquidity;

        for (uint256 i; i < feeTiers.length; ++i) {
            if (feeTiers[i] == 0) {
                continue;
            }

            address _poolAddress = IUniswapV3Factory(factoryAddress).getPool(token0, token1, feeTiers[i]);

            if (_poolAddress == address(0)) {
                continue;
            }

            uint128 _liquidity = IUniswapV3Pool(_poolAddress).liquidity();

            (deepestPool, largestLiquidity) = _liquidity > largestLiquidity
                ? (_poolAddress, _liquidity)
                : (deepestPool, largestLiquidity);
        }

        require(deepestPool != address(0), "UHDP0");
    }

    ///@notice check if the pool exist
    ///@param factoryAddress address of the UniswapV3Factory
    ///@param token0 address of the token0
    ///@param token1 address of the token1
    ///@param feeTiers array of fee tiers to check
    function _isPoolExist(
        address factoryAddress,
        address token0,
        address token1,
        uint24[] memory feeTiers
    ) internal view returns (bool) {
        for (uint256 i = 0; i < feeTiers.length; ++i) {
            if (feeTiers[i] == 0) {
                continue;
            }

            address pool = IUniswapV3Factory(factoryAddress).getPool(token0, token1, feeTiers[i]);
            if (pool != address(0)) {
                return true;
            }
        }
        return false;
    }

    function _getDepositCurrentTick(
        address factoryAddress,
        address token0,
        address token1,
        uint24 fee
    ) internal view returns (int24 currentTick) {
        return _adjustDepositTick(factoryAddress, _getCurrentTick(factoryAddress, token0, token1, fee), fee);
    }

    function _getCurrentTick(
        address factoryAddress,
        address token0,
        address token1,
        uint24 fee
    ) internal view returns (int24 currentTick) {
        address pool = IUniswapV3Factory(factoryAddress).getPool(token0, token1, fee);
        require(pool != address(0), "UHP0");

        (, currentTick, , , , , ) = IUniswapV3Pool(pool).slot0();
    }

    function _adjustDepositTick(
        address factoryAddress,
        int24 currentTick,
        uint24 fee
    ) internal view returns (int24 currentTickAdjusted) {
        // fee amount tick spacing
        // 100: 1
        // 500: 10
        // 3000: 60
        // 10000: 200
        currentTickAdjusted = currentTick;
        int24 tickSpacing = IUniswapV3Factory(factoryAddress).feeAmountTickSpacing(fee);
        if (tickSpacing > 1) {
            if (currentTick > 0) {
                int24 half = tickSpacing.div(2);
                int24 remainder = currentTick.mod(tickSpacing);
                if (remainder >= half) {
                    currentTickAdjusted = currentTick.sub(remainder).add(tickSpacing);
                } else {
                    currentTickAdjusted = currentTick.sub(remainder);
                }
            } else if (currentTick < 0) {
                int24 half = -tickSpacing.div(2);
                int24 remainder = currentTick.mod(tickSpacing);
                if (remainder <= half) {
                    currentTickAdjusted = currentTick.sub(remainder).sub(tickSpacing);
                } else {
                    currentTickAdjusted = currentTick.sub(remainder);
                }
            }
        }
    }
}
