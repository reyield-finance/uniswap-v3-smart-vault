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
    ///@param _registryAddressHolder address of the registry address holder
    ///@param _uniswapAddressHolder address of the uniswap address holder
    constructor(address _registryAddressHolder, address _uniswapAddressHolder) BaseModule(_registryAddressHolder) {
        require(_uniswapAddressHolder != address(0), "ILCA0");

        uniswapAddressHolder = IUniswapAddressHolder(_uniswapAddressHolder);
    }

    ///@notice check if the position is out of range and rebalance it by swapping the tokens as necessary
    ///@param input RebalanceInput struct
    function rebalance(RebalanceInput calldata input) external whenNotPaused onlyWhitelistedKeeper {
        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
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

        uint256 amount0Desired = carRes.amount0Removed.add(carRes.amount0CollectedFee).sub(carRes.amount0Repaid);
        uint256 amount1Desired = carRes.amount1Removed.add(carRes.amount1CollectedFee).sub(carRes.amount1Repaid);

        require(amount0Desired > 0 || amount1Desired > 0, "ILAR");

        _SwapAndMintResult memory samRes = _swapAndMint(
            _SwapAndMintParams({
                positionManager: positionManager,
                tokenId: pInfo.tokenId,
                amount0: amount0Desired,
                amount1: amount1Desired,
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

        emit PositionRebalanced(
            positionManager,
            input.positionId,
            pInfo.tokenId,
            samRes.newTokenId,
            carRes.amount0Removed,
            carRes.amount1Removed,
            carRes.amount0CollectedFee,
            carRes.amount1CollectedFee,
            carRes.amount0Repaid,
            carRes.amount1Repaid
        );
    }

    ///@notice check if the position is out of range and rebalance it by swapping the tokens as necessary and customize lower & upper tick diff
    ///@param input RebalanceWithTickDiffsInput struct
    function rebalanceWithTickDiffs(
        RebalanceWithTickDiffsInput calldata input
    ) external whenNotPaused onlyWhitelistedKeeper {
        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
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

        uint256 amount0Desired = carRes.amount0Removed.add(carRes.amount0CollectedFee).sub(carRes.amount0Repaid);
        uint256 amount1Desired = carRes.amount1Removed.add(carRes.amount1CollectedFee).sub(carRes.amount1Repaid);

        require(amount0Desired > 0 || amount1Desired > 0, "ILAR");

        _SwapAndMintResult memory samRes = _swapAndMint(
            _SwapAndMintParams({
                positionManager: positionManager,
                tokenId: pInfo.tokenId,
                amount0: amount0Desired,
                amount1: amount1Desired,
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

        emit PositionRebalanced(
            positionManager,
            input.positionId,
            pInfo.tokenId,
            samRes.newTokenId,
            carRes.amount0Removed,
            carRes.amount1Removed,
            carRes.amount0CollectedFee,
            carRes.amount1CollectedFee,
            carRes.amount0Repaid,
            carRes.amount1Repaid
        );
    }

    function _closedAndRepayRebalance(
        _CloseAndRepayRebalanceParams memory params
    ) internal returns (_CloseAndRepayRebalanceResult memory res) {
        UniswapHelper.getTokensOutput memory tokensOutput = UniswapHelper.getTokens(
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
                        token0: tokensOutput.token0,
                        token1: tokensOutput.token1,
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

            res.amount0Repaid = rrfOutput.token0Repaid;
            res.amount1Repaid = rrfOutput.token1Repaid;

            // if (rrfOutput.token0Repaid > res.amount0CollectedFee) {
            //     res.amount0CollectedFee = 0;
            //     res.amount0Removed = res.amount0Removed.sub(rrfOutput.token0Repaid.sub(res.amount0CollectedFee));
            // } else {
            //     res.amount0CollectedFee = res.amount0CollectedFee.sub(rrfOutput.token0Repaid);
            // }

            // if (rrfOutput.token1Repaid > res.amount1CollectedFee) {
            //     res.amount1CollectedFee = 0;
            //     res.amount1Removed = res.amount1Removed.sub(rrfOutput.token1Repaid.sub(res.amount1CollectedFee));
            // } else {
            //     res.amount1CollectedFee = res.amount1CollectedFee.sub(rrfOutput.token1Repaid);
            // }
        }
    }

    function _swapAndMint(_SwapAndMintParams memory params) internal returns (_SwapAndMintResult memory res) {
        UniswapHelper.getTokensOutput memory tokensOutput = UniswapHelper.getTokens(
            params.tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );

        int24 currentTick = UniswapHelper.getDepositCurrentTick(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            tokensOutput.token0,
            tokensOutput.token1,
            tokensOutput.fee
        );

        uint256 amount0Deposit;
        uint256 amount1Deposit;
        ///@dev call swapToPositionAction to perform the swap
        (uint256 amount0AfterSwapped, uint256 amount1AfterSwapped) = ISwapToPositionRatio(params.positionManager)
            .swapToPositionRatio(
                ISwapToPositionRatio.SwapToPositionInput({
                    token0Address: tokensOutput.token0,
                    token1Address: tokensOutput.token1,
                    fee: tokensOutput.fee,
                    amount0In: params.amount0,
                    amount1In: params.amount1,
                    tickLower: currentTick.add(params.tickLowerDiff),
                    tickUpper: currentTick.add(params.tickUpperDiff)
                })
            );

        ///@dev call mintAction
        (res.newTokenId, amount0Deposit, amount1Deposit) = IMint(params.positionManager).mint(
            IMint.MintInput({
                token0Address: tokensOutput.token0,
                token1Address: tokensOutput.token1,
                fee: tokensOutput.fee,
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
        UniswapHelper.getTokensOutput memory tokensOutput = UniswapHelper.getTokens(
            tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );

        int24 currentTick = UniswapHelper.getCurrentTick(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            tokensOutput.token0,
            tokensOutput.token1,
            tokensOutput.fee
        );

        ///@dev check if the current tick is out of range
        ///note current tick == tickUpper is out of range
        require(currentTick < tokensOutput.tickLower || currentTick >= tokensOutput.tickUpper, "ILOOR");
    }

    function checkDiffOfTicksRange(int24 tickLowerDiff, int24 tickUpperDiff, uint256 tokenId) internal view {
        UniswapHelper.getTokensOutput memory tokensOutput = UniswapHelper.getTokens(
            tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );
        int24 tickSpacing = IUniswapV3Factory(uniswapAddressHolder.uniswapV3FactoryAddress()).feeAmountTickSpacing(
            tokensOutput.fee
        );
        require(
            tickLowerDiff <= 0 &&
                tickUpperDiff >= 0 &&
                tickLowerDiff % tickSpacing == 0 &&
                tickUpperDiff % tickSpacing == 0,
            "ILTD"
        );
    }
}
