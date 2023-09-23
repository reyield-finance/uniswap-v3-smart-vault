// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../libraries/UniswapHelper.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/IPositionManagerFactory.sol";
import "../interfaces/recipes/IWithdrawRecipes.sol";
import "../interfaces/IUniswapAddressHolder.sol";
import "../interfaces/actions/IClosePosition.sol";
import "../interfaces/actions/IReturnProfit.sol";
import "../interfaces/actions/IShareProfit.sol";
import "../interfaces/IRegistry.sol";
import "../interfaces/IStrategyProviderWalletFactory.sol";
import "../interfaces/IStrategyProviderWallet.sol";
import "../libraries/SwapHelper.sol";
import "./BaseRecipes.sol";

///@notice WithdrawRecipes allows user to withdraw positions from PositionManager
contract WithdrawRecipes is BaseRecipes, IWithdrawRecipes {
    using SafeMath for uint256;

    IUniswapAddressHolder public immutable uniswapAddressHolder;

    modifier positionIsRunning(uint256 positionId) {
        require(
            IPositionManager(
                IPositionManagerFactory(registry().positionManagerFactoryAddress()).userToPositionManager(msg.sender)
            ).isPositionRunning(positionId),
            "WRPIR"
        );
        _;
    }

    constructor(address _registryAddressHolder, address _uniswapAddressHolder) BaseRecipes(_registryAddressHolder) {
        require(_uniswapAddressHolder != address(0), "WRCA0");
        uniswapAddressHolder = IUniswapAddressHolder(_uniswapAddressHolder);
    }

    ///@notice closed position to the position manager with single token
    ///@param positionId ID of closed position
    function withdraw(uint256 positionId) external whenNotPaused positionIsRunning(positionId) {
        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(msg.sender);
        require(positionManager != address(0), "WRPM0");

        IPositionManager.PositionInfo memory pInfo = IPositionManager(positionManager).getPositionInfo(positionId);

        (address token0, address token1, , , ) = UniswapHelper._getTokens(
            pInfo.tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );

        ///@dev close position
        (
            uint256 amount0CollectedFee,
            uint256 amount1CollectedFee,
            uint256 amount0Removed,
            uint256 amount1Removed
        ) = IClosePosition(positionManager).closePosition(pInfo.tokenId, false);

        IPositionManager.MiddlewareWithdrawInput memory mwInput;
        mwInput.positionId = positionId;

        if (pInfo.strategyProvider == address(0)) {
            IReturnProfit.ReturnProfitInput memory rpInput = IReturnProfit.ReturnProfitInput({
                token0: token0,
                token1: token1,
                amount0: amount0Removed.add(amount0CollectedFee).add(pInfo.amount0Leftover),
                amount1: amount1Removed.add(amount1CollectedFee).add(pInfo.amount1Leftover),
                returnedToken: address(0)
            });
            ///@dev return profit to user
            IReturnProfit.ReturnProfitOutput memory rpOutput = IReturnProfit(positionManager).returnProfit(rpInput);
            mwInput.amount0Returned = rpOutput.amount0Returned;
            mwInput.amount1Returned = rpOutput.amount1Returned;
            (mwInput.amount0ReturnedUsdValue, mwInput.amount1ReturnedUsdValue) = _calTokensUsdValue(
                token0,
                token1,
                rpOutput.amount0Returned,
                rpOutput.amount1Returned
            );
        } else {
            address strategyProviderWallet = IStrategyProviderWalletFactory(
                registry().strategyProviderWalletFactoryAddress()
            ).providerToWallet(pInfo.strategyProvider);

            IStrategyProviderWallet.StrategyInfo memory sInfo = IStrategyProviderWallet(strategyProviderWallet)
                .getStrategyInfo(pInfo.strategyId);

            IShareProfit.ShareProfitInput memory spInput = IShareProfit.ShareProfitInput({
                token0: token0,
                token1: token1,
                returnedToken: address(0),
                amount0: amount0Removed.add(amount0CollectedFee).add(pInfo.amount0Leftover),
                amount1: amount1Removed.add(amount1CollectedFee).add(pInfo.amount1Leftover),
                originalDepositUsdValue: pInfo.totalDepositUSDValue,
                performanceFeeRecipient: strategyProviderWallet,
                performanceFeeReceivedToken: _parseReceivedTokenType(sInfo.receivedTokenType, token0, token1),
                performanceFeeRatio: sInfo.performanceFeeRatio,
                serviceFeeRatio: registry().getServiceFeeRatioFromLicenseAmount(sInfo.licenseAmount)
            });

            ///@dev share performance fee with strategy provider
            IShareProfit.ShareProfitOutput memory spOutput = IShareProfit(positionManager).shareProfit(spInput);
            mwInput.amount0Returned = spOutput.amount0Returned;
            mwInput.amount1Returned = spOutput.amount1Returned;
            (mwInput.amount0ReturnedUsdValue, mwInput.amount1ReturnedUsdValue) = _calTokensUsdValue(
                token0,
                token1,
                spOutput.amount0Returned,
                spOutput.amount1Returned
            );
        }

        mwInput.amount0CollectedFee = pInfo.amount0CollectedFee.add(amount0CollectedFee);
        mwInput.amount1CollectedFee = pInfo.amount1CollectedFee.add(amount1CollectedFee);
        IPositionManager(positionManager).middlewareWithdraw(mwInput);

        emit PositionWithdrawn(positionManager, msg.sender, positionId, pInfo.tokenId);
    }

    ///@notice closed position to the position manager with single token
    ///@param positionId ID of closed position
    function singleTokenWithdraw(
        uint256 positionId,
        bool isReturnedToken0
    ) external whenNotPaused positionIsRunning(positionId) {
        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(msg.sender);
        require(positionManager != address(0), "WRPM0");

        IPositionManager.PositionInfo memory pInfo = IPositionManager(positionManager).getPositionInfo(positionId);

        (address token0, address token1, , , ) = UniswapHelper._getTokens(
            pInfo.tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );

        ///@dev close position
        (
            uint256 amount0CollectedFee,
            uint256 amount1CollectedFee,
            uint256 amount0Removed,
            uint256 amount1Removed
        ) = IClosePosition(positionManager).closePosition(pInfo.tokenId, false);

        IPositionManager.MiddlewareWithdrawInput memory mwInput;
        mwInput.positionId = positionId;
        if (pInfo.strategyProvider == address(0)) {
            IReturnProfit.ReturnProfitInput memory rpInput = IReturnProfit.ReturnProfitInput({
                token0: token0,
                token1: token1,
                amount0: amount0Removed.add(amount0CollectedFee).add(pInfo.amount0Leftover),
                amount1: amount1Removed.add(amount1CollectedFee).add(pInfo.amount1Leftover),
                returnedToken: isReturnedToken0 ? token0 : token1
            });
            ///@dev return profit to user
            IReturnProfit.ReturnProfitOutput memory rpOutput = IReturnProfit(positionManager).returnProfit(rpInput);
            mwInput.amount0Returned = rpOutput.amount0Returned;
            mwInput.amount1Returned = rpOutput.amount1Returned;
            (mwInput.amount0ReturnedUsdValue, mwInput.amount1ReturnedUsdValue) = _calTokensUsdValue(
                token0,
                token1,
                rpOutput.amount0Returned,
                rpOutput.amount1Returned
            );
        } else {
            address strategyProviderWallet = IStrategyProviderWalletFactory(
                registry().strategyProviderWalletFactoryAddress()
            ).providerToWallet(pInfo.strategyProvider);

            IStrategyProviderWallet.StrategyInfo memory sInfo = IStrategyProviderWallet(strategyProviderWallet)
                .getStrategyInfo(pInfo.strategyId);

            IShareProfit.ShareProfitInput memory spInput = IShareProfit.ShareProfitInput({
                token0: token0,
                token1: token1,
                returnedToken: isReturnedToken0 ? token0 : token1,
                amount0: amount0Removed.add(amount0CollectedFee).add(pInfo.amount0Leftover),
                amount1: amount1Removed.add(amount1CollectedFee).add(pInfo.amount1Leftover),
                originalDepositUsdValue: pInfo.totalDepositUSDValue,
                performanceFeeRecipient: strategyProviderWallet,
                performanceFeeReceivedToken: _parseReceivedTokenType(sInfo.receivedTokenType, token0, token1),
                performanceFeeRatio: sInfo.performanceFeeRatio,
                serviceFeeRatio: registry().getServiceFeeRatioFromLicenseAmount(sInfo.licenseAmount)
            });

            ///@dev share performance fee with strategy provider
            IShareProfit.ShareProfitOutput memory spOutput = IShareProfit(positionManager).shareProfit(spInput);
            mwInput.amount0Returned = spOutput.amount0Returned;
            mwInput.amount1Returned = spOutput.amount1Returned;
            (mwInput.amount0ReturnedUsdValue, mwInput.amount1ReturnedUsdValue) = _calTokensUsdValue(
                token0,
                token1,
                spOutput.amount0Returned,
                spOutput.amount1Returned
            );
        }

        mwInput.amount0CollectedFee = pInfo.amount0CollectedFee.add(amount0CollectedFee);
        mwInput.amount1CollectedFee = pInfo.amount1CollectedFee.add(amount1CollectedFee);
        IPositionManager(positionManager).middlewareWithdraw(mwInput);

        emit PositionWithdrawn(positionManager, msg.sender, positionId, pInfo.tokenId);
    }

    function _calTokensUsdValue(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1
    ) internal view returns (uint256 token0UsdValue, uint256 token1UsdValue) {
        uint24[] memory allowableFeeTiers = registry().getAllowableFeeTiers();
        token0UsdValue = SwapHelper.getQuoteFromDeepestPool(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            token0,
            registry().usdValueTokenAddress(),
            amount0,
            allowableFeeTiers
        );
        token1UsdValue = SwapHelper.getQuoteFromDeepestPool(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            token1,
            registry().usdValueTokenAddress(),
            amount1,
            allowableFeeTiers
        );
    }

    function _parseReceivedTokenType(
        IStrategyProviderWallet.ReceivedTokenType receivedTokenType,
        address token0,
        address token1
    ) internal pure returns (address receivedToken) {
        if (receivedTokenType == IStrategyProviderWallet.ReceivedTokenType.Token0) {
            receivedToken = token0;
        } else if (receivedTokenType == IStrategyProviderWallet.ReceivedTokenType.Token1) {
            receivedToken = token1;
        } else {
            receivedToken = address(0);
        }
    }
}
