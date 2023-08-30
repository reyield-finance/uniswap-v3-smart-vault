// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interfaces/IUniswapAddressHolder.sol";
import "../interfaces/IRegistry.sol";
import "../libraries/UniswapHelper.sol";
import "../libraries/SafeInt24Math.sol";

contract UniswapCalculator {
    using SafeInt24Math for int24;

    IUniswapAddressHolder public immutable uniswapAddressHolder;
    IRegistry public immutable registry;

    constructor(address _registry, address _uniswapAddressHolder) {
        uniswapAddressHolder = IUniswapAddressHolder(_uniswapAddressHolder);
        registry = IRegistry(_registry);
    }

    ///@notice Get the liquidity and amounts of a position
    ///@param token0 address of the token0
    ///@param token1 address of the token1
    ///@param fee fee tier of the pool
    ///@param tickLowerDiff the difference between current tick and lower bound of position
    ///@param tickUpperDiff the difference between current tick and lower bound of position
    ///@param amount0Desired amount of token0
    ///@param amount1Desired amount of token1
    function getLiquidityAndAmounts(
        address token0,
        address token1,
        uint24 fee,
        int24 tickLowerDiff,
        int24 tickUpperDiff,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) external view returns (uint128 liquidity, uint256 amount0, uint256 amount1) {
        address pool = IUniswapV3Factory(uniswapAddressHolder.uniswapV3FactoryAddress()).getPool(token0, token1, fee);

        require(pool != address(0), "UCP0");

        int24 currentTick = UniswapHelper._getDepositCurrentTick(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            token0,
            token1,
            fee
        );
        (liquidity, amount0, amount1) = UniswapHelper.calLiquidityAndAmounts(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            token0,
            token1,
            fee,
            currentTick.add(tickLowerDiff),
            currentTick.add(tickUpperDiff),
            amount0Desired,
            amount1Desired
        );
    }

    ///@notice get pool address of a pair of tokens
    ///@param token0 address of the token0
    ///@param token1 address of the token1
    ///@param fee fee tier of the pool
    function getPool(address token0, address token1, uint24 fee) external view returns (address pool) {
        pool = UniswapHelper._getPool(uniswapAddressHolder.uniswapV3FactoryAddress(), token0, token1, fee);
    }

    ///@notice reorder tokens to be in the same order as in the pool
    ///@param token0 address of the token0
    ///@param token1 address of the token1
    ///@return token0Reordered address of the token0
    ///@return token1Reordered address of the token1
    ///@return isOrderChanged true if the order of the tokens has changed
    function reorderTokens(
        address token0,
        address token1
    ) external pure returns (address token0Reordered, address token1Reordered, bool isOrderChanged) {
        (token0Reordered, token1Reordered, isOrderChanged) = UniswapHelper._reorderTokens(token0, token1);
    }

    ///@notice validate if a pool is valid
    ///@param token0 address of the token0
    ///@param token1 address of the token1
    ///@param fee fee tier of the pool
    ///@return true if the pool is valid
    function validatePool(address token0, address token1, uint24 fee) external view returns (bool) {
        address pool = IUniswapV3Factory(uniswapAddressHolder.uniswapV3FactoryAddress()).getPool(token0, token1, fee);

        return (token0 < token1 &&
            pool != address(0) &&
            checkTokenCanBeSwapToWETH9(token0) &&
            checkTokenCanBeSwapToWETH9(token1));
    }

    function checkTokenCanBeSwapToWETH9(address token) internal view returns (bool) {
        address weth = registry.weth9();
        address usdValueTokenAddress = registry.usdValueTokenAddress();

        if (token == weth || token == usdValueTokenAddress) {
            return true;
        }

        return isPoolExist(token, usdValueTokenAddress);
    }

    function isPoolExist(address token0, address token1) internal view returns (bool) {
        (token0, token1) = token0 < token1 ? (token0, token1) : (token1, token0);
        uint24[] memory feeTiers = registry.getFeeTiers();

        for (uint256 i = 0; i < feeTiers.length; ++i) {
            if (!registry.isAllowableFeeTier(feeTiers[i])) {
                continue;
            }
            address pool = IUniswapV3Factory(uniswapAddressHolder.uniswapV3FactoryAddress()).getPool(
                token0,
                token1,
                feeTiers[i]
            );
            if (pool != address(0)) {
                return true;
            }
        }
        return false;
    }
}
