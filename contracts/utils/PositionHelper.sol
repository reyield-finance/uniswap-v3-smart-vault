// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.7.6;
pragma abicoder v2;

import "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import "@uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/interfaces/pool/IUniswapV3PoolState.sol";
import "@uniswap/v3-core/contracts/libraries/FixedPoint128.sol";
import "@uniswap/v3-core/contracts/libraries/FullMath.sol";
import "@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol";
import "@uniswap/v3-periphery/contracts/libraries/PositionKey.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IUniswapAddressHolder.sol";
import "../interfaces/IRegistryAddressHolder.sol";
import "../interfaces/IRegistry.sol";
import "../libraries/UniswapHelper.sol";
import "../libraries/SwapHelper.sol";
import "../interfaces/IPositionManagerFactory.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/IStrategyProviderWalletFactory.sol";
import "../interfaces/IStrategyProviderWallet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract PositionHelper {
    using SafeMath for uint256;

    IRegistryAddressHolder public immutable registryAddressHolder;
    IUniswapAddressHolder public immutable uniswapAddressHolder;

    ///@notice restrict some function called only by governance
    modifier onlyGovernance() {
        require(msg.sender == registry().governance(), "PHOG");
        _;
    }

    constructor(address _registryAddressHolder, address _uniswapAddressHolder) {
        require(_registryAddressHolder != address(0), "PHRAH0");
        require(_uniswapAddressHolder != address(0), "PHUAH0");
        uniswapAddressHolder = IUniswapAddressHolder(_uniswapAddressHolder);
        registryAddressHolder = IRegistryAddressHolder(_registryAddressHolder);
    }

    ///@notice get IRegistry from registryAddressHolder
    ///@return IRegistry interface of registry
    function registry() private view returns (IRegistry) {
        return IRegistry(registryAddressHolder.registry());
    }

    ///@notice Get the position info of a position
    ///@param userAddress address of the user
    ///@param positionId ID of the position
    ///@return pInfo the position info
    function getPositionInfo(
        address userAddress,
        uint256 positionId
    ) public view returns (IPositionManager.PositionInfo memory pInfo) {
        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(userAddress);
        require(positionManager != address(0), "PHA0");

        pInfo = IPositionManager(positionManager).getPositionInfo(positionId);
    }

    ///@notice Get the position settlement of a position
    ///@param userAddress address of the user
    ///@param positionId ID of the position
    ///@return settlement the position settlement
    function getPositionSettlement(
        address userAddress,
        uint256 positionId
    ) public view returns (IPositionManager.PositionSettlement memory settlement) {
        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(userAddress);
        require(positionManager != address(0), "PHA0");

        settlement = IPositionManager(positionManager).getPositionSettlement(positionId);
    }

    struct PositionTokenInfo {
        uint256 tokenId;
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        address strategyProvider;
        bytes16 strategyId;
        uint256 amount0Deposited;
        uint256 amount1Deposited;
        uint256 amount0DepositedUsdValue;
        uint256 amount1DepositedUsdValue;
        int24 tickLowerDiff;
        int24 tickUpperDiff;
    }

    ///@notice Get the position token info of a position
    ///@param userAddress address of the user
    ///@param positionId ID of the position
    ///@return ptInfo the position token info
    function getPositionTokenInfo(
        address userAddress,
        uint256 positionId
    ) public view returns (PositionTokenInfo memory ptInfo) {
        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(userAddress);
        require(positionManager != address(0), "PHA0");

        IPositionManager.PositionInfo memory pInfo = IPositionManager(positionManager).getPositionInfo(positionId);
        UniswapHelper.getTokensOutput memory tokensOutput = UniswapHelper.getTokens(
            pInfo.tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );

        ptInfo = PositionTokenInfo({
            tokenId: pInfo.tokenId,
            token0: tokensOutput.token0,
            token1: tokensOutput.token1,
            fee: tokensOutput.fee,
            tickLower: tokensOutput.tickLower,
            tickUpper: tokensOutput.tickUpper,
            strategyProvider: pInfo.strategyProvider,
            strategyId: pInfo.strategyId,
            amount0Deposited: pInfo.amount0Deposited,
            amount1Deposited: pInfo.amount1Deposited,
            amount0DepositedUsdValue: pInfo.amount0DepositedUsdValue,
            amount1DepositedUsdValue: pInfo.amount1DepositedUsdValue,
            tickLowerDiff: pInfo.tickLowerDiff,
            tickUpperDiff: pInfo.tickUpperDiff
        });
    }

    ///@notice Get the tick info of a position
    ///@param userAddress address of the user
    ///@param positionId ID of the position
    ///@return currentTick the current tick of the target pool
    ///@return tickLower the lower bound of the position
    ///@return tickUpper the upper bound of the position
    function getTickInfo(
        address userAddress,
        uint256 positionId
    ) external view returns (int24 currentTick, int24 tickLower, int24 tickUpper) {
        IPositionManager.PositionInfo memory pInfo = getPositionInfo(userAddress, positionId);

        UniswapHelper.getTokensOutput memory tokensOutput = UniswapHelper.getTokens(
            pInfo.tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );
        address pool = UniswapHelper.getPool(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            tokensOutput.token0,
            tokensOutput.token1,
            tokensOutput.fee
        );

        (, currentTick, , , , , ) = IUniswapV3Pool(pool).slot0();
        tickLower = tokensOutput.tickLower;
        tickUpper = tokensOutput.tickUpper;
    }

    ///@notice the output struct of getAmounts
    ///@param amount0 amount of token0
    ///@param amount1 amount of token1
    ///@param amount0UsdValue amount of token0 in USD
    ///@param amount1UsdValue amount of token1 in USD
    struct GetAmountsOutput {
        address token0;
        address token1;
        uint256 amount0;
        uint256 amount1;
        uint256 amount0UsdValue;
        uint256 amount1UsdValue;
    }

    ///@notice Get the amounts of a position
    ///@param userAddress address of the user
    ///@param positionId ID of the position
    ///@return output the output struct of getAmounts
    function getAmounts(address userAddress, uint256 positionId) public view returns (GetAmountsOutput memory output) {
        IPositionManager.PositionInfo memory pInfo = getPositionInfo(userAddress, positionId);

        UniswapHelper.getTokensOutput memory tokensOutput = UniswapHelper.getTokens(
            pInfo.tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );
        output.token0 = tokensOutput.token0;
        output.token1 = tokensOutput.token1;

        address pool = UniswapHelper.getPool(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            output.token0,
            output.token1,
            tokensOutput.fee
        );

        (uint160 sqrtRatioX96, int24 currentTick, , , , , ) = IUniswapV3Pool(pool).slot0();

        (, , , , , , , uint128 liquidity, , , , ) = INonfungiblePositionManager(
            uniswapAddressHolder.nonfungiblePositionManagerAddress()
        ).positions(pInfo.tokenId);

        pInfo = getPositionInfo(userAddress, positionId);
        (output.amount0, output.amount1) = UniswapHelper.getAmountsFromLiquidity(
            liquidity,
            currentTick,
            tokensOutput.tickLower,
            tokensOutput.tickUpper,
            sqrtRatioX96
        );

        output.amount0 = output.amount0.add(pInfo.amount0Leftover);
        output.amount1 = output.amount1.add(pInfo.amount1Leftover);

        output.amount0UsdValue = quoteUsdValue(output.token0, output.amount0);
        output.amount1UsdValue = quoteUsdValue(output.token1, output.amount1);
    }

    ///@notice the output struct of getUncollectedFees
    ///@param token0 address of the token0
    ///@param token1 address of the token1
    ///@param tokensOwed0 amount of token0
    ///@param tokensOwed1 amount of token1
    ///@param amount0UsdValue amount of token0 in USD
    ///@param amount1UsdValue amount of token1 in USD
    struct GetUncollectedFeesOutput {
        address token0;
        address token1;
        uint128 amount0;
        uint128 amount1;
        uint256 amount0UsdValue;
        uint256 amount1UsdValue;
    }

    ///@notice Get the uncollected fees of a position
    ///@param userAddress address of the user
    ///@param positionId ID of the position
    ///@return output the output struct of getUncollectedFees
    function getUncollectedFees(
        address userAddress,
        uint256 positionId
    ) public view returns (GetUncollectedFeesOutput memory output) {
        IPositionManager.PositionInfo memory pInfo = getPositionInfo(userAddress, positionId);
        {
            uint128 liquidity;
            uint256 feeGrowthInside0LastX128;
            uint256 feeGrowthInside1LastX128;
            (
                ,
                ,
                output.token0,
                output.token1,
                ,
                ,
                ,
                liquidity,
                feeGrowthInside0LastX128,
                feeGrowthInside1LastX128,
                output.amount0,
                output.amount1
            ) = INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress()).positions(
                pInfo.tokenId
            );

            (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) = _getFeeGrowthInside(pInfo.tokenId);

            output.amount0 += uint128(
                FullMath.mulDiv(feeGrowthInside0X128 - feeGrowthInside0LastX128, liquidity, FixedPoint128.Q128)
            );
            output.amount1 += uint128(
                FullMath.mulDiv(feeGrowthInside1X128 - feeGrowthInside1LastX128, liquidity, FixedPoint128.Q128)
            );

            output.amount0UsdValue = quoteUsdValue(output.token0, output.amount0);
            output.amount1UsdValue = quoteUsdValue(output.token1, output.amount1);
        }
    }

    function _getFeeGrowthInside(
        uint256 tokenId
    ) internal view returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) {
        GetFeeGrowthInsideData memory data = _preLoadDataForGetFeeGrowthInside(tokenId);

        // calculate fee growth below
        uint256 feeGrowthBelow0X128;
        uint256 feeGrowthBelow1X128;
        if (data.tickCurrent >= data.tickLower) {
            feeGrowthBelow0X128 = data.lowerFeeGrowthOutside0X128;
            feeGrowthBelow1X128 = data.lowerFeeGrowthOutside1X128;
        } else {
            feeGrowthBelow0X128 = data.feeGrowthGlobal0X128 - data.lowerFeeGrowthOutside0X128;
            feeGrowthBelow1X128 = data.feeGrowthGlobal1X128 - data.lowerFeeGrowthOutside1X128;
        }

        // calculate fee growth above
        uint256 feeGrowthAbove0X128;
        uint256 feeGrowthAbove1X128;
        if (data.tickCurrent < data.tickUpper) {
            feeGrowthAbove0X128 = data.upperFeeGrowthOutside0X128;
            feeGrowthAbove1X128 = data.upperFeeGrowthOutside1X128;
        } else {
            feeGrowthAbove0X128 = data.feeGrowthGlobal0X128 - data.upperFeeGrowthOutside0X128;
            feeGrowthAbove1X128 = data.feeGrowthGlobal1X128 - data.upperFeeGrowthOutside1X128;
        }

        feeGrowthInside0X128 = data.feeGrowthGlobal0X128 - feeGrowthBelow0X128 - feeGrowthAbove0X128;
        feeGrowthInside1X128 = data.feeGrowthGlobal1X128 - feeGrowthBelow1X128 - feeGrowthAbove1X128;
    }

    struct GetFeeGrowthInsideData {
        int24 tickCurrent;
        int24 tickLower;
        int24 tickUpper;
        uint256 feeGrowthGlobal0X128; // SLOAD for gas optimization
        uint256 feeGrowthGlobal1X128; // SLOAD for gas optimization
        uint256 lowerFeeGrowthOutside0X128;
        uint256 lowerFeeGrowthOutside1X128;
        uint256 upperFeeGrowthOutside0X128;
        uint256 upperFeeGrowthOutside1X128;
    }

    function _preLoadDataForGetFeeGrowthInside(
        uint256 tokenId
    ) internal view returns (GetFeeGrowthInsideData memory data) {
        {
            address token0;
            address token1;
            uint24 fee;
            (, , token0, token1, fee, data.tickLower, data.tickUpper, , , , , ) = INonfungiblePositionManager(
                uniswapAddressHolder.nonfungiblePositionManagerAddress()
            ).positions(tokenId);

            IUniswapV3Pool _pool = IUniswapV3Pool(
                PoolAddress.computeAddress(
                    uniswapAddressHolder.uniswapV3FactoryAddress(),
                    PoolAddress.getPoolKey(token0, token1, fee)
                )
            );

            data.feeGrowthGlobal0X128 = _pool.feeGrowthGlobal0X128(); // SLOAD for gas optimization
            data.feeGrowthGlobal1X128 = _pool.feeGrowthGlobal1X128(); // SLOAD for gas optimization

            (, data.tickCurrent, , , , , ) = _pool.slot0();
            (, , data.lowerFeeGrowthOutside0X128, data.lowerFeeGrowthOutside1X128, , , , ) = _pool.ticks(
                data.tickLower
            );

            (, , data.upperFeeGrowthOutside0X128, data.upperFeeGrowthOutside1X128, , , , ) = _pool.ticks(
                data.tickUpper
            );
        }
    }

    struct EstimateWithdrawPositionOutput {
        uint256 amount0Returned;
        uint256 amount1Returned;
        uint256 amount0ReturnedUsdValue;
        uint256 amount1ReturnedUsdValue;
        uint256 amount0ReturnedToken1Value;
        uint256 amount1ReturnedToken0Value;
        uint256 amount0PerformanceFee;
        uint256 amount1PerformanceFee;
        uint256 amount0PerformanceFeeUsdValue;
        uint256 amount1PerformanceFeeUsdValue;
    }

    function estimateWithdrawPosition(
        address userAddress,
        uint256 positionId
    ) external view returns (EstimateWithdrawPositionOutput memory output) {
        IPositionManager.PositionInfo memory pInfo;
        address token0;
        address token1;
        uint256 amount0Returned;
        uint256 amount1Returned;

        {
            GetAmountsOutput memory gaOutput = getAmounts(userAddress, positionId);
            GetUncollectedFeesOutput memory ufOutput = getUncollectedFees(userAddress, positionId);
            token0 = ufOutput.token0;
            token1 = ufOutput.token1;
            pInfo = getPositionInfo(userAddress, positionId);
            amount0Returned = gaOutput.amount0.add(ufOutput.amount0);
            amount1Returned = gaOutput.amount1.add(ufOutput.amount1);
        }

        if (pInfo.strategyProvider == address(0)) {
            output.amount0Returned = amount0Returned;
            output.amount1Returned = amount1Returned;
            output.amount0ReturnedUsdValue = quoteUsdValue(token0, amount0Returned);
            output.amount1ReturnedUsdValue = quoteUsdValue(token1, amount1Returned);
            output.amount0ReturnedToken1Value = quote(token0, token1, amount0Returned);
            output.amount1ReturnedToken0Value = quote(token1, token0, amount1Returned);
        } else {
            address strategyProviderWallet = IStrategyProviderWalletFactory(
                registry().strategyProviderWalletFactoryAddress()
            ).providerToWallet(pInfo.strategyProvider);

            IStrategyProviderWallet.StrategyInfo memory sInfo = IStrategyProviderWallet(strategyProviderWallet)
                .getStrategyInfo(pInfo.strategyId);

            uint160 token0UsdValueTokenSqrtPriceX96 = _getBestSqrtPriceX96(token0, registry().usdValueTokenAddress());
            uint160 token1UsdValueTokenSqrtPriceX96 = _getBestSqrtPriceX96(token1, registry().usdValueTokenAddress());

            uint256 amount0ReturnedUsdValue;
            uint256 amount1ReturnedUsdValue;
            if (token0 == registry().usdValueTokenAddress()) {
                amount0ReturnedUsdValue = amount0Returned;
            } else {
                amount0ReturnedUsdValue = SwapHelper.getQuoteFromSqrtRatioX96(
                    token0UsdValueTokenSqrtPriceX96,
                    MathHelper.fromUint256ToUint128(amount0Returned),
                    token0,
                    registry().usdValueTokenAddress()
                );
            }
            if (token1 == registry().usdValueTokenAddress()) {
                amount1ReturnedUsdValue = amount1Returned;
            } else {
                amount1ReturnedUsdValue = SwapHelper.getQuoteFromSqrtRatioX96(
                    token1UsdValueTokenSqrtPriceX96,
                    MathHelper.fromUint256ToUint128(amount1Returned),
                    token1,
                    registry().usdValueTokenAddress()
                );
            }

            // if current usd value > total deposit usd value, charge performance fee
            if (
                amount0ReturnedUsdValue.add(amount1ReturnedUsdValue) >
                pInfo.amount0DepositedUsdValue.add(pInfo.amount1DepositedUsdValue)
            ) {
                output = _estimateChargePerformanceFeeWithdrawnPosition(
                    _EstimateChargePerformanceFeeWithdrawnPositionInput({
                        token0: token0,
                        token1: token1,
                        amount0Returned: amount0Returned,
                        amount1Returned: amount1Returned,
                        amount0ReturnedUsdValue: amount0ReturnedUsdValue,
                        amount1ReturnedUsdValue: amount1ReturnedUsdValue,
                        totalDepositUSDValue: pInfo.amount0DepositedUsdValue.add(pInfo.amount1DepositedUsdValue),
                        performanceFeeRatio: sInfo.performanceFeeRatio,
                        token0UsdValueTokenSqrtPriceX96: token0UsdValueTokenSqrtPriceX96,
                        token1UsdValueTokenSqrtPriceX96: token1UsdValueTokenSqrtPriceX96
                    })
                );
            } else {
                output.amount0Returned = amount0Returned;
                output.amount1Returned = amount1Returned;
                output.amount0ReturnedUsdValue = quoteUsdValue(token0, amount0Returned);
                output.amount1ReturnedUsdValue = quoteUsdValue(token1, amount1Returned);
                output.amount0ReturnedToken1Value = quote(token0, token1, amount0Returned);
                output.amount1ReturnedToken0Value = quote(token1, token0, amount1Returned);
            }
        }
    }

    struct _EstimateChargePerformanceFeeWithdrawnPositionInput {
        address token0;
        address token1;
        uint256 amount0Returned;
        uint256 amount1Returned;
        uint256 amount0ReturnedUsdValue;
        uint256 amount1ReturnedUsdValue;
        uint256 totalDepositUSDValue;
        uint24 performanceFeeRatio;
        uint160 token0UsdValueTokenSqrtPriceX96;
        uint160 token1UsdValueTokenSqrtPriceX96;
    }

    function _estimateChargePerformanceFeeWithdrawnPosition(
        _EstimateChargePerformanceFeeWithdrawnPositionInput memory input
    ) private view returns (EstimateWithdrawPositionOutput memory output) {
        uint256 performanceFeeUsd = _calPerformanceFee(
            input.amount0ReturnedUsdValue.add(input.amount1ReturnedUsdValue).sub(input.totalDepositUSDValue),
            input.performanceFeeRatio
        );

        uint256 token0UsdPrice;
        uint256 token1UsdPrice;
        if (input.token0 == registry().usdValueTokenAddress()) {
            token0UsdPrice = SwapHelper.getPriceWithSameToken(input.token0);
        } else {
            token0UsdPrice = SwapHelper.getPrice(
                input.token0UsdValueTokenSqrtPriceX96,
                input.token0,
                registry().usdValueTokenAddress()
            );
        }
        if (input.token1 == registry().usdValueTokenAddress()) {
            token1UsdPrice = SwapHelper.getPriceWithSameToken(input.token1);
        } else {
            token1UsdPrice = SwapHelper.getPrice(
                input.token1UsdValueTokenSqrtPriceX96,
                input.token1,
                registry().usdValueTokenAddress()
            );
        }
        (uint256 amount0PerformanceFee, uint256 amount1PerformanceFee) = SwapHelper.distributeTargetAmount(
            input.token0,
            input.token1,
            input.amount0Returned,
            input.amount1Returned,
            token0UsdPrice,
            token1UsdPrice,
            performanceFeeUsd
        );
        output.amount0PerformanceFee = amount0PerformanceFee;
        output.amount1PerformanceFee = amount1PerformanceFee;
        output.amount0Returned = input.amount0Returned.sub(amount0PerformanceFee);
        output.amount1Returned = input.amount1Returned.sub(amount1PerformanceFee);

        if (input.token0 == registry().usdValueTokenAddress()) {
            output.amount0PerformanceFeeUsdValue = output.amount0PerformanceFee;
            output.amount0ReturnedUsdValue = output.amount0Returned;
        } else {
            output.amount0PerformanceFeeUsdValue = SwapHelper.getQuoteFromSqrtRatioX96(
                input.token0UsdValueTokenSqrtPriceX96,
                MathHelper.fromUint256ToUint128(output.amount0PerformanceFee),
                input.token0,
                registry().usdValueTokenAddress()
            );

            output.amount0ReturnedUsdValue = SwapHelper.getQuoteFromSqrtRatioX96(
                input.token0UsdValueTokenSqrtPriceX96,
                MathHelper.fromUint256ToUint128(output.amount0Returned),
                input.token0,
                registry().usdValueTokenAddress()
            );
        }
        if (input.token1 == registry().usdValueTokenAddress()) {
            output.amount1PerformanceFeeUsdValue = output.amount1PerformanceFee;
            output.amount1ReturnedUsdValue = output.amount1Returned;
        } else {
            output.amount1PerformanceFeeUsdValue = SwapHelper.getQuoteFromSqrtRatioX96(
                input.token1UsdValueTokenSqrtPriceX96,
                MathHelper.fromUint256ToUint128(output.amount1PerformanceFee),
                input.token1,
                registry().usdValueTokenAddress()
            );
            output.amount1ReturnedUsdValue = SwapHelper.getQuoteFromSqrtRatioX96(
                input.token1UsdValueTokenSqrtPriceX96,
                MathHelper.fromUint256ToUint128(output.amount1Returned),
                input.token1,
                registry().usdValueTokenAddress()
            );
        }
        output.amount0ReturnedToken1Value = quote(input.token0, input.token1, output.amount0Returned);
        output.amount1ReturnedToken0Value = quote(input.token1, input.token0, output.amount1Returned);
    }

    function quoteUsdValue(address token, uint256 amount) public view returns (uint256 usdValue) {
        if (token == registry().usdValueTokenAddress()) {
            return amount;
        }
        uint160 sqrtPriceX96 = _getBestSqrtPriceX96(token, registry().usdValueTokenAddress());
        usdValue = SwapHelper.getQuoteFromSqrtRatioX96(
            sqrtPriceX96,
            MathHelper.fromUint256ToUint128(amount),
            token,
            registry().usdValueTokenAddress()
        );
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256 amountOut) {
        if (tokenIn == tokenOut) {
            return amountIn;
        }
        uint160 sqrtPriceX96 = _getBestSqrtPriceX96(tokenIn, tokenOut);
        amountOut = SwapHelper.getQuoteFromSqrtRatioX96(
            sqrtPriceX96,
            MathHelper.fromUint256ToUint128(amountIn),
            tokenIn,
            tokenOut
        );
    }

    function _getBestSqrtPriceX96(address token0, address token1) private view returns (uint160 sqrtPriceX96) {
        uint24[] memory allowableFeeTiers = registry().getAllowableFeeTiers();

        address deepestPool = UniswapHelper.findV3DeepestPool(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            token0,
            token1,
            allowableFeeTiers
        );

        (sqrtPriceX96, , , , , , ) = IUniswapV3Pool(deepestPool).slot0();
    }

    function _calPerformanceFee(uint256 amount, uint24 ratio) private pure returns (uint256) {
        uint256 MAX_RATIO = 10_000;
        return FullMath.mulDiv(amount, ratio, MAX_RATIO);
    }
}
