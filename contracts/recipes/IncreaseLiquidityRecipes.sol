// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "../interfaces/recipes/IIncreaseLiquidityRecipes.sol";
import "../interfaces/actions/IIncreaseLiquidity.sol";
import "../interfaces/actions/ISingleTokenIncreaseLiquidity.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/IPositionManagerFactory.sol";
import "../interfaces/IUniswapAddressHolder.sol";
import "../interfaces/IRegistry.sol";
import "../interfaces/IERC20Extended.sol";
import "../libraries/UniswapHelper.sol";
import "../libraries/SwapHelper.sol";
import "../libraries/SafeInt24Math.sol";
import "./BaseRecipes.sol";

///@notice IncreaseLiquidityRecipes allows user to fill their position manager with UniswapV3 positions
///        by depositing an already minted NFT or by minting directly a new one
contract IncreaseLiquidityRecipes is BaseRecipes, IIncreaseLiquidityRecipes {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using SafeInt24Math for int24;

    IUniswapAddressHolder public immutable uniswapAddressHolder;

    constructor(address _registryAddressHolder, address _uniswapAddressHolder) BaseRecipes(_registryAddressHolder) {
        require(_uniswapAddressHolder != address(0), "ILRUAH0");
        uniswapAddressHolder = IUniswapAddressHolder(_uniswapAddressHolder);
    }

    ///@notice increases liquidity of a position
    ///@param input struct of IncreaseLiquidityInput parameters
    function increaseLiquidity(IncreaseLiquidityInput memory input) external whenNotPaused {
        require(input.amount0Desired != 0 || input.amount1Desired != 0, "DRA0");
        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(msg.sender);
        require(positionManager != address(0), "DRPM0");

        IPositionManager.PositionInfo memory pInfo = IPositionManager(positionManager).getPositionInfo(
            input.positionId
        );

        UniswapHelper.getTokensOutput memory tokensOutput = UniswapHelper.getTokens(
            pInfo.tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );

        ///@dev calculate the correct amounts before transferring tokens to position manager
        (, input.amount0Desired, input.amount1Desired) = UniswapHelper.calLiquidityAndAmounts(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            tokensOutput.token0,
            tokensOutput.token1,
            tokensOutput.fee,
            tokensOutput.tickLower,
            tokensOutput.tickUpper,
            input.amount0Desired,
            input.amount1Desired
        );

        ///@dev send tokens to position manager to be able to call the increase liquidity action
        IERC20(tokensOutput.token0).safeTransferFrom(msg.sender, positionManager, input.amount0Desired);
        IERC20(tokensOutput.token1).safeTransferFrom(msg.sender, positionManager, input.amount1Desired);

        (uint256 amount0Increased, uint256 amount1Increased) = IIncreaseLiquidity(positionManager).increaseLiquidity(
            IIncreaseLiquidity.IncreaseLiquidityInput({
                tokenId: pInfo.tokenId,
                token0Address: tokensOutput.token0,
                token1Address: tokensOutput.token1,
                amount0Desired: input.amount0Desired,
                amount1Desired: input.amount1Desired
            })
        );

        uint24[] memory allowableFeeTiers = registry().getAllowableFeeTiers();

        IPositionManager(positionManager).middlewareIncreaseLiquidity(
            input.positionId,
            pInfo.amount0Deposited.add(amount0Increased),
            pInfo.amount1Deposited.add(amount1Increased),
            pInfo.amount0DepositedUsdValue.add(
                SwapHelper.getQuoteFromDeepestPool(
                    uniswapAddressHolder.uniswapV3FactoryAddress(),
                    tokensOutput.token0,
                    registry().usdValueTokenAddress(),
                    amount0Increased,
                    allowableFeeTiers
                )
            ),
            pInfo.amount1DepositedUsdValue.add(
                SwapHelper.getQuoteFromDeepestPool(
                    uniswapAddressHolder.uniswapV3FactoryAddress(),
                    tokensOutput.token1,
                    registry().usdValueTokenAddress(),
                    amount1Increased,
                    allowableFeeTiers
                )
            ),
            pInfo.amount0Leftover,
            pInfo.amount1Leftover
        );

        emit PositionIncreasedLiquidity(positionManager, msg.sender, input.positionId);
    }

    ///@notice increases liquidity of a position with sigle token
    ///@param input struct of SingleTokenIncreaseLiquidityInput parameters
    function singleTokenIncreaseLiquidity(SingleTokenIncreaseLiquidityInput memory input) external whenNotPaused {
        require(input.amount != 0, "DRA0");
        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(msg.sender);
        require(positionManager != address(0), "DRPM0");

        IPositionManager.PositionInfo memory pInfo = IPositionManager(positionManager).getPositionInfo(
            input.positionId
        );

        UniswapHelper.getTokensOutput memory tokensOutput = UniswapHelper.getTokens(
            pInfo.tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );

        ///@dev send tokens to position manager to be able to call the sigleTokenIncreaseLiquidity action
        IERC20(input.isToken0In ? tokensOutput.token0 : tokensOutput.token1).safeTransferFrom(
            msg.sender,
            positionManager,
            input.amount
        );

        ISingleTokenIncreaseLiquidity.SingleTokenIncreaseLiquidityOutput
            memory stilOutput = ISingleTokenIncreaseLiquidity(positionManager).singleTokenIncreaseLiquidity(
                ISingleTokenIncreaseLiquidity.SingleTokenIncreaseLiquidityInput({
                    tokenId: pInfo.tokenId,
                    token0: tokensOutput.token0,
                    token1: tokensOutput.token1,
                    isToken0In: input.isToken0In,
                    amountIn: input.amount,
                    tickLower: tokensOutput.tickLower,
                    tickUpper: tokensOutput.tickUpper,
                    fee: tokensOutput.fee
                })
            );

        uint24[] memory allowableFeeTiers = registry().getAllowableFeeTiers();
        IPositionManager(positionManager).middlewareIncreaseLiquidity(
            input.positionId,
            pInfo.amount0Deposited.add(stilOutput.amount0Increased),
            pInfo.amount1Deposited.add(stilOutput.amount1Increased),
            pInfo.amount0DepositedUsdValue.add(
                SwapHelper.getQuoteFromDeepestPool(
                    uniswapAddressHolder.uniswapV3FactoryAddress(),
                    tokensOutput.token0,
                    registry().usdValueTokenAddress(),
                    stilOutput.amount0Increased,
                    allowableFeeTiers
                )
            ),
            pInfo.amount1DepositedUsdValue.add(
                SwapHelper.getQuoteFromDeepestPool(
                    uniswapAddressHolder.uniswapV3FactoryAddress(),
                    tokensOutput.token1,
                    registry().usdValueTokenAddress(),
                    stilOutput.amount1Increased,
                    allowableFeeTiers
                )
            ),
            pInfo.amount0Leftover.add(stilOutput.amount0Leftover),
            pInfo.amount1Leftover.add(stilOutput.amount1Leftover)
        );

        emit PositionIncreasedLiquidity(positionManager, msg.sender, input.positionId);
    }
}
