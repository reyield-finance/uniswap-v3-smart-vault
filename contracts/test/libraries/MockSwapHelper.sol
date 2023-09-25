// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../../libraries/SwapHelper.sol";

contract MockSwapHelper {
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
    ) public pure returns (uint256 ratioX96) {
        return SwapHelper.getRatioFromRange(sqrtRatioX96, sqrtRatioAX96, sqrtRatioBX96);
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
    ) public pure returns (uint256, bool) {
        return SwapHelper.calcAmountToSwap(sqrtRatioX96, tickLower, tickUpper, sqrtPriceX96, amount0In, amount1In);
    }

    function distributeTargetAmount(
        uint8 token0Decimals,
        uint8 token1Decimals,
        uint256 amount0,
        uint256 amount1,
        uint256 price0,
        uint256 price1,
        uint256 targetAmount
    ) public pure returns (uint256 amount0Distributed, uint256 amount1Distributed) {
        uint256 denominator = FullMath.mulDiv(amount0, price0, uint256(10 ** (token0Decimals))).add(
            FullMath.mulDiv(amount1, price1, uint256(10 ** (token1Decimals)))
        );

        require(denominator >= targetAmount && denominator > 0, "DTA");

        amount0Distributed = FullMath.mulDiv(amount0, targetAmount, denominator);
        amount1Distributed = FullMath.mulDiv(amount1, targetAmount, denominator);
    }

    function getPrice(
        uint160 sqrtPriceX96,
        address token,
        address tokenQuote,
        uint8 tokenDecimals
    ) public pure returns (uint256) {
        if (token == tokenQuote) {
            return getPriceWithSameToken(tokenDecimals);
        }
        return getQuoteFromSqrtRatioX96(sqrtPriceX96, uint128(10 ** tokenDecimals), token, tokenQuote);
    }

    function getPriceWithSameToken(uint8 tokenDecimals) public pure returns (uint256) {
        return 10 ** tokenDecimals;
    }

    function getQuoteFromSqrtRatioX96(
        uint160 sqrtRatioX96,
        uint128 baseAmount,
        address baseToken,
        address quoteToken
    ) public pure returns (uint256 quoteAmount) {
        return SwapHelper.getQuoteFromSqrtRatioX96(sqrtRatioX96, baseAmount, baseToken, quoteToken);
    }

    function getQuoteFromDeepestPool(
        address factoryAddress,
        address baseToken,
        address quoteToken,
        uint128 baseAmount,
        uint24[] memory feeTiers
    ) external view returns (uint256 quoteAmount) {
        return SwapHelper.getQuoteFromDeepestPool(factoryAddress, baseToken, quoteToken, baseAmount, feeTiers);
    }
}
