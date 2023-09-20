// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "../libraries/ERC20Helper.sol";
import "../libraries/UniswapHelper.sol";
import "../libraries/SwapHelper.sol";
import "../Storage.sol";
import "../interfaces/actions/ISingleTokenIncreaseLiquidity.sol";

///@notice action to increase the liquidity of a V3 position
contract SingleTokenIncreaseLiquidity is ISingleTokenIncreaseLiquidity {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    ///@notice increase the liquidity of a UniswapV3 position
    ///@param inputs struct of SingleTokenIncreaseLiquidityInput parameters
    ///@return outputs struct of SingleTokenIncreaseLiquidityOutput parameters
    function singleTokenIncreaseLiquidity(
        SingleTokenIncreaseLiquidityInput calldata inputs
    ) external override returns (SingleTokenIncreaseLiquidityOutput memory outputs) {
        require(inputs.amountIn != 0, "ILA");

        StorageStruct storage Storage = PositionManagerStorage.getStorage();
        IRegistry registry = IRegistry(Storage.registryAddressHolder.registry());

        uint24[] memory allowableFeeTiers = registry.getAllowableFeeTiers();

        uint256 amountToSwap;
        IUniswapV3Pool deepestPool;
        {
            deepestPool = IUniswapV3Pool(
                UniswapHelper._findV3DeepestPool(
                    Storage.uniswapAddressHolder.uniswapV3FactoryAddress(),
                    inputs.token0,
                    inputs.token1,
                    allowableFeeTiers
                )
            );

            IUniswapV3Pool depositPool = IUniswapV3Pool(
                UniswapHelper._getPool(
                    Storage.uniswapAddressHolder.uniswapV3FactoryAddress(),
                    inputs.token0,
                    inputs.token1,
                    inputs.fee
                )
            );

            (uint160 sqrtPriceX96, , , , , , ) = deepestPool.slot0();
            (uint160 sqrtRatioX96, , , , , , ) = depositPool.slot0();

            (amountToSwap, ) = SwapHelper.calcAmountToSwap(
                sqrtRatioX96,
                inputs.tickLower,
                inputs.tickUpper,
                sqrtPriceX96,
                inputs.isToken0In ? inputs.amountIn : 0,
                inputs.isToken0In ? 0 : inputs.amountIn
            );
        }

        uint256 amountOut;
        if (amountToSwap != 0) {
            amountOut = _swap(
                address(deepestPool),
                inputs.isToken0In ? inputs.token0 : inputs.token1,
                inputs.isToken0In ? inputs.token1 : inputs.token0,
                amountToSwap
            );
        }

        (
            outputs.amount0Increased,
            outputs.amount1Increased,
            outputs.amount0Leftover,
            outputs.amount1Leftover
        ) = _increaseLiquidity(
            inputs.tokenId,
            inputs.token0,
            inputs.token1,
            inputs.isToken0In ? inputs.amountIn.sub(amountToSwap) : amountOut,
            inputs.isToken0In ? amountOut : inputs.amountIn.sub(amountToSwap)
        );

        emit LiquidityIncreasedWithSingleToken(
            address(this),
            inputs.tokenId,
            inputs.isToken0In ? inputs.token0 : inputs.token1,
            inputs.amountIn,
            outputs.amount0Increased,
            outputs.amount1Increased,
            outputs.amount0Leftover,
            outputs.amount1Leftover
        );
    }

    function _swap(
        address deepestPool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();
        IRegistry registry = IRegistry(Storage.registryAddressHolder.registry());

        SwapHelper.checkDeviation(IUniswapV3Pool(deepestPool), registry.maxTwapDeviation(), registry.twapDuration());

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
                //NOTE slippage protection by using amountOutMinimum, sqrtPriceLimitX96
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        //check the balance after swap
        require(tokenInBalanceBeforeSwap.sub(amountIn) == IERC20(tokenIn).balanceOf(address(this)), "SL");
    }

    function _increaseLiquidity(
        uint256 tokenId,
        address token0Address,
        address token1Address,
        uint256 amount0Desired,
        uint256 amount1Desired
    )
        internal
        returns (uint256 amount0Increased, uint256 amount1Increased, uint256 amount0Leftover, uint256 amount1Leftover)
    {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();

        address nonfungiblePositionManagerAddress = Storage.uniswapAddressHolder.nonfungiblePositionManagerAddress();

        ERC20Helper._approveToken(token0Address, nonfungiblePositionManagerAddress, amount0Desired);
        ERC20Helper._approveToken(token1Address, nonfungiblePositionManagerAddress, amount1Desired);

        INonfungiblePositionManager.IncreaseLiquidityParams memory params = INonfungiblePositionManager
            .IncreaseLiquidityParams({
                tokenId: tokenId,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp
            });
        (, amount0Increased, amount1Increased) = INonfungiblePositionManager(nonfungiblePositionManagerAddress)
            .increaseLiquidity(params);

        amount0Leftover = amount0Desired.sub(amount0Increased);
        amount1Leftover = amount1Desired.sub(amount1Increased);
    }
}
