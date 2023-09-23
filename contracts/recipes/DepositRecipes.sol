// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "../interfaces/recipes/IDepositRecipes.sol";
import "../interfaces/actions/IMint.sol";
import "../interfaces/actions/IZapIn.sol";
import "../interfaces/actions/IIncreaseLiquidity.sol";
import "../interfaces/actions/ISingleTokenIncreaseLiquidity.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/IPositionManagerFactory.sol";
import "../interfaces/IUniswapAddressHolder.sol";
import "../interfaces/IRegistry.sol";
import "../interfaces/IERC20Extended.sol";
import "../interfaces/IStrategyProviderWalletFactory.sol";
import "../interfaces/IStrategyProviderWallet.sol";
import "../libraries/UniswapHelper.sol";
import "../libraries/SwapHelper.sol";
import "../libraries/SafeInt24Math.sol";
import "./BaseRecipes.sol";

///@notice DepositRecipes allows user to fill their position manager with UniswapV3 positions
///        by depositing an already minted NFT or by minting directly a new one
contract DepositRecipes is BaseRecipes, IDepositRecipes {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using SafeInt24Math for int24;

    IUniswapAddressHolder public immutable uniswapAddressHolder;

    constructor(address _registryAddressHolder, address _uniswapAddressHolder) BaseRecipes(_registryAddressHolder) {
        require(_uniswapAddressHolder != address(0), "DRUAH0");
        uniswapAddressHolder = IUniswapAddressHolder(_uniswapAddressHolder);
    }

    ///@notice mint uniswapV3 NFT and deposit in the position manager
    ///@param input struct of DepositInput parameters
    ///@return tokenId the ID of the minted NFT
    function deposit(DepositInput memory input) external whenNotPaused returns (uint256 tokenId) {
        require(input.amount0Desired != 0 || input.amount1Desired != 0, "DRA0");
        require(registry().isAllowableFeeTier(input.fee), "DRFT");
        bool isOrderChanged;
        (input.token0, input.token1, isOrderChanged) = UniswapHelper._reorderTokens(input.token0, input.token1);

        checkTokensValid(input.token0, input.token1);
        checkDiffOfTicksRange(input.tickLowerDiff, input.tickUpperDiff, input.fee);

        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(msg.sender);
        require(positionManager != address(0), "DRPM0");

        (input.amount0Desired, input.amount1Desired) = isOrderChanged
            ? (input.amount1Desired, input.amount0Desired)
            : (input.amount0Desired, input.amount1Desired);

        int24 currentTick = UniswapHelper.getDepositCurrentTick(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            input.token0,
            input.token1,
            input.fee
        );

        ///@dev calculate the correct amounts before transferring tokens to position manager
        (, input.amount0Desired, input.amount1Desired) = UniswapHelper.calLiquidityAndAmounts(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            input.token0,
            input.token1,
            input.fee,
            currentTick.add(input.tickLowerDiff),
            currentTick.add(input.tickUpperDiff),
            input.amount0Desired,
            input.amount1Desired
        );

        ///@dev send tokens to position manager to be able to call the mint action
        IERC20(input.token0).safeTransferFrom(msg.sender, positionManager, input.amount0Desired);
        IERC20(input.token1).safeTransferFrom(msg.sender, positionManager, input.amount1Desired);

        uint256 amount0Deposit;
        uint256 amount1Deposit;
        (tokenId, amount0Deposit, amount1Deposit) = IMint(positionManager).mint(
            IMint.MintInput({
                token0Address: input.token0,
                token1Address: input.token1,
                fee: input.fee,
                tickLower: currentTick.add(input.tickLowerDiff),
                tickUpper: currentTick.add(input.tickUpperDiff),
                amount0Desired: input.amount0Desired,
                amount1Desired: input.amount1Desired,
                isReturnLeftOver: true
            })
        );

        // calculate total usd value of the position
        uint256 totalUsdValue = _calTotalDepositUsdValue(input.token0, input.token1, amount0Deposit, amount1Deposit);

        uint256 positionId = IPositionManager(positionManager).createPosition(
            IPositionManager.CreatePositionInput({
                tokenId: tokenId,
                strategyProvider: address(0),
                strategyId: input.strategyId,
                totalDepositUSDValue: totalUsdValue,
                tickLowerDiff: input.tickLowerDiff,
                tickUpperDiff: input.tickUpperDiff,
                amount0Leftover: 0,
                amount1Leftover: 0
            })
        );

        emit PositionDeposited(positionManager, msg.sender, positionId, input.strategyId);
    }

    ///@notice mint uniswapV3 NFT and deposit in the position manager by following listed strategy
    ///@param input struct of DepositListedStrategyInput parameters
    ///@return tokenId the ID of the minted NFT
    function depositListedStrategy(
        DepositListedStrategyInput memory input
    ) external whenNotPaused returns (uint256 tokenId) {
        require(input.amount0Desired != 0 || input.amount1Desired != 0, "DRA0");
        require(registry().isAllowableFeeTier(input.fee), "DRFT");

        bool isOrderChanged;
        (input.token0, input.token1, isOrderChanged) = UniswapHelper._reorderTokens(input.token0, input.token1);

        checkStrategyExist(input.strategyProvider, input.strategyId, input.token0, input.token1, input.fee);
        checkTokensValid(input.token0, input.token1);
        checkDiffOfTicksRange(input.tickLowerDiff, input.tickUpperDiff, input.fee);

        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(msg.sender);
        require(positionManager != address(0), "DRPM0");

        (input.amount0Desired, input.amount1Desired) = isOrderChanged
            ? (input.amount1Desired, input.amount0Desired)
            : (input.amount0Desired, input.amount1Desired);

        int24 currentTick = UniswapHelper.getDepositCurrentTick(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            input.token0,
            input.token1,
            input.fee
        );

        ///@dev calculate the correct amounts before transferring tokens to position manager
        (, input.amount0Desired, input.amount1Desired) = UniswapHelper.calLiquidityAndAmounts(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            input.token0,
            input.token1,
            input.fee,
            currentTick.add(input.tickLowerDiff),
            currentTick.add(input.tickUpperDiff),
            input.amount0Desired,
            input.amount1Desired
        );

        ///@dev send tokens to position manager to be able to call the mint action
        IERC20(input.token0).safeTransferFrom(msg.sender, positionManager, input.amount0Desired);
        IERC20(input.token1).safeTransferFrom(msg.sender, positionManager, input.amount1Desired);

        uint256 totalUsdValue;
        {
            uint256 amount0Deposit;
            uint256 amount1Deposit;
            (tokenId, amount0Deposit, amount1Deposit) = IMint(positionManager).mint(
                IMint.MintInput({
                    token0Address: input.token0,
                    token1Address: input.token1,
                    fee: input.fee,
                    tickLower: currentTick.add(input.tickLowerDiff),
                    tickUpper: currentTick.add(input.tickUpperDiff),
                    amount0Desired: input.amount0Desired,
                    amount1Desired: input.amount1Desired,
                    isReturnLeftOver: true
                })
            );

            // calculate total usd value of the position
            totalUsdValue = _calTotalDepositUsdValue(input.token0, input.token1, amount0Deposit, amount1Deposit);
        }

        uint256 positionId = IPositionManager(positionManager).createPosition(
            IPositionManager.CreatePositionInput({
                tokenId: tokenId,
                strategyProvider: input.strategyProvider,
                strategyId: input.strategyId,
                totalDepositUSDValue: totalUsdValue,
                tickLowerDiff: input.tickLowerDiff,
                tickUpperDiff: input.tickUpperDiff,
                amount0Leftover: 0,
                amount1Leftover: 0
            })
        );

        emit PositionDepositedListedStrategy(
            positionManager,
            msg.sender,
            positionId,
            input.strategyId,
            input.strategyProvider
        );
    }

    ///@notice increases liquidity of a position
    ///@param positionId id of the position
    ///@param amount0Desired amount of token0 to be added to the position
    ///@param amount1Desired amount of token1 to be added to the position
    function increaseLiquidity(
        uint256 positionId,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) external whenNotPaused {
        require(amount0Desired != 0 || amount1Desired != 0, "DRA0");
        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(msg.sender);
        require(positionManager != address(0), "DRPM0");

        IPositionManager.PositionInfo memory pInfo = IPositionManager(positionManager).getPositionInfo(positionId);

        (address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper) = UniswapHelper._getTokens(
            pInfo.tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );

        ///@dev calculate the correct amounts before transferring tokens to position manager
        (, amount0Desired, amount1Desired) = UniswapHelper.calLiquidityAndAmounts(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            token0,
            token1,
            fee,
            tickLower,
            tickUpper,
            amount0Desired,
            amount1Desired
        );

        ///@dev send tokens to position manager to be able to call the increase liquidity action
        IERC20(token0).safeTransferFrom(msg.sender, positionManager, amount0Desired);
        IERC20(token1).safeTransferFrom(msg.sender, positionManager, amount1Desired);

        (uint256 amount0Increased, uint256 amount1Increased) = IIncreaseLiquidity(positionManager).increaseLiquidity(
            IIncreaseLiquidity.IncreaseLiquidityInput({
                tokenId: pInfo.tokenId,
                token0Address: token0,
                token1Address: token1,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired
            })
        );

        // calculate total usd value of the position
        uint256 totalUsdValue = _calTotalDepositUsdValue(token0, token1, amount0Increased, amount1Increased);

        IPositionManager(positionManager).middlewareIncreaseLiquidity(
            positionId,
            pInfo.totalDepositUSDValue.add(totalUsdValue),
            pInfo.amount0Leftover,
            pInfo.amount1Leftover
        );

        emit PositionIncreasedLiquidity(positionManager, msg.sender, positionId);
    }

    ///@notice mints a uni NFT with a single input token
    ///@param input struct of SingleTokenDepositInput parameters
    ///@return tokenId the ID of the minted NFT
    function singleTokenDeposit(SingleTokenDepositInput memory input) external whenNotPaused returns (uint256 tokenId) {
        require(input.amountIn != 0, "DRA0");
        require(registry().isAllowableFeeTier(input.fee), "DRFT");

        bool isOrderChanged;
        (input.token0, input.token1, isOrderChanged) = UniswapHelper._reorderTokens(input.token0, input.token1);
        input.isToken0In = isOrderChanged ? !input.isToken0In : input.isToken0In;

        checkTokensValid(input.token0, input.token1);
        checkDiffOfTicksRange(input.tickLowerDiff, input.tickUpperDiff, input.fee);

        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(msg.sender);
        require(positionManager != address(0), "DRPM0");

        int24 currentTick = UniswapHelper.getDepositCurrentTick(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            input.token0,
            input.token1,
            input.fee
        );

        ///@dev send tokens to position manager to be able to call the zap in action
        IERC20(input.isToken0In ? input.token0 : input.token1).safeTransferFrom(
            msg.sender,
            positionManager,
            input.amountIn
        );

        IZapIn.ZapInOutput memory zapInOutput = IZapIn(positionManager).zapIn(
            IZapIn.ZapInInput(
                input.token0,
                input.token1,
                input.isToken0In,
                input.amountIn,
                currentTick.add(input.tickLowerDiff),
                currentTick.add(input.tickUpperDiff),
                input.fee
            )
        );
        tokenId = zapInOutput.tokenId;

        // calculate total usd value of the position
        uint256 totalUsdValue = _calTotalDepositUsdValue(
            input.token0,
            input.token1,
            zapInOutput.amount0Deposited.add(zapInOutput.amount0Leftover),
            zapInOutput.amount1Deposited.add(zapInOutput.amount1Leftover)
        );

        uint256 positionId = IPositionManager(positionManager).createPosition(
            IPositionManager.CreatePositionInput({
                tokenId: zapInOutput.tokenId,
                strategyProvider: address(0),
                strategyId: input.strategyId,
                totalDepositUSDValue: totalUsdValue,
                tickLowerDiff: input.tickLowerDiff,
                tickUpperDiff: input.tickUpperDiff,
                amount0Leftover: zapInOutput.amount0Leftover,
                amount1Leftover: zapInOutput.amount1Leftover
            })
        );

        emit PositionDeposited(positionManager, msg.sender, positionId, input.strategyId);
    }

    ///@notice mints a uni NFT with a single input token follow listed strategy
    ///@param input struct of SingleTokenDepositListedStrategyInput parameters
    ///@return tokenId the ID of the minted NFT
    function singleTokenDepositListedStrategy(
        SingleTokenDepositListedStrategyInput memory input
    ) external whenNotPaused returns (uint256 tokenId) {
        require(input.amountIn != 0, "DRA0");
        require(registry().isAllowableFeeTier(input.fee), "DRFT");

        bool isOrderChanged;
        (input.token0, input.token1, isOrderChanged) = UniswapHelper._reorderTokens(input.token0, input.token1);
        input.isToken0In = isOrderChanged ? !input.isToken0In : input.isToken0In;

        checkStrategyExist(input.strategyProvider, input.strategyId, input.token0, input.token1, input.fee);
        checkTokensValid(input.token0, input.token1);
        checkDiffOfTicksRange(input.tickLowerDiff, input.tickUpperDiff, input.fee);

        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(msg.sender);
        require(positionManager != address(0), "DRPM0");

        int24 currentTick = UniswapHelper.getDepositCurrentTick(
            uniswapAddressHolder.uniswapV3FactoryAddress(),
            input.token0,
            input.token1,
            input.fee
        );

        ///@dev send tokens to position manager to be able to call the zap in action
        IERC20(input.isToken0In ? input.token0 : input.token1).safeTransferFrom(
            msg.sender,
            positionManager,
            input.amountIn
        );

        uint256 totalUsdValue;
        IZapIn.ZapInOutput memory zapInOutput;
        {
            zapInOutput = IZapIn(positionManager).zapIn(
                IZapIn.ZapInInput(
                    input.token0,
                    input.token1,
                    input.isToken0In,
                    input.amountIn,
                    currentTick.add(input.tickLowerDiff),
                    currentTick.add(input.tickUpperDiff),
                    input.fee
                )
            );
            tokenId = zapInOutput.tokenId;

            // calculate total usd value of the position
            totalUsdValue = _calTotalDepositUsdValue(
                input.token0,
                input.token1,
                zapInOutput.amount0Deposited,
                zapInOutput.amount1Deposited
            );
        }

        uint256 positionId = IPositionManager(positionManager).createPosition(
            IPositionManager.CreatePositionInput({
                tokenId: zapInOutput.tokenId,
                strategyProvider: input.strategyProvider,
                strategyId: input.strategyId,
                totalDepositUSDValue: totalUsdValue,
                tickLowerDiff: input.tickLowerDiff,
                tickUpperDiff: input.tickUpperDiff,
                amount0Leftover: zapInOutput.amount0Leftover,
                amount1Leftover: zapInOutput.amount1Leftover
            })
        );

        emit PositionDepositedListedStrategy(
            positionManager,
            msg.sender,
            positionId,
            input.strategyId,
            input.strategyProvider
        );
    }

    ///@notice increases liquidity of a position with sigle token
    ///@param positionId id of the position
    ///@param isToken0In true if the input token is token0, false if the input token is token1
    ///@param amount amount of input token
    function singleTokenIncreaseLiquidity(uint256 positionId, bool isToken0In, uint256 amount) external whenNotPaused {
        require(amount != 0, "DRA0");
        address positionManager = IPositionManagerFactory(registry().positionManagerFactoryAddress())
            .userToPositionManager(msg.sender);
        require(positionManager != address(0), "DRPM0");

        IPositionManager.PositionInfo memory pInfo = IPositionManager(positionManager).getPositionInfo(positionId);

        (address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper) = UniswapHelper._getTokens(
            pInfo.tokenId,
            INonfungiblePositionManager(uniswapAddressHolder.nonfungiblePositionManagerAddress())
        );

        ///@dev send tokens to position manager to be able to call the sigleTokenIncreaseLiquidity action
        IERC20(isToken0In ? token0 : token1).safeTransferFrom(msg.sender, positionManager, amount);

        ISingleTokenIncreaseLiquidity.SingleTokenIncreaseLiquidityOutput
            memory singleTokenIncreaseLiquidityOutput = ISingleTokenIncreaseLiquidity(positionManager)
                .singleTokenIncreaseLiquidity(
                    ISingleTokenIncreaseLiquidity.SingleTokenIncreaseLiquidityInput({
                        tokenId: pInfo.tokenId,
                        token0: token0,
                        token1: token1,
                        isToken0In: isToken0In,
                        amountIn: amount,
                        tickLower: tickLower,
                        tickUpper: tickUpper,
                        fee: fee
                    })
                );

        // calculate total usd value of the position
        uint256 totalUsdValue = _calTotalDepositUsdValue(
            token0,
            token1,
            singleTokenIncreaseLiquidityOutput.amount0Increased,
            singleTokenIncreaseLiquidityOutput.amount1Increased
        );

        IPositionManager(positionManager).middlewareIncreaseLiquidity(
            positionId,
            pInfo.totalDepositUSDValue.add(totalUsdValue),
            pInfo.amount0Leftover.add(singleTokenIncreaseLiquidityOutput.amount0Leftover),
            pInfo.amount1Leftover.add(singleTokenIncreaseLiquidityOutput.amount1Leftover)
        );

        emit PositionIncreasedLiquidity(positionManager, msg.sender, positionId);
    }

    function checkStrategyExist(
        address provider,
        bytes16 strategyId,
        address token0,
        address token1,
        uint24 fee
    ) internal view {
        if (provider != address(0)) {
            address wallet = IStrategyProviderWalletFactory(registry().strategyProviderWalletFactoryAddress())
                .providerToWallet(provider);

            require(wallet != address(0), "DRSPW");
            address _pool = IUniswapV3Factory(uniswapAddressHolder.uniswapV3FactoryAddress()).getPool(
                token0,
                token1,
                fee
            );
            require(_pool != address(0), "DRP0");
            require(IStrategyProviderWallet(wallet).getStrategyInfo(strategyId).pool == _pool, "DRSPWSE");
        }
    }

    function checkTokensValid(address token0, address token1) internal view {
        require(token0 != token1, "DRT");
        _checkTokenCanBeSwapToWETH9(token0);
        _checkTokenCanBeSwapToWETH9(token1);
    }

    function _calTotalDepositUsdValue(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1
    ) internal view returns (uint256 totalUsdValue) {
        uint24[] memory allowableFeeTiers = registry().getAllowableFeeTiers();

        totalUsdValue = SwapHelper
            .getQuoteFromDeepestPool(
                uniswapAddressHolder.uniswapV3FactoryAddress(),
                token0,
                registry().usdValueTokenAddress(),
                amount0,
                allowableFeeTiers
            )
            .add(
                SwapHelper.getQuoteFromDeepestPool(
                    uniswapAddressHolder.uniswapV3FactoryAddress(),
                    token1,
                    registry().usdValueTokenAddress(),
                    amount1,
                    allowableFeeTiers
                )
            );
    }

    function _checkTokenCanBeSwapToWETH9(address token) internal view {
        IRegistry registry = registry();
        address weth = registry.weth9();
        address usdValueTokenAddress = registry.usdValueTokenAddress();

        if (token == weth || token == usdValueTokenAddress) {
            return;
        }

        require(
            UniswapHelper._isPoolExist(
                uniswapAddressHolder.uniswapV3FactoryAddress(),
                token,
                usdValueTokenAddress,
                registry.getAllowableFeeTiers()
            ),
            "DRCSTW"
        );
    }

    function checkDiffOfTicksRange(int24 tickLowerDiff, int24 tickUpperDiff, uint24 fee) internal view {
        int24 tickSpacing = IUniswapV3Factory(uniswapAddressHolder.uniswapV3FactoryAddress()).feeAmountTickSpacing(fee);
        require(
            tickLowerDiff <= 0 &&
                tickUpperDiff >= 0 &&
                tickLowerDiff % tickSpacing == 0 &&
                tickUpperDiff % tickSpacing == 0,
            "DRTD"
        );
    }
}
