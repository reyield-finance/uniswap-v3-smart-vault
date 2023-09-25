// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../libraries/UniswapHelper.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/IPositionManagerFactory.sol";
import "../interfaces/recipes/IGovernanceRecipes.sol";
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
contract GovernanceRecipes is BaseRecipes, IGovernanceRecipes {
    using SafeMath for uint256;

    IUniswapAddressHolder public immutable uniswapAddressHolder;

    constructor(address _registryAddressHolder, address _uniswapAddressHolder) BaseRecipes(_registryAddressHolder) {
        require(_uniswapAddressHolder != address(0), "GRUAH0");

        uniswapAddressHolder = IUniswapAddressHolder(_uniswapAddressHolder);
    }

    ///@notice closed position forcedly by governance
    ///@param user address of the user
    ///@param positionId ID of closed position
    function closedPositionForced(address user, uint256 positionId) external onlyGovernance {
        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(user);
        require(positionManager != address(0), "WRPM0");

        IPositionManager.PositionInfo memory pInfo = IPositionManager(positionManager).getPositionInfo(positionId);

        UniswapHelper.getTokensOutput memory tokensOutput = UniswapHelper.getTokens(
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
        IReturnProfit.ReturnProfitInput memory rpInput = IReturnProfit.ReturnProfitInput({
            token0: tokensOutput.token0,
            token1: tokensOutput.token1,
            amount0: amount0Removed.add(amount0CollectedFee).add(pInfo.amount0Leftover),
            amount1: amount1Removed.add(amount1CollectedFee).add(pInfo.amount1Leftover),
            returnedToken: address(0)
        });

        ///@dev return profit to user
        IReturnProfit.ReturnProfitOutput memory rpOutput = IReturnProfit(positionManager).returnProfit(rpInput);
        mwInput.amount0Returned = rpOutput.amount0Returned;
        mwInput.amount1Returned = rpOutput.amount1Returned;
        (mwInput.amount0ReturnedUsdValue, mwInput.amount1ReturnedUsdValue) = _calTokensUsdValue(
            tokensOutput.token0,
            tokensOutput.token1,
            rpOutput.amount0Returned,
            rpOutput.amount1Returned
        );

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
        token0UsdValue = _toUsdValue(token0, amount0, allowableFeeTiers);
        token1UsdValue = _toUsdValue(token1, amount1, allowableFeeTiers);
    }

    function _toUsdValue(
        address tokenAddress,
        uint256 amount,
        uint24[] memory allowableFeeTiers
    ) internal view returns (uint256) {
        address usdTokenAddress = registry().usdValueTokenAddress();

        if (tokenAddress == usdTokenAddress) return amount;

        address deepestPool = UniswapHelper.findV3DeepestPool(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            tokenAddress,
            usdTokenAddress,
            allowableFeeTiers
        );

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(deepestPool).slot0();

        return
            SwapHelper.getQuoteFromSqrtRatioX96(
                sqrtPriceX96,
                MathHelper.fromUint256ToUint128(amount),
                tokenAddress,
                usdTokenAddress
            );
    }
}
