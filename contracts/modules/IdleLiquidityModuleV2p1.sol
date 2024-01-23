// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./BaseModule.sol";
import "../libraries/SafeInt24Math.sol";
import "../libraries/UniswapHelper.sol";
import "../libraries/UniswapUncollectedFeeHelper.sol";
import "../libraries/MathHelper.sol";
import "../interfaces/modules/IIdleLiquidityModuleV2.sol";
import "../interfaces/IPositionManagerFactory.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/IUniswapAddressHolder.sol";
import "../interfaces/actions/IClosePositionOneShot.sol";
import "../interfaces/actions/IWithdrawNativeToken.sol";
import "../interfaces/actions/ISwapToPositionRatio.sol";
import "../interfaces/actions/IMint.sol";
import "../base/Multicall.sol";

///@title Idle Liquidity Module to manage liquidity for a user position
///@notice 2p1 is the version of rebalance without check if it's out of range
contract IdleLiquidityModuleV2p1 is BaseModule, IIdleLiquidityModuleV2, Multicall {
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

        _CloseAndRepayRebalanceResult memory carRes = _closedAndRepayRebalance(
            _CloseAndRepayRebalanceParams({
                positionManager: positionManager,
                feeReceiver: input.feeReceiver,
                tokenId: pInfo.tokenId,
                rebalanceFee: input.estimatedGasFee
            })
        );

        uint256 amount0Desired = carRes.amount0Removed.add(carRes.amount0CollectedFee).add(pInfo.amount0Leftover);
        uint256 amount1Desired = carRes.amount1Removed.add(carRes.amount1CollectedFee).add(pInfo.amount1Leftover);

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
            input.estimatedGasFee
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

        _CloseAndRepayRebalanceResult memory carRes = _closedAndRepayRebalance(
            _CloseAndRepayRebalanceParams({
                positionManager: positionManager,
                feeReceiver: input.feeReceiver,
                tokenId: pInfo.tokenId,
                rebalanceFee: input.estimatedGasFee
            })
        );

        uint256 amount0Desired = carRes.amount0Removed.add(carRes.amount0CollectedFee).add(pInfo.amount0Leftover);
        uint256 amount1Desired = carRes.amount1Removed.add(carRes.amount1CollectedFee).add(pInfo.amount1Leftover);

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
            input.estimatedGasFee
        );
    }

    function _closedAndRepayRebalance(
        _CloseAndRepayRebalanceParams memory params
    ) internal returns (_CloseAndRepayRebalanceResult memory res) {
        ///@dev call getUncollectedFees
        UniswapUncollectedFeeHelper.GetUncollectedFeesOutput memory ucfOutput = UniswapUncollectedFeeHelper
            .getUncollectedFees(
                uniswapAddressHolder.uniswapV3FactoryAddress(),
                uniswapAddressHolder.nonfungiblePositionManagerAddress(),
                params.tokenId
            );

        ///@dev call closePositionOneShotAction
        IClosePositionOneShot.ClosePositionOneShotOutput memory cposOutput = IClosePositionOneShot(
            params.positionManager
        ).closePositionOneShot(
                IClosePositionOneShot.ClosePositionOneShotInput({ tokenId: params.tokenId, returnTokenToUser: false })
            );

        require(
            cposOutput.amount0Collected >= ucfOutput.amount0 && cposOutput.amount1Collected >= ucfOutput.amount1,
            "IL2CP"
        );

        if (params.rebalanceFee != 0) {
            ///@dev call withdrawNativeToken action
            IWithdrawNativeToken(params.positionManager).withdrawNativeToken(
                IWithdrawNativeToken.WithdrawNativeTokenInput({
                    amount: params.rebalanceFee,
                    receiver: params.feeReceiver
                })
            );
        }

        // total amount0 collected = amount0Removed(liquidity part) + amount0CollectedFee(fee part)
        // total amount1 collected = amount1Removed(liquidity part) + amount1CollectedFee(fee part)
        res.amount0CollectedFee = ucfOutput.amount0;
        res.amount1CollectedFee = ucfOutput.amount1;
        res.amount0Removed = cposOutput.amount0Collected.sub(ucfOutput.amount0);
        res.amount1Removed = cposOutput.amount1Collected.sub(ucfOutput.amount1);
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
