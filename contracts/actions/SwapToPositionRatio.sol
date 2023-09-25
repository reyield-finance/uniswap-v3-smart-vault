// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../libraries/SwapHelper.sol";
import "../libraries/UniswapHelper.sol";
import "../libraries/ERC20Helper.sol";
import "../Storage.sol";
import "../interfaces/actions/ISwapToPositionRatio.sol";

///@notice action to swap to an exact position ratio
contract SwapToPositionRatio is ISwapToPositionRatio {
    using SafeMath for uint256;

    ///@notice performs swap to optimal ratio for the position at tickLower and tickUpper
    ///@param inputs struct containing the inputs for the swap
    ///@return amount0Out the new value of amount0
    ///@return amount1Out the new value of amount1
    function swapToPositionRatio(
        SwapToPositionInput memory inputs
    ) external override returns (uint256 amount0Out, uint256 amount1Out) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();
        IRegistry registry = IRegistry(Storage.registryAddressHolder.registry());

        uint24[] memory allowableFeeTiers = registry.getAllowableFeeTiers();

        {
            IUniswapV3Pool deepestPool = IUniswapV3Pool(
                UniswapHelper.findV3DeepestPool(
                    Storage.uniswapAddressHolder.uniswapV3FactoryAddress(),
                    inputs.token0Address,
                    inputs.token1Address,
                    allowableFeeTiers
                )
            );
            IUniswapV3Pool pool = IUniswapV3Pool(
                UniswapHelper.getPool(
                    Storage.uniswapAddressHolder.uniswapV3FactoryAddress(),
                    inputs.token0Address,
                    inputs.token1Address,
                    inputs.fee
                )
            );

            (amount0Out, amount1Out) = getAmount0OutAmount1Out(
                pool,
                deepestPool,
                inputs.token0Address,
                inputs.token1Address,
                inputs.amount0In,
                inputs.amount1In,
                inputs.tickLower,
                inputs.tickUpper
            );
        }

        emit SwappedToPositionRatio(address(this), inputs.amount0In, inputs.amount1In, amount0Out, amount1Out);
    }

    function getAmount0OutAmount1Out(
        IUniswapV3Pool pool,
        IUniswapV3Pool deepestPool,
        address token0,
        address token1,
        uint256 amount0In,
        uint256 amount1In,
        int24 tickLower,
        int24 tickUpper
    ) internal returns (uint256 amount0Out, uint256 amount1Out) {
        (uint160 sqrtRatioX96, , , , , , ) = pool.slot0();
        (uint160 sqrtPriceX96, , , , , , ) = deepestPool.slot0();

        (uint256 amountToSwap, bool isToken0In) = SwapHelper.calcAmountToSwap(
            sqrtRatioX96,
            tickLower,
            tickUpper,
            sqrtPriceX96,
            amount0In,
            amount1In
        );

        if (amountToSwap != 0) {
            uint256 amountSwapped = _swap(
                address(deepestPool),
                isToken0In ? token0 : token1,
                isToken0In ? token1 : token0,
                amountToSwap
            );

            ///@notice return the new amount of the token swapped and the token returned
            ///@dev token0AddressIn true amount 0 - amountToSwap  ------ amount 1 + amountSwapped
            ///@dev token0AddressIn false amount 0 + amountSwapped  ------ amount 1 - amountToSwap
            amount0Out = isToken0In ? amount0In.sub(amountToSwap) : amount0In.add(amountSwapped);
            amount1Out = isToken0In ? amount1In.add(amountSwapped) : amount1In.sub(amountToSwap);
        } else {
            amount0Out = amount0In;
            amount1Out = amount1In;
        }
    }

    ///@notice performs a swap
    ///@param deepestPool address of deepest pool
    ///@param tokenIn address of input token
    ///@param tokenOut address of output
    ///@param amountIn amount of tokenIn to swap
    function _swap(
        address deepestPool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();
        IRegistry registry = IRegistry(Storage.registryAddressHolder.registry());

        SwapHelper.checkDeviation(IUniswapV3Pool(deepestPool), registry.maxTwapDeviation(), registry.twapDuration());

        ERC20Helper.approveToken(tokenIn, Storage.uniswapAddressHolder.swapRouterAddress(), amountIn);

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
                //NOTE slippage protection by using amountOutMinimum, sqrtPriceLimitX96
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        //check the balance after swap
        require(tokenInBalanceBeforeSwap.sub(amountIn) == IERC20(tokenIn).balanceOf(address(this)), "SL");
    }
}
