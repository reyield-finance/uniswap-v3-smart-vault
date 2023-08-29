// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/libraries/FullMath.sol";
import "../libraries/ERC20Helper.sol";
import "../libraries/UniswapHelper.sol";
import "../libraries/SwapHelper.sol";
import "../Storage.sol";
import "../interfaces/actions/IShareProfit.sol";
import "../interfaces/IRegistry.sol";
import "../interfaces/IERC20Extended.sol";
import "../libraries/MathHelper.sol";

///@notice action to share profit
contract ShareProfit is IShareProfit {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    ///@notice share profit
    ///@param inputs struct of shareProfit parameters
    function shareProfit(
        ShareProfitInput calldata inputs
    ) external override returns (ShareProfitOutput memory outputs) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();
        uint24[] memory allowableFeeTiers = Storage.registry.getAllowableFeeTiers();

        uint256 amount0PerformanceFee;
        uint256 amount1PerformanceFee;
        {
            uint256 token0UsdValue;
            uint256 token0UsdPrice;
            if (inputs.token0 != Storage.registry.usdValueTokenAddress()) {
                address token0UsdValueTokenDeepestPool = UniswapHelper._findV3DeepestPool(
                    Storage.uniswapAddressHolder.uniswapV3FactoryAddress(),
                    inputs.token0,
                    Storage.registry.usdValueTokenAddress(),
                    allowableFeeTiers
                );

                (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(token0UsdValueTokenDeepestPool).slot0();
                token0UsdValue = SwapHelper.getQuoteFromSqrtRatioX96(
                    sqrtPriceX96,
                    MathHelper.fromUint256ToUint128(inputs.amount0),
                    inputs.token0,
                    Storage.registry.usdValueTokenAddress()
                );

                token0UsdPrice = SwapHelper.getPrice(
                    sqrtPriceX96,
                    inputs.token0,
                    Storage.registry.usdValueTokenAddress()
                );
            } else {
                token0UsdValue = inputs.amount0;
                token0UsdPrice = SwapHelper.getPriceWithSameToken(inputs.token0);
            }

            uint256 token1UsdValue;
            uint256 token1UsdPrice;
            if (inputs.token1 != Storage.registry.usdValueTokenAddress()) {
                address token1UsdValueTokenDeepestPool = UniswapHelper._findV3DeepestPool(
                    Storage.uniswapAddressHolder.uniswapV3FactoryAddress(),
                    inputs.token1,
                    Storage.registry.usdValueTokenAddress(),
                    allowableFeeTiers
                );

                (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(token1UsdValueTokenDeepestPool).slot0();
                token1UsdValue = SwapHelper.getQuoteFromSqrtRatioX96(
                    sqrtPriceX96,
                    MathHelper.fromUint256ToUint128(inputs.amount1),
                    inputs.token1,
                    Storage.registry.usdValueTokenAddress()
                );

                token1UsdPrice = SwapHelper.getPrice(
                    sqrtPriceX96,
                    inputs.token1,
                    Storage.registry.usdValueTokenAddress()
                );
            } else {
                token1UsdValue = inputs.amount1;
                token1UsdPrice = SwapHelper.getPriceWithSameToken(inputs.token1);
            }

            if (token0UsdValue.add(token1UsdValue) > inputs.originalDepositUsdValue) {
                uint256 performanceFeeUsd = _calPerformanceFee(
                    token0UsdValue.add(token1UsdValue).sub(inputs.originalDepositUsdValue),
                    inputs.performanceFeeRatio
                );

                (amount0PerformanceFee, amount1PerformanceFee) = SwapHelper.distributeTargetAmount(
                    inputs.token0,
                    inputs.token1,
                    inputs.amount0,
                    inputs.amount1,
                    token0UsdPrice,
                    token1UsdPrice,
                    performanceFeeUsd
                );
            }
        }

        {
            uint256 amount0PerformanceFeeDistributed;
            uint256 amount1PerformanceFeeDistributed;

            (amount0PerformanceFeeDistributed, amount1PerformanceFeeDistributed) = _determineTokensReceived(
                inputs.token0,
                inputs.token1,
                inputs.performanceFeeReceivedToken,
                amount0PerformanceFee,
                amount1PerformanceFee,
                allowableFeeTiers
            );

            (outputs.amount0Returned, outputs.amount1Returned) = _determineTokensReceived(
                inputs.token0,
                inputs.token1,
                inputs.returnedToken,
                inputs.amount0.sub(amount0PerformanceFee),
                inputs.amount1.sub(amount1PerformanceFee),
                allowableFeeTiers
            );

            _ShareResult memory result = _share(
                _ShareParams(
                    inputs.token0,
                    inputs.token1,
                    inputs.performanceFeeRecipient,
                    amount0PerformanceFeeDistributed,
                    amount1PerformanceFeeDistributed,
                    outputs.amount0Returned,
                    outputs.amount1Returned,
                    inputs.serviceFeeRatio
                )
            );

            emit ProfitShared(
                address(this),
                inputs.performanceFeeRecipient,
                result.performanceFeeAmount0,
                result.performanceFeeAmount1,
                result.serviceFeeAmount0,
                result.serviceFeeAmount1,
                result.returnedAmount0,
                result.returnedAmount1
            );
        }
    }

    function _calPerformanceFee(uint256 amount, uint24 ratio) internal pure returns (uint256) {
        uint256 MAX_RATIO = 10_000;
        return FullMath.mulDiv(amount, ratio, MAX_RATIO);
    }

    function _determineTokensReceived(
        address token0,
        address token1,
        address receivedToken,
        uint256 amount0,
        uint256 amount1,
        uint24[] memory allowableFeeTiers
    ) internal returns (uint256 amount0Received, uint256 amount1Received) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();

        address deepestPool = UniswapHelper._findV3DeepestPool(
            Storage.uniswapAddressHolder.uniswapV3FactoryAddress(),
            token0,
            token1,
            allowableFeeTiers
        );

        if (receivedToken == token0) {
            if (amount1 == 0) {
                amount0Received = amount0;
            } else {
                amount0Received = amount0.add(_swap(deepestPool, token1, receivedToken, amount1));
            }
        } else if (receivedToken == token1) {
            if (amount0 == 0) {
                amount1Received = amount1;
            } else {
                amount1Received = amount1.add(_swap(deepestPool, token0, receivedToken, amount0));
            }
        } else {
            amount0Received = amount0;
            amount1Received = amount1;
        }
    }

    function _calServiceFee(
        uint256 performanceFee,
        uint32 serviceFeeDenominator,
        uint32 serviceFeeRatio
    ) internal pure returns (uint256 serviceFee) {
        if (performanceFee > 0) {
            serviceFee = FullMath.mulDiv(performanceFee, serviceFeeRatio, serviceFeeDenominator);
        }
    }

    function _share(_ShareParams memory params) internal returns (_ShareResult memory result) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();

        uint256 amount0ServiceFee;
        uint256 amount1ServiceFee;
        if (params.amount0PerformanceFee > 0) {
            amount0ServiceFee = _calServiceFee(
                params.amount0PerformanceFee,
                Storage.registry.serviceFeeDenominator(),
                params.serviceFeeRatio
            );
            if (amount0ServiceFee > 0) {
                result.serviceFeeAmount0 = amount0ServiceFee;
                IERC20(params.token0).safeTransfer(Storage.registry.serviceFeeRecipient(), amount0ServiceFee);
            }

            if (params.amount0PerformanceFee > amount0ServiceFee) {
                result.performanceFeeAmount0 = params.amount0PerformanceFee.sub(amount0ServiceFee);
                IERC20(params.token0).safeTransfer(params.performanceFeeRecipient, result.performanceFeeAmount0);
            }
        }
        if (params.amount1PerformanceFee > 0) {
            amount1ServiceFee = _calServiceFee(
                params.amount1PerformanceFee,
                Storage.registry.serviceFeeDenominator(),
                params.serviceFeeRatio
            );
            if (amount1ServiceFee > 0) {
                result.serviceFeeAmount1 = amount1ServiceFee;
                IERC20(params.token1).safeTransfer(Storage.registry.serviceFeeRecipient(), amount1ServiceFee);
            }
            if (params.amount1PerformanceFee > amount1ServiceFee) {
                result.performanceFeeAmount1 = params.amount1PerformanceFee.sub(amount1ServiceFee);
                IERC20(params.token1).safeTransfer(params.performanceFeeRecipient, result.performanceFeeAmount1);
            }
        }

        if (params.amount0Returned > 0) {
            result.returnedAmount0 = params.amount0Returned;
            IERC20(params.token0).safeTransfer(Storage.owner, params.amount0Returned);
        }

        if (params.amount1Returned > 0) {
            result.returnedAmount1 = params.amount1Returned;
            IERC20(params.token1).safeTransfer(Storage.owner, params.amount1Returned);
        }
    }

    function _swap(
        address deepestPool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();

        SwapHelper.checkDeviation(
            IUniswapV3Pool(deepestPool),
            Storage.registry.maxTwapDeviation(),
            Storage.registry.twapDuration()
        );

        ERC20Helper._approveToken(tokenIn, Storage.uniswapAddressHolder.swapRouterAddress(), amountIn);

        //snapshot balance before swap
        uint256 tokenInBalanceBeforeSwap = IERC20(tokenIn).balanceOf(address(this));

        amountOut = ISwapRouter(Storage.uniswapAddressHolder.swapRouterAddress()).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: IUniswapV3Pool(deepestPool).fee(),
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                // TODO: slippage protection by using amountOutMinimum, sqrtPriceLimitX96
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        //check the balance after swap
        require(tokenInBalanceBeforeSwap.sub(amountIn) == IERC20(tokenIn).balanceOf(address(this)), "SL");
    }
}
