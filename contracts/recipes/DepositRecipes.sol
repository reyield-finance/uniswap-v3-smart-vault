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
        (input.token0, input.token1, isOrderChanged) = UniswapHelper.reorderTokens(input.token0, input.token1);

        checkPoolValid(input.token0, input.token1, input.fee);
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

        uint24[] memory allowableFeeTiers = registry().getAllowableFeeTiers();

        uint256 positionId = IPositionManager(positionManager).createPosition(
            IPositionManager.CreatePositionInput({
                tokenId: tokenId,
                strategyProvider: address(0),
                strategyId: input.strategyId,
                amount0Deposited: amount0Deposit,
                amount1Deposited: amount1Deposit,
                amount0DepositedUsdValue: SwapHelper.getQuoteFromDeepestPool(
                    uniswapAddressHolder.uniswapV3FactoryAddress(),
                    input.token0,
                    registry().usdValueTokenAddress(),
                    amount0Deposit,
                    allowableFeeTiers
                ),
                amount1DepositedUsdValue: SwapHelper.getQuoteFromDeepestPool(
                    uniswapAddressHolder.uniswapV3FactoryAddress(),
                    input.token1,
                    registry().usdValueTokenAddress(),
                    amount1Deposit,
                    allowableFeeTiers
                ),
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
        (input.token0, input.token1, isOrderChanged) = UniswapHelper.reorderTokens(input.token0, input.token1);

        checkStrategyInfo(input.strategyProvider, input.strategyId, input.token0, input.token1, input.fee);
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

        uint24[] memory allowableFeeTiers = registry().getAllowableFeeTiers();

        uint256 positionId = IPositionManager(positionManager).createPosition(
            IPositionManager.CreatePositionInput({
                tokenId: tokenId,
                strategyProvider: input.strategyProvider,
                strategyId: input.strategyId,
                amount0Deposited: amount0Deposit,
                amount1Deposited: amount1Deposit,
                amount0DepositedUsdValue: SwapHelper.getQuoteFromDeepestPool(
                    uniswapAddressHolder.uniswapV3FactoryAddress(),
                    input.token0,
                    registry().usdValueTokenAddress(),
                    amount0Deposit,
                    allowableFeeTiers
                ),
                amount1DepositedUsdValue: SwapHelper.getQuoteFromDeepestPool(
                    uniswapAddressHolder.uniswapV3FactoryAddress(),
                    input.token1,
                    registry().usdValueTokenAddress(),
                    amount1Deposit,
                    allowableFeeTiers
                ),
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

    ///@notice mints a uni NFT with a single input token
    ///@param input struct of SingleTokenDepositInput parameters
    ///@return tokenId the ID of the minted NFT
    function singleTokenDeposit(SingleTokenDepositInput memory input) external whenNotPaused returns (uint256 tokenId) {
        require(input.amountIn != 0, "DRA0");
        require(registry().isAllowableFeeTier(input.fee), "DRFT");

        bool isOrderChanged;
        (input.token0, input.token1, isOrderChanged) = UniswapHelper.reorderTokens(input.token0, input.token1);
        input.isToken0In = isOrderChanged ? !input.isToken0In : input.isToken0In;

        checkPoolValid(input.token0, input.token1, input.fee);
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

        uint24[] memory allowableFeeTiers = registry().getAllowableFeeTiers();

        uint256 positionId = IPositionManager(positionManager).createPosition(
            IPositionManager.CreatePositionInput({
                tokenId: zapInOutput.tokenId,
                strategyProvider: address(0),
                strategyId: input.strategyId,
                amount0Deposited: zapInOutput.amount0Deposited.add(zapInOutput.amount0Leftover),
                amount1Deposited: zapInOutput.amount1Deposited.add(zapInOutput.amount1Leftover),
                amount0DepositedUsdValue: SwapHelper.getQuoteFromDeepestPool(
                    uniswapAddressHolder.uniswapV3FactoryAddress(),
                    input.token0,
                    registry().usdValueTokenAddress(),
                    zapInOutput.amount0Deposited.add(zapInOutput.amount0Leftover),
                    allowableFeeTiers
                ),
                amount1DepositedUsdValue: SwapHelper.getQuoteFromDeepestPool(
                    uniswapAddressHolder.uniswapV3FactoryAddress(),
                    input.token1,
                    registry().usdValueTokenAddress(),
                    zapInOutput.amount1Deposited.add(zapInOutput.amount1Leftover),
                    allowableFeeTiers
                ),
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
        (input.token0, input.token1, isOrderChanged) = UniswapHelper.reorderTokens(input.token0, input.token1);
        input.isToken0In = isOrderChanged ? !input.isToken0In : input.isToken0In;

        checkStrategyInfo(input.strategyProvider, input.strategyId, input.token0, input.token1, input.fee);
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

        uint24[] memory allowableFeeTiers = registry().getAllowableFeeTiers();
        uint256 positionId = IPositionManager(positionManager).createPosition(
            IPositionManager.CreatePositionInput({
                tokenId: zapInOutput.tokenId,
                strategyProvider: input.strategyProvider,
                strategyId: input.strategyId,
                amount0Deposited: zapInOutput.amount0Deposited.add(zapInOutput.amount0Leftover),
                amount1Deposited: zapInOutput.amount1Deposited.add(zapInOutput.amount1Leftover),
                amount0DepositedUsdValue: SwapHelper.getQuoteFromDeepestPool(
                    uniswapAddressHolder.uniswapV3FactoryAddress(),
                    input.token0,
                    registry().usdValueTokenAddress(),
                    zapInOutput.amount0Deposited.add(zapInOutput.amount0Leftover),
                    allowableFeeTiers
                ),
                amount1DepositedUsdValue: SwapHelper.getQuoteFromDeepestPool(
                    uniswapAddressHolder.uniswapV3FactoryAddress(),
                    input.token1,
                    registry().usdValueTokenAddress(),
                    zapInOutput.amount1Deposited.add(zapInOutput.amount1Leftover),
                    allowableFeeTiers
                ),
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

    function checkStrategyInfo(
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

    function checkPoolValid(address token0, address token1, uint24 fee) internal view {
        address pool = UniswapHelper.getPool(uniswapAddressHolder.uniswapV3FactoryAddress(), token0, token1, fee);
        IRegistry registry = registry();
        require(
            UniswapHelper.isPoolValid(
                uniswapAddressHolder.uniswapV3FactoryAddress(),
                pool,
                registry.weth9(),
                registry.usdValueTokenAddress(),
                registry.getAllowableFeeTiers()
            ),
            "DRCPV"
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
