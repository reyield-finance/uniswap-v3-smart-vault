// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@uniswap/v3-core/contracts/libraries/FixedPoint96.sol";
import "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import "@uniswap/v3-core/contracts/libraries/FullMath.sol";
import "@uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "../interfaces/IERC20Extended.sol";
import "./SafeInt24Math.sol";
import "./SafeInt56Math.sol";
import "./MathHelper.sol";
import "./UniswapHelper.sol";

///@title library to help with swap amounts calculations
library SwapHelper {
    uint8 internal constant RESOLUTION48 = 48;
    uint256 internal constant Q48 = 0x1000000000000;

    using SafeInt24Math for int24;
    using SafeInt56Math for int56;
    using SafeMath for uint256;

    ///@notice returns the amount of token1 needed for a mint for 1e18 token0
    ///@param sqrtRatioX96 sqrt ratio of the pool
    ///@param sqrtRatioAX96 sqrt ratio of lower tick of position
    ///@param sqrtRatioBX96 sqrt ratio of upper tick of position
    ///@return ratioX96 amount1/amount0 * 2**96
    function getRatioFromRange(
        uint160 sqrtRatioX96,
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96
    ) internal pure returns (uint256 ratioX96) {
        require(sqrtRatioAX96 < sqrtRatioX96 && sqrtRatioBX96 > sqrtRatioX96, "SHR");
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmount0(sqrtRatioX96, sqrtRatioBX96, Q48);
        (, ratioX96) = LiquidityAmounts.getAmountsForLiquidity(sqrtRatioX96, sqrtRatioAX96, sqrtRatioBX96, liquidity);
    }

    ///@notice calculate amount to be swapped in order to deposit according to the ratio selected position needs
    ///@param sqrtRatioX96 sqrt ratio of the pool
    ///@param tickLower lower tick of position
    ///@param tickUpper upper tick of position
    ///@param sqrtPriceX96 sqrt price of the pool to swap
    ///@param amount0In amount of token0 available
    ///@param amount1In amount of token1 available
    ///@return amountToSwap amount of token to be swapped
    ///@return token0In true if token0 is swapped for token1, false if token1 is swapped for token1
    function calcAmountToSwap(
        uint160 sqrtRatioX96,
        int24 tickLower,
        int24 tickUpper,
        uint160 sqrtPriceX96,
        uint256 amount0In,
        uint256 amount1In
    ) internal pure returns (uint256 amountToSwap, bool token0In) {
        require(amount0In != 0 || amount1In != 0, "SHA");

        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        //if current price >= tickUpper, then my range is under the current tick, so my position will all be in token1
        if (sqrtRatioX96 >= sqrtRatioBX96) {
            amountToSwap = amount0In;
            token0In = true;
        }
        //if current price  <= tickUpper, then my range is over the current tick, so my position will all be in token1
        else if (sqrtRatioX96 <= sqrtRatioAX96) {
            amountToSwap = amount1In;
            token0In = false;
        } else {
            uint256 ratioX96 = getRatioFromRange(sqrtRatioX96, sqrtRatioAX96, sqrtRatioBX96);
            uint256 valueX96 = (amount0In.mul((uint256(sqrtPriceX96) ** 2) >> FixedPoint96.RESOLUTION)).add(
                amount1In << FixedPoint96.RESOLUTION
            );

            uint256 amount0Post = valueX96.div(
                ((uint256(sqrtPriceX96) ** 2) >> FixedPoint96.RESOLUTION).add(ratioX96 << RESOLUTION48)
            );
            token0In = amount0Post < amount0In;

            if (token0In) {
                amountToSwap = amount0In.sub(amount0Post);
            } else {
                amountToSwap = amount1In.sub((amount0Post).mul(ratioX96) >> RESOLUTION48);
            }
        }
    }

    ///@notice Check price volatility is under specified threshold. This mitigates price manipulation during rebalance
    ///@param pool v3 pool
    ///@param maxTwapDeviation max deviation threshold from the twap tick price
    ///@param twapDuration duration of the twap oracle observations
    function checkDeviation(IUniswapV3Pool pool, int24 maxTwapDeviation, uint32 twapDuration) internal view {
        ///NOTE: MAX_TWAP_DEVIATION = 100  # 1% , TWAP_DURATION = 60  # 60 seconds
        if (twapDuration == 0) {
            //bypass check
            return;
        }
        (, int24 currentTick, , uint16 observationCardinality, , , ) = pool.slot0();
        if (observationCardinality == 0) {
            //bypass check
            return;
        }
        int24 twap = getTwap(pool, twapDuration);
        int24 deviation = currentTick > twap ? currentTick.sub(twap) : twap.sub(currentTick);
        require(deviation <= maxTwapDeviation, "SHD");
    }

    ///@notice Fetch time-weighted average price in ticks from Uniswap pool for specified duration
    ///@param pool v3 pool
    ///@param twapDuration duration of the twap oracle observations
    function getTwap(IUniswapV3Pool pool, uint32 twapDuration) internal view returns (int24) {
        require(twapDuration > 0, "SHGT");
        uint32[] memory secondsAgo = new uint32[](2);
        secondsAgo[0] = twapDuration;
        secondsAgo[1] = 0; // 0 is the most recent observation

        (int56[] memory tickCumulatives, ) = pool.observe(secondsAgo);

        return MathHelper.fromInt56ToInt24(tickCumulatives[1].sub(tickCumulatives[0]).div(int56(twapDuration)));
    }

    function distributeTargetAmount(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        uint256 price0,
        uint256 price1,
        uint256 targetAmount
    ) internal view returns (uint256 amount0Distributed, uint256 amount1Distributed) {
        uint256 denominator = FullMath.mulDiv(amount0, price0, uint256(10 ** (IERC20Extended(token0).decimals()))).add(
            FullMath.mulDiv(amount1, price1, uint256(10 ** (IERC20Extended(token1).decimals())))
        );

        require(denominator >= targetAmount && denominator > 0, "DTA");

        amount0Distributed = FullMath.mulDiv(amount0, targetAmount, denominator);
        amount1Distributed = FullMath.mulDiv(amount1, targetAmount, denominator);
    }

    function getPrice(uint160 sqrtPriceX96, address token, address tokenQuote) internal view returns (uint256) {
        if (token == tokenQuote) {
            return getPriceWithSameToken(token);
        }
        return
            getQuoteFromSqrtRatioX96(sqrtPriceX96, uint128(10 ** IERC20Extended(token).decimals()), token, tokenQuote);
    }

    function getPriceWithSameToken(address token) internal view returns (uint256) {
        return 10 ** IERC20Extended(token).decimals();
    }

    function getQuoteFromSqrtRatioX96(
        uint160 sqrtRatioX96,
        uint128 baseAmount,
        address baseToken,
        address quoteToken
    ) internal pure returns (uint256 quoteAmount) {
        // Calculate quoteAmount with better precision if it doesn't overflow when multiplied by itself
        if (sqrtRatioX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtRatioX96) * sqrtRatioX96;
            quoteAmount = baseToken < quoteToken
                ? FullMath.mulDiv(ratioX192, baseAmount, 1 << 192)
                : FullMath.mulDiv(1 << 192, baseAmount, ratioX192);
        } else {
            uint256 ratioX128 = FullMath.mulDiv(sqrtRatioX96, sqrtRatioX96, 1 << 64);
            quoteAmount = baseToken < quoteToken
                ? FullMath.mulDiv(ratioX128, baseAmount, 1 << 128)
                : FullMath.mulDiv(1 << 128, baseAmount, ratioX128);
        }
    }

    function getQuoteFromDeepestPool(
        address factoryAddress,
        address baseToken,
        address quoteToken,
        uint256 baseAmount,
        uint24[] memory feeTiers
    ) internal view returns (uint256 quoteAmount) {
        if (baseToken == quoteToken) {
            return baseAmount;
        }
        address deepestPool = UniswapHelper.findV3DeepestPool(factoryAddress, baseToken, quoteToken, feeTiers);

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(deepestPool).slot0();

        return
            getQuoteFromSqrtRatioX96(sqrtPriceX96, MathHelper.fromUint256ToUint128(baseAmount), baseToken, quoteToken);
    }
}
