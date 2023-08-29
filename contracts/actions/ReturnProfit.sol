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
import "../interfaces/actions/IReturnProfit.sol";
import "../interfaces/IRegistry.sol";

///@notice action to return profit
contract ReturnProfit is IReturnProfit {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    ///@notice return profit
    ///@param inputs struct of returnProfit parameters
    function returnProfit(
        IReturnProfit.ReturnProfitInput calldata inputs
    ) external override returns (IReturnProfit.ReturnProfitOutput memory outputs) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();
        uint24[] memory allowableFeeTiers = Storage.registry.getAllowableFeeTiers();

        address token0token1DeepestPool = UniswapHelper._findV3DeepestPool(
            Storage.uniswapAddressHolder.uniswapV3FactoryAddress(),
            inputs.token0,
            inputs.token1,
            allowableFeeTiers
        );

        (outputs.amount0Returned, outputs.amount1Returned) = _determineTokensReceived(
            token0token1DeepestPool,
            inputs.token0,
            inputs.token1,
            inputs.returnedToken,
            inputs.amount0,
            inputs.amount1
        );

        if (outputs.amount0Returned > 0) {
            IERC20(inputs.token0).safeTransfer(Storage.owner, outputs.amount0Returned);
        }

        if (outputs.amount1Returned > 0) {
            IERC20(inputs.token1).safeTransfer(Storage.owner, outputs.amount1Returned);
        }

        emit ProfitReturned(address(this), outputs.amount0Returned, outputs.amount1Returned);
    }

    function _determineTokensReceived(
        address deepestPool,
        address token0,
        address token1,
        address receivedToken,
        uint256 amount0,
        uint256 amount1
    ) internal returns (uint256 amount0Received, uint256 amount1Received) {
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
