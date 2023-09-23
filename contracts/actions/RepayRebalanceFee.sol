// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "../libraries/ERC20Helper.sol";
import "../libraries/UniswapHelper.sol";
import "../libraries/SwapHelper.sol";
import "../Storage.sol";
import "../interfaces/actions/IRepayRebalanceFee.sol";
import "../interfaces/IRegistry.sol";
import "../interfaces/IERC20Extended.sol";
import "../interfaces/IWETH9.sol";
import "../libraries/MathHelper.sol";

///@notice action to repay rebalance fee
contract RepayRebalanceFee is IRepayRebalanceFee {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    ///@notice repay rebalance fee to keeper
    ///@param inputs struct of repayRebalanceFee parameters
    function repayRebalanceFee(
        IRepayRebalanceFee.RepayRebalanceFeeInput calldata inputs
    ) external payable override returns (RepayRebalanceFeeOutput memory outputs) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();
        IRegistry registry = IRegistry(Storage.registryAddressHolder.registry());
        uint24[] memory allowableFeeTiers = registry.getAllowableFeeTiers();

        address weth9MiddleTokenDeepestPool = UniswapHelper.findV3DeepestPool(
            Storage.uniswapAddressHolder.uniswapV3FactoryAddress(),
            registry.weth9(),
            registry.usdValueTokenAddress(),
            allowableFeeTiers
        );

        uint256 weth9MiddleTokenValue;
        {
            // scope to avoid stack too deep errors
            (uint160 weth9MiddleTokenSqrtPriceX96, , , , , , ) = IUniswapV3Pool(weth9MiddleTokenDeepestPool).slot0();
            weth9MiddleTokenValue = SwapHelper.getQuoteFromSqrtRatioX96(
                weth9MiddleTokenSqrtPriceX96,
                MathHelper.fromUint256ToUint128(inputs.rebalanceFee),
                registry.weth9(),
                registry.usdValueTokenAddress()
            );
        }

        address token0MiddleTokenDeepestPool;
        address token1MiddleTokenDeepestPool;
        {
            // scope to avoid stack too deep errors
            uint256 token0MiddleTokenPrice;
            if (inputs.token0 != registry.usdValueTokenAddress()) {
                token0MiddleTokenDeepestPool = UniswapHelper.findV3DeepestPool(
                    Storage.uniswapAddressHolder.uniswapV3FactoryAddress(),
                    inputs.token0,
                    registry.usdValueTokenAddress(),
                    allowableFeeTiers
                );
                (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(token0MiddleTokenDeepestPool).slot0();

                token0MiddleTokenPrice = SwapHelper.getPrice(
                    sqrtPriceX96,
                    inputs.token0,
                    registry.usdValueTokenAddress()
                );
            } else {
                token0MiddleTokenPrice = SwapHelper.getPriceWithSameToken(inputs.token0);
            }

            uint256 token1MiddleTokenPrice;
            if (inputs.token1 != registry.usdValueTokenAddress()) {
                token1MiddleTokenDeepestPool = UniswapHelper.findV3DeepestPool(
                    Storage.uniswapAddressHolder.uniswapV3FactoryAddress(),
                    inputs.token1,
                    registry.usdValueTokenAddress(),
                    allowableFeeTiers
                );
                uint160 sqrtPriceX96;

                (sqrtPriceX96, , , , , , ) = IUniswapV3Pool(token1MiddleTokenDeepestPool).slot0();

                token1MiddleTokenPrice = SwapHelper.getPrice(
                    sqrtPriceX96,
                    inputs.token1,
                    registry.usdValueTokenAddress()
                );
            } else {
                token1MiddleTokenPrice = SwapHelper.getPriceWithSameToken(inputs.token1);
            }

            (outputs.token0Repaid, outputs.token1Repaid) = SwapHelper.distributeTargetAmount(
                inputs.token0,
                inputs.token1,
                inputs.amount0Quota,
                inputs.amount1Quota,
                token0MiddleTokenPrice,
                token1MiddleTokenPrice,
                weth9MiddleTokenValue
            );
            require(outputs.token0Repaid <= inputs.amount0Quota, "RRFR");
            require(outputs.token1Repaid <= inputs.amount1Quota, "RRFR");
        }
        {
            // scope to avoid stack too deep errors
            uint256 totalDeductMiddleAmount;
            if (outputs.token0Repaid > 0) {
                if (inputs.token0 == registry.weth9()) {
                    outputs.totalWETH9Repaid = outputs.totalWETH9Repaid.add(outputs.token0Repaid);
                } else if (inputs.token0 == registry.usdValueTokenAddress()) {
                    totalDeductMiddleAmount = totalDeductMiddleAmount.add(outputs.token0Repaid);
                } else {
                    uint256 deductMiddleAmount0Out = _swap(
                        Storage.uniswapAddressHolder.swapRouterAddress(),
                        token0MiddleTokenDeepestPool,
                        inputs.token0,
                        registry.usdValueTokenAddress(),
                        outputs.token0Repaid,
                        registry.maxTwapDeviation(),
                        registry.twapDuration()
                    );

                    totalDeductMiddleAmount = totalDeductMiddleAmount.add(deductMiddleAmount0Out);
                }
            }

            if (outputs.token1Repaid > 0) {
                if (inputs.token1 == registry.weth9()) {
                    outputs.totalWETH9Repaid = outputs.totalWETH9Repaid.add(outputs.token1Repaid);
                } else if (inputs.token1 == registry.usdValueTokenAddress()) {
                    totalDeductMiddleAmount = totalDeductMiddleAmount.add(outputs.token1Repaid);
                } else {
                    uint256 deductMiddleAmount1Out = _swap(
                        Storage.uniswapAddressHolder.swapRouterAddress(),
                        token1MiddleTokenDeepestPool,
                        inputs.token1,
                        registry.usdValueTokenAddress(),
                        outputs.token1Repaid,
                        registry.maxTwapDeviation(),
                        registry.twapDuration()
                    );
                    totalDeductMiddleAmount = totalDeductMiddleAmount.add(deductMiddleAmount1Out);
                }
            }

            if (totalDeductMiddleAmount > 0) {
                uint256 deductWETH9AmountOut = _swap(
                    Storage.uniswapAddressHolder.swapRouterAddress(),
                    weth9MiddleTokenDeepestPool,
                    registry.usdValueTokenAddress(),
                    registry.weth9(),
                    totalDeductMiddleAmount,
                    registry.maxTwapDeviation(),
                    registry.twapDuration()
                );

                outputs.totalWETH9Repaid = outputs.totalWETH9Repaid.add(deductWETH9AmountOut);
            }
        }

        ///@dev repay rebalance fee
        if (outputs.totalWETH9Repaid > 0) {
            ///@dev withdraw weth9
            IWETH9(registry.weth9()).withdraw(outputs.totalWETH9Repaid);

            (bool sent, ) = inputs.receiver.call{ value: outputs.totalWETH9Repaid }("");

            require(sent, "RBFSE");
        }
        emit RebalanceFeeRepaid(address(this), outputs.token0Repaid, outputs.token1Repaid, outputs.totalWETH9Repaid);
    }

    function _swap(
        address swapRouterAddress,
        address deepestPool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        int24 maxTwapDeviation,
        uint32 twapDuration
    ) internal returns (uint256 amountOut) {
        SwapHelper.checkDeviation(IUniswapV3Pool(deepestPool), maxTwapDeviation, twapDuration);

        ERC20Helper.approveToken(tokenIn, swapRouterAddress, amountIn);

        //snapshot balance before swap
        uint256 tokenInBalanceBeforeSwap = IERC20(tokenIn).balanceOf(address(this));

        amountOut = ISwapRouter(swapRouterAddress).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: IUniswapV3Pool(deepestPool).fee(),
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                //NOTE slippage protection by using amountOutMinimum, sqrtPriceLimitX96
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        //check the balance after swap
        require(tokenInBalanceBeforeSwap.sub(amountIn) == IERC20(tokenIn).balanceOf(address(this)), "SL");
    }
}
