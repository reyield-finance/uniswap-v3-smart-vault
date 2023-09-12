// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./BaseModule.sol";
import "../libraries/SafeInt24Math.sol";
import "../libraries/UniswapHelper.sol";
import "../libraries/MathHelper.sol";
import "../interfaces/modules/IIdleLiquidityModule.sol";
import "../interfaces/IPositionManagerFactory.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/IUniswapAddressHolder.sol";
import "../interfaces/actions/IClosePosition.sol";
import "../interfaces/actions/IRepayRebalanceFee.sol";
import "../interfaces/actions/ISwapToPositionRatio.sol";
import "../interfaces/actions/IMint.sol";
import "../base/Multicall.sol";

///@title Idle Liquidity Module to manage liquidity for a user position
contract IdleLiquidityModule is BaseModule, IIdleLiquidityModule, Multicall {
    ///@notice uniswap address holder
    IUniswapAddressHolder public immutable uniswapAddressHolder;
    using SafeMath for uint256;
    using SafeInt24Math for int24;

    ///@notice assing the uniswap address holder to the contract
    ///@param _registry address of the registry
    ///@param _uniswapAddressHolder address of the uniswap address holder
    constructor(address _registry, address _uniswapAddressHolder) BaseModule(_registry) {
        require(_uniswapAddressHolder != address(0), "ILCA0");

        uniswapAddressHolder = IUniswapAddressHolder(_uniswapAddressHolder);
    }

    ///@notice check if the position is out of range and rebalance it by swapping the tokens as necessary
    ///@param input RebalanceInput struct
    function rebalance(RebalanceInput calldata input) external whenNotPaused onlyWhitelistedKeeper {
        address positionManager = IPositionManagerFactory(registry.positionManagerFactoryAddress())
            .userToPositionManager(input.userAddress);
        require(positionManager != address(0), "ILPM0");

        IPositionManager.PositionInfo memory pInfo = IPositionManager(positionManager).getPositionInfo(
            input.positionId
        );

        checkCurrentTickOutOfRange(pInfo.tokenId);

        _CloseAndRepayRebalanceResult memory carRes = _closedAndRepayRebalance(
            _CloseAndRepayRebalanceParams({
                positionManager: positionManager,
                feeReceiver: input.feeReceiver,
                tokenId: pInfo.tokenId,
                rebalanceFee: input.estimatedGasFee,
                isForced: input.isForced,
                amount0Leftover: pInfo.amount0Leftover,
                amount1Leftover: pInfo.amount1Leftover
            })
        );

        require(carRes.amount0Removed > 0 || carRes.amount1Removed > 0, "ILAR");

        _SwapAndMintResult memory samRes = _swapAndMint(
            _SwapAndMintParams({
                positionManager: positionManager,
                tokenId: pInfo.tokenId,
                amount0: carRes.amount0Removed.add(carRes.amount0CollectedFee),
                amount1: carRes.amount1Removed.add(carRes.amount1CollectedFee),
                tickLowerDiff: pInfo.tickLowerDiff,
                tickUpperDiff: pInfo.tickUpperDiff
            })
        );

        IPositionManager(positionManager).middlewareRebalance(
            input.positionId,
            samRes.newTokenId,
            pInfo.tickLowerDiff,
            pInfo.tickUpperDiff,
            pInfo.amount0CollectedFee.add(carRes.amount0CollectedFee),
            pInfo.amount1CollectedFee.add(carRes.amount1CollectedFee),
            samRes.amount0Leftover,
            samRes.amount1Leftover
        );

        emit positionRebalanced(
            positionManager,
            input.positionId,
            pInfo.tokenId,
            samRes.newTokenId,
            carRes.amount0CollectedFee,
            carRes.amount1CollectedFee
        );
    }

    ///@notice check if the position is out of range and rebalance it by swapping the tokens as necessary and customize lower & upper tick diff
    ///@param input RebalanceWithTickDiffsInput struct
    function rebalanceWithTickDiffs(
        RebalanceWithTickDiffsInput calldata input
    ) external whenNotPaused onlyWhitelistedKeeper {
        address positionManager = IPositionManagerFactory(registry.positionManagerFactoryAddress())
            .userToPositionManager(input.userAddress);
        require(positionManager != address(0), "ILPM0");

        IPositionManager.PositionInfo memory pInfo = IPositionManager(positionManager).getPositionInfo(
            input.positionId
        );

        checkDiffOfTicksRange(input.tickLowerDiff, input.tickUpperDiff, pInfo.tokenId);
        checkCurrentTickOutOfRange(pInfo.tokenId);

        _CloseAndRepayRebalanceResult memory carRes = _closedAndRepayRebalance(
            _CloseAndRepayRebalanceParams({
                positionManager: positionManager,
                feeReceiver: input.feeReceiver,
                tokenId: pInfo.tokenId,
                rebalanceFee: input.estimatedGasFee,
                isForced: input.isForced,
                amount0Leftover: pInfo.amount0Leftover,
                amount1Leftover: pInfo.amount1Leftover
            })
        );

        require(carRes.amount0Removed > 0 || carRes.amount1Removed > 0, "ILAR");

        _SwapAndMintResult memory samRes = _swapAndMint(
            _SwapAndMintParams({
                positionManager: positionManager,
                tokenId: pInfo.tokenId,
                amount0: carRes.amount0Removed.add(carRes.amount0CollectedFee),
                amount1: carRes.amount1Removed.add(carRes.amount1CollectedFee),
                tickLowerDiff: input.tickLowerDiff,
                tickUpperDiff: input.tickUpperDiff
            })
        );

        IPositionManager(positionManager).middlewareRebalance(
            input.positionId,
            samRes.newTokenId,
            input.tickLowerDiff,
            input.tickUpperDiff,
            pInfo.amount0CollectedFee.add(carRes.amount0CollectedFee),
            pInfo.amount1CollectedFee.add(carRes.amount1CollectedFee),
            samRes.amount0Leftover,
            samRes.amount1Leftover
        );

        emit positionRebalanced(
            positionManager,
            input.positionId,
            pInfo.tokenId,
            samRes.newTokenId,
            carRes.amount0CollectedFee,
            carRes.amount1CollectedFee
        );
    }

    function _closedAndRepayRebalance(
        _CloseAndRepayRebalanceParams memory params
    ) internal returns (_CloseAndRepayRebalanceResult memory res) {
        (address token0, address token1, , , ) = UniswapHelper._getTokens(
            params.tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );

        ///@dev call closePositionAction
        (res.amount0CollectedFee, res.amount1CollectedFee, res.amount0Removed, res.amount1Removed) = IClosePosition(
            params.positionManager
        ).closePosition(params.tokenId, false);

        ///NOTE: introduce leftover into removed amount
        res.amount0Removed = res.amount0Removed.add(params.amount0Leftover);
        res.amount1Removed = res.amount1Removed.add(params.amount1Leftover);

        if (params.rebalanceFee != 0) {
            ///@dev call repayRebalanceFeeAction
            IRepayRebalanceFee.RepayRebalanceFeeOutput memory rrfOutput = IRepayRebalanceFee(params.positionManager)
                .repayRebalanceFee(
                    IRepayRebalanceFee.RepayRebalanceFeeInput({
                        token0: token0,
                        token1: token1,
                        amount0Quota: params.isForced
                            ? res.amount0CollectedFee.add(res.amount0Removed)
                            : res.amount0CollectedFee,
                        amount1Quota: params.isForced
                            ? res.amount1CollectedFee.add(res.amount1Removed)
                            : res.amount1CollectedFee,
                        rebalanceFee: params.rebalanceFee,
                        receiver: params.feeReceiver
                    })
                );

            if (rrfOutput.token0Repaid > res.amount0CollectedFee) {
                res.amount0CollectedFee = 0;
                res.amount0Removed = res.amount0Removed.sub(rrfOutput.token0Repaid.sub(res.amount0CollectedFee));
            } else {
                res.amount0CollectedFee = res.amount0CollectedFee.sub(rrfOutput.token0Repaid);
            }

            if (rrfOutput.token1Repaid > res.amount1CollectedFee) {
                res.amount1CollectedFee = 0;
                res.amount1Removed = res.amount1Removed.sub(rrfOutput.token1Repaid.sub(res.amount1CollectedFee));
            } else {
                res.amount1CollectedFee = res.amount1CollectedFee.sub(rrfOutput.token1Repaid);
            }
        }
    }

    function _swapAndMint(_SwapAndMintParams memory params) internal returns (_SwapAndMintResult memory res) {
        (address token0, address token1, uint24 fee, , ) = UniswapHelper._getTokens(
            params.tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );

        int24 currentTick = UniswapHelper._getDepositCurrentTick(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            token0,
            token1,
            fee
        );

        uint256 amount0Deposit;
        uint256 amount1Deposit;
        ///@dev call swapToPositionAction to perform the swap
        (uint256 amount0AfterSwapped, uint256 amount1AfterSwapped) = ISwapToPositionRatio(params.positionManager)
            .swapToPositionRatio(
                ISwapToPositionRatio.SwapToPositionInput({
                    token0Address: token0,
                    token1Address: token1,
                    fee: fee,
                    amount0In: params.amount0,
                    amount1In: params.amount1,
                    tickLower: currentTick.add(params.tickLowerDiff),
                    tickUpper: currentTick.add(params.tickUpperDiff)
                })
            );

        ///@dev call mintAction
        (res.newTokenId, amount0Deposit, amount1Deposit) = IMint(params.positionManager).mint(
            IMint.MintInput({
                token0Address: token0,
                token1Address: token1,
                fee: fee,
                tickLower: currentTick.add(params.tickLowerDiff),
                tickUpper: currentTick.add(params.tickUpperDiff),
                amount0Desired: amount0AfterSwapped,
                amount1Desired: amount1AfterSwapped,
                isReturnLeftOver: false
            })
        );

        ///@dev cal leftOver
        res.amount0Leftover = amount0AfterSwapped.sub(amount0Deposit);
        res.amount1Leftover = amount1AfterSwapped.sub(amount1Deposit);
    }

    function checkCurrentTickOutOfRange(uint256 tokenId) internal view {
        (address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper) = UniswapHelper._getTokens(
            tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );

        int24 currentTick = UniswapHelper._getCurrentTick(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            token0,
            token1,
            fee
        );

        ///@dev check if the current tick is out of range
        ///note current tick == tickUpper is out of range
        require(currentTick < tickLower || currentTick >= tickUpper, "ILOOR");
    }

    function checkDiffOfTicksRange(int24 tickLowerDiff, int24 tickUpperDiff, uint256 tokenId) internal view {
        (, , uint24 fee, , ) = UniswapHelper._getTokens(
            tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );
        int24 tickSpacing = IUniswapV3Factory(uniswapAddressHolder.uniswapV3FactoryAddress()).feeAmountTickSpacing(fee);
        require(
            tickLowerDiff <= 0 &&
                tickUpperDiff >= 0 &&
                tickLowerDiff % tickSpacing == 0 &&
                tickUpperDiff % tickSpacing == 0,
            "ILTD"
        );
    }
}
