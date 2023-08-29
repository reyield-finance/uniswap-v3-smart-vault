// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "../libraries/UniswapHelper.sol";
import "../libraries/SwapHelper.sol";
import "../libraries/ERC20Helper.sol";
import "../Storage.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/actions/IZapIn.sol";

contract ZapIn is IZapIn {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    ///@notice mints a uni NFT with a single input token, the token in input must be one of the two token in the pool
    ///@param inputs struct of ZapInInput parameters
    ///@return outputs struct of ZapInOutput parameters
    function zapIn(ZapInInput calldata inputs) external override returns (ZapInOutput memory outputs) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();
        uint24[] memory allowableFeeTiers = Storage.registry.getAllowableFeeTiers();

        uint256 amountToSwap;
        {
            IUniswapV3Pool depositPool = IUniswapV3Pool(
                UniswapHelper._getPool(
                    Storage.uniswapAddressHolder.uniswapV3FactoryAddress(),
                    inputs.token0,
                    inputs.token1,
                    inputs.fee
                )
            );

            IUniswapV3Pool deepestPool = IUniswapV3Pool(
                UniswapHelper._findV3DeepestPool(
                    Storage.uniswapAddressHolder.uniswapV3FactoryAddress(),
                    inputs.token0,
                    inputs.token1,
                    allowableFeeTiers
                )
            );

            (amountToSwap, ) = SwapHelper.calcAmountToSwap(
                getSqrtRatioX96(depositPool),
                inputs.tickLower,
                inputs.tickUpper,
                getSqrtPriceX96(deepestPool),
                inputs.isToken0In ? inputs.amountIn : 0,
                inputs.isToken0In ? 0 : inputs.amountIn
            );
        }

        uint256 amount0Desired;
        uint256 amount1Desired;
        {
            IUniswapV3Pool deepestPool = IUniswapV3Pool(
                UniswapHelper._findV3DeepestPool(
                    Storage.uniswapAddressHolder.uniswapV3FactoryAddress(),
                    inputs.token0,
                    inputs.token1,
                    allowableFeeTiers
                )
            );
            (amount0Desired, amount1Desired) = _getDesiredAmounts(
                deepestPool,
                inputs.token0,
                inputs.token1,
                inputs.amountIn,
                inputs.isToken0In,
                amountToSwap
            );
        }

        (outputs.tokenId, outputs.amount0Deposited, outputs.amount1Deposited) = _mint(
            inputs.token0,
            inputs.token1,
            inputs.fee,
            inputs.tickLower,
            inputs.tickUpper,
            amount0Desired,
            amount1Desired
        );

        outputs.amount0Leftover = amount0Desired.sub(outputs.amount0Deposited);
        outputs.amount1Leftover = amount1Desired.sub(outputs.amount1Deposited);

        emit ZappedIn(
            address(this),
            outputs.tokenId,
            inputs.isToken0In ? inputs.token0 : inputs.token1,
            inputs.amountIn,
            outputs.amount0Deposited,
            outputs.amount1Deposited,
            outputs.amount0Leftover,
            outputs.amount1Leftover
        );
    }

    function getSqrtPriceX96(IUniswapV3Pool pool) internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96, , , , , , ) = pool.slot0();
    }

    function getSqrtRatioX96(IUniswapV3Pool pool) internal view returns (uint160 sqrtRatioX96) {
        (sqrtRatioX96, , , , , , ) = pool.slot0();
    }

    function _getDesiredAmounts(
        IUniswapV3Pool deepestPool,
        address token0,
        address token1,
        uint256 amountIn,
        bool isToken0In,
        uint256 amountToSwap
    ) internal returns (uint256 amount0Desired, uint256 amount1Desired) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();

        uint256 amountOut;
        if (amountToSwap != 0) {
            SwapHelper.checkDeviation(
                deepestPool,
                Storage.registry.maxTwapDeviation(),
                Storage.registry.twapDuration()
            );

            ERC20Helper._approveToken(
                isToken0In ? token0 : token1,
                Storage.uniswapAddressHolder.swapRouterAddress(),
                amountToSwap
            );

            //snapshot balance before swap
            uint256 tokenInBalanceBeforeSwap = IERC20(isToken0In ? token0 : token1).balanceOf(address(this));

            amountOut = ISwapRouter(Storage.uniswapAddressHolder.swapRouterAddress()).exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: isToken0In ? token0 : token1,
                    tokenOut: isToken0In ? token1 : token0,
                    fee: deepestPool.fee(),
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: amountToSwap,
                    // TODO: slippage protection by using amountOutMinimum, sqrtPriceLimitX96
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );

            //check the balance after swap
            require(
                tokenInBalanceBeforeSwap.sub(amountToSwap) ==
                    IERC20(isToken0In ? token0 : token1).balanceOf(address(this)),
                "SL"
            );
        }

        amount0Desired = isToken0In ? amountIn.sub(amountToSwap) : amountOut;
        amount1Desired = isToken0In ? amountOut : amountIn.sub(amountToSwap);
    }

    ///@notice mints a UniswapV3 position NFT
    ///@param token0Address address of the first token
    ///@param token1Address address of the second token
    ///@param fee pool fee level
    ///@param tickLower lower tick of the position
    ///@param tickUpper upper tick of the position
    ///@param amount0Desired amount of first token in position
    ///@param amount1Desired amount of second token in position
    function _mint(
        address token0Address,
        address token1Address,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) internal returns (uint256 tokenId, uint256 amount0Deposited, uint256 amount1Deposited) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();

        address nonfungiblePositionManagerAddress = Storage.uniswapAddressHolder.nonfungiblePositionManagerAddress();

        ERC20Helper._approveToken(token0Address, nonfungiblePositionManagerAddress, amount0Desired);
        ERC20Helper._approveToken(token1Address, nonfungiblePositionManagerAddress, amount1Desired);

        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager.MintParams({
            token0: token0Address,
            token1: token1Address,
            fee: fee,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: amount0Desired,
            amount1Desired: amount1Desired,
            amount0Min: 0,
            amount1Min: 0,
            recipient: address(this),
            deadline: block.timestamp
        });

        (tokenId, , amount0Deposited, amount1Deposited) = INonfungiblePositionManager(nonfungiblePositionManagerAddress)
            .mint(params);
    }
}
