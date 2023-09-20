import { BigNumber } from "@ethersproject/bignumber";
import { reset } from "@nomicfoundation/hardhat-network-helpers";
import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract } from "ethers";
import { ethers } from "hardhat";
import hre from "hardhat";

import {
  DepositRecipes,
  INonfungiblePositionManager,
  ISwapRouter,
  IUniswapV3Pool,
  IdleLiquidityModule,
  MockToken,
  MockWETH9,
  PositionHelper,
  PositionManager,
  PositionManagerFactory,
  Registry,
  RegistryAddressHolder,
  StrategyProviderWallet,
  StrategyProviderWalletFactory,
  WithdrawRecipes,
} from "../../types";
import { pool } from "../../types/@uniswap/v3-core/contracts/interfaces";
import {
  RegistryAddressHolderFixture,
  RegistryFixture,
  deployContract,
  deployPositionManagerFactoryAndActions,
  deployUniswapContracts,
  depositWETH9Amount,
  doAllApprovals,
  hexToBn,
  hexToInt256,
  mintSTDAmount,
  parseEventData,
  poolFixture,
  tokensFixture,
  weth9Fixture,
  zeroAddress,
} from "../shared/fixtures";

describe("PositionHelper.sol", function () {
  //GLOBAL VARIABLE - USE THIS

  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let user2: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let serviceFeeRecipient: SignerWithAddress;
  let keeper: SignerWithAddress;
  let rebalanceFeeRecipient: SignerWithAddress;
  let registry: Registry;
  let registryAddressHolder: RegistryAddressHolder;

  //all the token used globally
  let tokenWETH9: MockWETH9;
  let tokenWETH: MockToken, tokenUSDC: MockToken, tokenUSDT: MockToken, tokenOP: MockToken;
  let poolUSDCWETH: IUniswapV3Pool,
    poolUSDTWETH: IUniswapV3Pool,
    poolOPWETH: IUniswapV3Pool,
    poolOPUSDC: IUniswapV3Pool,
    poolOPUSDT: IUniswapV3Pool,
    poolUSDCUSDT: IUniswapV3Pool;

  let uniswapV3Factory: Contract; // the factory that will deploy all pools
  let nonFungiblePositionManager: INonfungiblePositionManager; // NonFungiblePositionManager contract by UniswapV3
  let swapRouter: ISwapRouter;
  let positionManager: PositionManager; // Position manager contract
  let positionManager2: PositionManager; // Position manager contract
  let strategyProviderWalletFactory: StrategyProviderWalletFactory;
  let depositRecipes: DepositRecipes;
  let withdrawRecipes: WithdrawRecipes;
  let idleLiquidityModule: IdleLiquidityModule;
  let positionHelper: PositionHelper;

  function getToken0Token1(token0: MockToken, token1: MockToken): [MockToken, MockToken, boolean] {
    return token0.address < token1.address ? [token0, token1, false] : [token1, token0, true];
  }

  beforeEach(async function () {
    await reset(process.env.ALCHEMY_OPTIMISM_MAINNET, 107735214);
    //deploy our contracts
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];
    user2 = signers[2];
    liquidityProvider = signers[3];
    serviceFeeRecipient = signers[4];
    keeper = signers[5];
    rebalanceFeeRecipient = signers[6];

    //deploy the tokens - ETH, USDC
    tokenWETH9 = (await weth9Fixture()).weth9Fixture;
    tokenWETH = tokenWETH9 as unknown as MockToken;
    tokenUSDC = (await tokensFixture("USDC", 6)).tokenFixture;
    tokenUSDT = (await tokensFixture("USDT", 6)).tokenFixture;
    tokenOP = (await tokensFixture("OP", 18)).tokenFixture;

    //deploy uniswap contracts needed
    [uniswapV3Factory, nonFungiblePositionManager, swapRouter] = await deployUniswapContracts(tokenWETH);

    //deploy first pool
    poolUSDCWETH = (await poolFixture(tokenUSDC, tokenWETH, 500, uniswapV3Factory, 0)).pool;
    poolUSDTWETH = (await poolFixture(tokenUSDT, tokenWETH, 500, uniswapV3Factory, 0)).pool;
    poolOPWETH = (await poolFixture(tokenOP, tokenWETH, 500, uniswapV3Factory, 0)).pool;
    poolOPUSDC = (await poolFixture(tokenOP, tokenUSDC, 500, uniswapV3Factory, 1)).pool;
    poolOPUSDT = (await poolFixture(tokenOP, tokenUSDT, 500, uniswapV3Factory, -1)).pool;
    poolUSDCUSDT = (await poolFixture(tokenUSDC, tokenUSDT, 500, uniswapV3Factory, 0)).pool;

    /*
      0.01% - 可調整區間 0.01%
      0.05% - 可調整區間 0.1%
      0.3% - 可調整區間 0.6%
      1% - 可調整區間 2%
      */

    //mint 1e30 token, you can call with arbitrary amount
    await depositWETH9Amount(tokenWETH9);
    await mintSTDAmount(tokenUSDC);
    await mintSTDAmount(tokenUSDT);
    await mintSTDAmount(tokenOP);

    //deploy the registry
    registry = (
      await RegistryFixture(
        await deployer.getAddress(),
        await serviceFeeRecipient.getAddress(),
        500,
        0,
        tokenUSDC.address,
        tokenWETH.address,
      )
    ).registryFixture;
    registryAddressHolder = (await RegistryAddressHolderFixture(registry.address)).registryAddressHolderFixture;
    // add deployer as keeper
    await registry.connect(deployer).addKeeperToWhitelist(keeper.address);

    const uniswapAddressHolder = await deployContract("UniswapAddressHolder", [
      registryAddressHolder.address,
      nonFungiblePositionManager.address,
      uniswapV3Factory.address,
      swapRouter.address,
    ]);
    const diamondCutFacet = await deployContract("DiamondCutFacet");

    //deploy the PositionManagerFactory => deploy PositionManager
    const positionManagerFactory = (await deployPositionManagerFactoryAndActions(
      registryAddressHolder.address,
      uniswapAddressHolder.address,
      diamondCutFacet.address,
      [
        "IncreaseLiquidity",
        "SingleTokenIncreaseLiquidity",
        "Mint",
        "ZapIn",
        "ClosePosition",
        "RepayRebalanceFee",
        "SwapToPositionRatio",
        "ReturnProfit",
        "ShareProfit",
      ],
    )) as PositionManagerFactory;

    const strategyProviderWalletFactoryFactory = await ethers.getContractFactory("StrategyProviderWalletFactory");
    strategyProviderWalletFactory = (await strategyProviderWalletFactoryFactory.deploy(
      registryAddressHolder.address,
      uniswapAddressHolder.address,
    )) as StrategyProviderWalletFactory;
    await strategyProviderWalletFactory.deployed();

    await strategyProviderWalletFactory.addCreatorWhitelist(positionManagerFactory.address);

    //registry setup
    await registry.setPositionManagerFactory(positionManagerFactory.address);
    await registry.setStrategyProviderWalletFactory(strategyProviderWalletFactory.address);

    //deploy PositionHelper contract
    positionHelper = (await deployContract("PositionHelper", [
      registryAddressHolder.address,
      uniswapAddressHolder.address,
    ])) as PositionHelper;

    //deploy DepositRecipes contract
    depositRecipes = (await deployContract("DepositRecipes", [
      registryAddressHolder.address,
      uniswapAddressHolder.address,
    ])) as DepositRecipes;

    //deploy WithdrawRecipes contract
    withdrawRecipes = (await deployContract("WithdrawRecipes", [
      registryAddressHolder.address,
      uniswapAddressHolder.address,
    ])) as WithdrawRecipes;

    //deploy IdleLiquidityModule contract
    idleLiquidityModule = (await deployContract("IdleLiquidityModule", [
      registryAddressHolder.address,
      uniswapAddressHolder.address,
    ])) as IdleLiquidityModule;

    await registry.addNewContract(
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("DepositRecipes")),
      depositRecipes.address,
      hre.ethers.utils.formatBytes32String("1"),
    );

    await registry.addNewContract(
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("WithdrawRecipes")),
      withdrawRecipes.address,
      hre.ethers.utils.formatBytes32String("1"),
    );

    await registry.addNewContract(
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("IdleLiquidityModule")),
      idleLiquidityModule.address,
      hre.ethers.utils.formatBytes32String("1"),
    );
    await registry.addNewContract(
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("PositionManagerFactory")),
      positionManagerFactory.address,
      hre.ethers.utils.formatBytes32String("1"),
    );

    // create user position manager
    const txn = await positionManagerFactory.connect(user).create();
    await txn.wait();
    const positionManagerAddress = await positionManagerFactory.userToPositionManager(user.address);
    positionManager = (await ethers.getContractAt("PositionManager", positionManagerAddress)) as PositionManager;

    // create user2 position manager
    const txn2 = await positionManagerFactory.connect(user2).create();
    await txn2.wait();
    const positionManagerAddress2 = await positionManagerFactory.userToPositionManager(user2.address);
    positionManager2 = (await ethers.getContractAt("PositionManager", positionManagerAddress2)) as PositionManager;

    //get AbiCoder
    // abiCoder = ethers.utils.defaultAbiCoder;

    //APPROVE
    await doAllApprovals(
      [user, user2, liquidityProvider],
      [
        nonFungiblePositionManager.address,
        swapRouter.address,
        positionManager.address,
        depositRecipes.address,
        withdrawRecipes.address,
      ],
      [tokenWETH, tokenUSDC, tokenUSDT, tokenOP],
    );
    //approval nfts
    await nonFungiblePositionManager.setApprovalForAll(positionManager.address, true);
  });

  async function providePoolLiquidity() {
    // give pool some liquidity
    const r = await nonFungiblePositionManager.connect(liquidityProvider).mint(
      {
        token0: tokenOP.address < tokenUSDT.address ? tokenOP.address : tokenUSDT.address,
        token1: tokenUSDT.address > tokenOP.address ? tokenUSDT.address : tokenOP.address,
        fee: 500,
        tickLower: 0 - 60,
        tickUpper: 0 + 60,
        amount0Desired: 30000n * 10n ** 18n,
        amount1Desired: 30000n * 10n ** 18n,
        amount0Min: 0,
        amount1Min: 0,
        recipient: liquidityProvider.address,
        deadline: Date.now() + 1000,
      },
      { gasLimit: 670000 },
    );
    await r.wait();

    // give pool some liquidity
    await nonFungiblePositionManager.connect(liquidityProvider).mint(
      {
        token0: tokenUSDC.address < tokenOP.address ? tokenUSDC.address : tokenOP.address,
        token1: tokenOP.address > tokenUSDC.address ? tokenOP.address : tokenUSDC.address,
        fee: 500,
        tickLower: 0 - 60,
        tickUpper: 0 + 60,
        amount0Desired: 100000n * 10n ** 18n,
        amount1Desired: 100000n * 10n ** 18n,
        amount0Min: 0,
        amount1Min: 0,
        recipient: liquidityProvider.address,
        deadline: Date.now() + 1000,
      },
      { gasLimit: 670000 },
    );

    // give pool some liquidity
    await nonFungiblePositionManager.connect(liquidityProvider).mint(
      {
        token0: tokenUSDC.address < tokenUSDT.address ? tokenUSDC.address : tokenUSDT.address,
        token1: tokenUSDT.address > tokenUSDC.address ? tokenUSDT.address : tokenUSDC.address,
        fee: 500,
        tickLower: 0 - 60,
        tickUpper: 0 + 60,
        amount0Desired: 100000n * 10n ** 18n,
        amount1Desired: 100000n * 10n ** 18n,
        amount0Min: 0,
        amount1Min: 0,
        recipient: liquidityProvider.address,
        deadline: Date.now() + 1000,
      },
      { gasLimit: 670000 },
    );

    // give pool some liquidity
    await nonFungiblePositionManager.connect(liquidityProvider).mint(
      {
        token0: tokenUSDC.address < tokenWETH.address ? tokenUSDC.address : tokenWETH.address,
        token1: tokenWETH.address > tokenUSDC.address ? tokenWETH.address : tokenUSDC.address,
        fee: 500,
        tickLower: 0 - 10000,
        tickUpper: 0 + 10000,
        amount0Desired: 1000n * 10n ** 18n,
        amount1Desired: 1000n * 10n ** 18n,
        amount0Min: 0,
        amount1Min: 0,
        recipient: liquidityProvider.address,
        deadline: Date.now() + 1000,
      },
      { gasLimit: 670000 },
    );
  }

  describe("positionHelper", function () {
    it("positionHelper", async function () {
      // give pool some liquidity
      await providePoolLiquidity();

      const strategyId = ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16);
      const token0 = tokenOP.address < tokenUSDT.address ? tokenOP : tokenUSDT;
      const token1 = tokenOP.address < tokenUSDT.address ? tokenUSDT : tokenOP;
      const amount0Desired: BigNumber = BigNumber.from(10n * 10n ** 18n);
      const amount1Desired: BigNumber = BigNumber.from(2n * 10n ** 18n);
      const tickLowerDiff = 0n - 10n;
      const tickUpperDiff = 0n + 10n;
      const user0BalanceBefore = await token0.balanceOf(user.address);
      const user1BalanceBefore = await token1.balanceOf(user.address);
      const txDeposit = await depositRecipes.connect(user).deposit({
        token0: token0.address,
        token1: token1.address,
        fee: 500,
        tickLowerDiff: tickLowerDiff,
        tickUpperDiff: tickUpperDiff,
        amount0Desired: amount0Desired,
        amount1Desired: amount1Desired,
        strategyId: strategyId,
      });

      const receipt = await txDeposit.wait();
      const events: any = receipt.events;
      const fromInLog = events[events.length - 1].args.from;
      const positionIdInLog = events[events.length - 1].args.positionId;
      const strategyIdInLog = events[events.length - 1].args.strategyId;

      expect(fromInLog).to.be.equal(user.address);
      expect(positionIdInLog).to.be.equal(1);
      expect(strategyIdInLog).to.be.equal(strategyId);

      let amount0Deposited: BigNumber = BigNumber.from(0);
      let amount1Deposited: BigNumber = BigNumber.from(0);
      let tokenIdInLog: BigNumber = BigNumber.from(0);
      let count = 0;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === positionManager.address) {
          count++;

          const eventData = parseEventData(events[i].data);
          tokenIdInLog = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
          amount0Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
          amount1Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
        }
      }
      expect(count).to.be.equal(1);
      // user
      expect(await token0.balanceOf(user.address)).to.equal(user0BalanceBefore.sub(amount0Deposited));
      expect(await token1.balanceOf(user.address)).to.equal(user1BalanceBefore.sub(amount1Deposited));

      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);

      const positionInfoAfterDeposit = await positionManager.getPositionInfo(positionIdInLog);
      expect(positionInfoAfterDeposit.tokenId).to.be.equal(tokenIdInLog);
      expect(positionInfoAfterDeposit.strategyProvider).to.be.equal(zeroAddress);
      expect(positionInfoAfterDeposit.strategyId).to.be.equal(strategyIdInLog);
      expect(positionInfoAfterDeposit.totalDepositUSDValue).to.be.greaterThan(0);
      expect(positionInfoAfterDeposit.amount0CollectedFee).to.be.equal(0);
      expect(positionInfoAfterDeposit.amount1CollectedFee).to.be.equal(0);
      expect(positionInfoAfterDeposit.amount0Leftover).to.be.equal(0);
      expect(positionInfoAfterDeposit.amount1Leftover).to.be.equal(0);
      expect(positionInfoAfterDeposit.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfoAfterDeposit.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      expect(positionInfoAfterDeposit.amount0Returned).to.be.equal(0);
      expect(positionInfoAfterDeposit.amount1Returned).to.be.equal(0);
      expect(positionInfoAfterDeposit.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionInfoAfterDeposit.amount1ReturnedUsdValue).to.be.equal(0);

      {
        // get positionHelper
        const positionInfo = await positionHelper.getPositionInfo(user.address, positionIdInLog);
        expect(positionInfo.tokenId).to.be.equal(positionInfoAfterDeposit.tokenId);
        expect(positionInfo.strategyProvider).to.be.equal(positionInfoAfterDeposit.strategyProvider);
        expect(positionInfo.strategyId).to.be.equal(positionInfoAfterDeposit.strategyId);
        expect(positionInfo.totalDepositUSDValue).to.be.equal(positionInfoAfterDeposit.totalDepositUSDValue);
        expect(positionInfo.amount0CollectedFee).to.be.equal(positionInfoAfterDeposit.amount0CollectedFee);
        expect(positionInfo.amount1CollectedFee).to.be.equal(positionInfoAfterDeposit.amount1CollectedFee);
        expect(positionInfo.amount0Leftover).to.be.equal(positionInfoAfterDeposit.amount0Leftover);
        expect(positionInfo.amount1Leftover).to.be.equal(positionInfoAfterDeposit.amount1Leftover);
        expect(positionInfo.tickLowerDiff).to.be.equal(positionInfoAfterDeposit.tickLowerDiff);
        expect(positionInfo.tickUpperDiff).to.be.equal(positionInfoAfterDeposit.tickUpperDiff);
        expect(positionInfo.amount0Returned).to.be.equal(positionInfoAfterDeposit.amount0Returned);
        expect(positionInfo.amount1Returned).to.be.equal(positionInfoAfterDeposit.amount1Returned);
        expect(positionInfo.amount0ReturnedUsdValue).to.be.equal(positionInfoAfterDeposit.amount0ReturnedUsdValue);
        expect(positionInfo.amount1ReturnedUsdValue).to.be.equal(positionInfoAfterDeposit.amount1ReturnedUsdValue);

        // get positionTokenInfo
        const positionTokenInfo = await positionHelper.getPositionTokenInfo(user.address, positionIdInLog);
        const { token0, token1, fee, tickLower, tickUpper } = await nonFungiblePositionManager.positions(
          positionTokenInfo.tokenId,
        );
        expect(positionTokenInfo.tokenId).to.be.equal(positionInfoAfterDeposit.tokenId);
        expect(positionTokenInfo.token0).to.be.equal(token0);
        expect(positionTokenInfo.token1).to.be.equal(token1);
        expect(positionTokenInfo.fee).to.be.equal(fee);
        expect(positionTokenInfo.tickLower).to.be.equal(tickLower);
        expect(positionTokenInfo.tickUpper).to.be.equal(tickUpper);
        expect(positionTokenInfo.strategyProvider).to.be.equal(positionInfoAfterDeposit.strategyProvider);
        expect(positionTokenInfo.strategyId).to.be.equal(positionInfoAfterDeposit.strategyId);
        expect(positionTokenInfo.totalDepositUSDValue).to.be.equal(positionInfoAfterDeposit.totalDepositUSDValue);
        expect(positionTokenInfo.tickLowerDiff).to.be.equal(positionInfoAfterDeposit.tickLowerDiff);
        expect(positionTokenInfo.tickLowerDiff).to.be.equal(positionInfoAfterDeposit.tickLowerDiff);

        // get tick info
        const tickInfo = await positionHelper.getTickInfo(user.address, positionIdInLog);
        const { tick } = await poolOPUSDT.slot0();
        expect(tickInfo.currentTick).to.be.equal(tick);
        expect(tickInfo.tickLower).to.be.equal(tickLower);
        expect(tickInfo.tickUpper).to.be.equal(tickUpper);

        // get amounts
        const amountsInfo = await positionHelper.getAmounts(user.address, positionIdInLog);
        expect(amountsInfo.token0).to.be.equal(token0);
        expect(amountsInfo.token1).to.be.equal(token1);
        expect(amountsInfo.amount0).to.be.equal(amount0Deposited);
        expect(amountsInfo.amount1).to.be.equal(amount1Deposited);
        expect(amountsInfo.amount0UsdValue).to.be.greaterThan(0);
        expect(amountsInfo.amount1UsdValue).to.be.greaterThan(0);

        // get uncollectedFees
        const uncollectedFeesInfo = await positionHelper.getUncollectedFees(user.address, positionIdInLog);
        expect(uncollectedFeesInfo.token0).to.be.equal(token0);
        expect(uncollectedFeesInfo.token1).to.be.equal(token1);
        expect(uncollectedFeesInfo.amount0).to.be.equal(0);
        expect(uncollectedFeesInfo.amount1).to.be.equal(0);
        expect(uncollectedFeesInfo.amount0UsdValue).to.be.equal(0);
        expect(uncollectedFeesInfo.amount1UsdValue).to.be.equal(0);

        // estimate withdraw position
        // const estimateWithdrawPositionInfo = await positionHelper.estimateWithdrawPosition(user.address, positionIdInLog);
      }
      // swap for forcing out of tick range
      await swapRouter.connect(user2).exactInputSingle({
        tokenIn: token0.address,
        tokenOut: token1.address,
        fee: 500,
        recipient: user2.address,
        deadline: Date.now() + 1000,
        amountIn: 6000n * 10n ** 18n,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      });

      {
        // get positionHelper
        const positionInfo = await positionHelper.getPositionInfo(user.address, positionIdInLog);
        expect(positionInfo.tokenId).to.be.equal(positionInfoAfterDeposit.tokenId);
        expect(positionInfo.strategyProvider).to.be.equal(positionInfoAfterDeposit.strategyProvider);
        expect(positionInfo.strategyId).to.be.equal(positionInfoAfterDeposit.strategyId);
        expect(positionInfo.totalDepositUSDValue).to.be.equal(positionInfoAfterDeposit.totalDepositUSDValue);
        expect(positionInfo.amount0CollectedFee).to.be.equal(positionInfoAfterDeposit.amount0CollectedFee);
        expect(positionInfo.amount1CollectedFee).to.be.equal(positionInfoAfterDeposit.amount1CollectedFee);
        expect(positionInfo.amount0Leftover).to.be.equal(positionInfoAfterDeposit.amount0Leftover);
        expect(positionInfo.amount1Leftover).to.be.equal(positionInfoAfterDeposit.amount1Leftover);
        expect(positionInfo.tickLowerDiff).to.be.equal(positionInfoAfterDeposit.tickLowerDiff);
        expect(positionInfo.tickUpperDiff).to.be.equal(positionInfoAfterDeposit.tickUpperDiff);
        expect(positionInfo.amount0Returned).to.be.equal(positionInfoAfterDeposit.amount0Returned);
        expect(positionInfo.amount1Returned).to.be.equal(positionInfoAfterDeposit.amount1Returned);
        expect(positionInfo.amount0ReturnedUsdValue).to.be.equal(positionInfoAfterDeposit.amount0ReturnedUsdValue);
        expect(positionInfo.amount1ReturnedUsdValue).to.be.equal(positionInfoAfterDeposit.amount1ReturnedUsdValue);

        // get positionTokenInfo
        const positionTokenInfo = await positionHelper.getPositionTokenInfo(user.address, positionIdInLog);
        const { token0, token1, fee, tickLower, tickUpper } = await nonFungiblePositionManager.positions(
          positionTokenInfo.tokenId,
        );
        expect(positionTokenInfo.tokenId).to.be.equal(positionInfoAfterDeposit.tokenId);
        expect(positionTokenInfo.token0).to.be.equal(token0);
        expect(positionTokenInfo.token1).to.be.equal(token1);
        expect(positionTokenInfo.fee).to.be.equal(fee);
        expect(positionTokenInfo.tickLower).to.be.equal(tickLower);
        expect(positionTokenInfo.tickUpper).to.be.equal(tickUpper);
        expect(positionTokenInfo.strategyProvider).to.be.equal(positionInfoAfterDeposit.strategyProvider);
        expect(positionTokenInfo.strategyId).to.be.equal(positionInfoAfterDeposit.strategyId);
        expect(positionTokenInfo.totalDepositUSDValue).to.be.equal(positionInfoAfterDeposit.totalDepositUSDValue);
        expect(positionTokenInfo.tickLowerDiff).to.be.equal(positionInfoAfterDeposit.tickLowerDiff);
        expect(positionTokenInfo.tickLowerDiff).to.be.equal(positionInfoAfterDeposit.tickLowerDiff);

        // get tick info
        const tickInfo = await positionHelper.getTickInfo(user.address, positionIdInLog);
        const { tick } = await poolOPUSDT.slot0();
        expect(tickInfo.currentTick).to.be.equal(tick);
        expect(tickInfo.tickLower).to.be.equal(tickLower);
        expect(tickInfo.tickUpper).to.be.equal(tickUpper);

        // get amounts
        const amountsInfo = await positionHelper.getAmounts(user.address, positionIdInLog);
        expect(amountsInfo.token0).to.be.equal(token0);
        expect(amountsInfo.token1).to.be.equal(token1);
        expect(amountsInfo.amount0).to.be.greaterThan(amount0Deposited);
        expect(amountsInfo.amount1).to.be.equal(0);
        expect(amountsInfo.amount0UsdValue).to.be.greaterThan(0);
        expect(amountsInfo.amount1UsdValue).to.be.equal(0);

        // get uncollectedFees
        const uncollectedFeesInfo = await positionHelper.getUncollectedFees(user.address, positionIdInLog);
        expect(uncollectedFeesInfo.token0).to.be.equal(token0);
        expect(uncollectedFeesInfo.token1).to.be.equal(token1);
        expect(uncollectedFeesInfo.amount0).to.be.greaterThan(0);
        expect(uncollectedFeesInfo.amount1).to.be.equal(0);
        expect(uncollectedFeesInfo.amount0UsdValue).to.be.greaterThan(0);
        expect(uncollectedFeesInfo.amount1UsdValue).to.be.equal(0);

        // estimate withdraw position
        // const estimateWithdrawPositionInfo = await positionHelper.estimateWithdrawPosition(user.address, positionIdInLog);
      }

      const ethBalanceRebalanceFeeRecipient = await ethers.provider.getBalance(rebalanceFeeRecipient.address);
      // rebalance
      const txRebalance = await idleLiquidityModule.connect(keeper).rebalance({
        userAddress: user.address,
        feeReceiver: rebalanceFeeRecipient.address,
        positionId: positionIdInLog,
        estimatedGasFee: 10000n,
        isForced: false,
      });
      const receiptRebalance = await txRebalance.wait();
      const eventsRebalance: any = receiptRebalance.events;
      const positionIdInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.positionId;
      const closedTokenIdInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.closedTokenId;
      const mintedTokenIdInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.mintedTokenId;
      const collectedFee0InLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.collectedFee0;
      const collectedFee1InLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.collectedFee1;

      expect(positionIdInLogRebalance).to.be.equal(positionIdInLog);
      expect(closedTokenIdInLogRebalance).to.be.equal(tokenIdInLog);
      let countAfterRebalance = 0;

      let tokenIdClosed: BigNumber = BigNumber.from(0);
      let amount0CollectedFee: BigNumber = BigNumber.from(0);
      let amount1CollectedFee: BigNumber = BigNumber.from(0);
      // let amount0Removed: BigNumber = BigNumber.from(0);
      // let amount1Removed: BigNumber = BigNumber.from(0);

      let token0Repaid: BigNumber = BigNumber.from(0);
      let token1Repaid: BigNumber = BigNumber.from(0);
      let totalWETH9Repaid: BigNumber = BigNumber.from(0);

      let amount0OutSwapped: BigNumber = BigNumber.from(0);
      let amount1OutSwapped: BigNumber = BigNumber.from(0);

      let tokenIdMinted: BigNumber = BigNumber.from(0);
      let amount0DepositedMinted: BigNumber = BigNumber.from(0);
      let amount1DepositedMinted: BigNumber = BigNumber.from(0);
      let amount0LeftoverMinted: BigNumber = BigNumber.from(0);
      let amount1LeftoverMinted: BigNumber = BigNumber.from(0);

      for (let i = 0; i < eventsRebalance.length; i++) {
        if (eventsRebalance[i].address === positionManager.address) {
          countAfterRebalance++;
          const eventData = parseEventData(eventsRebalance[i].data);
          if (countAfterRebalance == 1) {
            //close position
            tokenIdClosed = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
            amount0CollectedFee = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
            amount1CollectedFee = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
            // amount0Removed = BigNumber.from(hexToInt256(hexToBn(eventData[3])));
            // amount1Removed = BigNumber.from(hexToInt256(hexToBn(eventData[4])));
          }

          if (countAfterRebalance == 2) {
            // repay rebalance fee
            token0Repaid = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
            token1Repaid = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
            totalWETH9Repaid = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
          }

          if (countAfterRebalance == 3) {
            // swap to position ratio
            amount0OutSwapped = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
            amount1OutSwapped = BigNumber.from(hexToInt256(hexToBn(eventData[3])));
          }

          if (countAfterRebalance == 4) {
            // mint
            tokenIdMinted = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
            amount0DepositedMinted = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
            amount1DepositedMinted = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
            amount0LeftoverMinted = BigNumber.from(hexToInt256(hexToBn(eventData[3])));
            amount1LeftoverMinted = BigNumber.from(hexToInt256(hexToBn(eventData[4])));
          }
        }
      }

      expect(countAfterRebalance).to.be.equal(4);
      expect(tokenIdClosed).to.be.equal(tokenIdInLog);
      expect(amount0CollectedFee.sub(token0Repaid)).to.be.equal(collectedFee0InLogRebalance);
      expect(amount1CollectedFee.sub(token1Repaid)).to.be.equal(collectedFee1InLogRebalance);
      expect(ethBalanceRebalanceFeeRecipient.add(totalWETH9Repaid)).to.be.equal(
        await ethers.provider.getBalance(rebalanceFeeRecipient.address),
      );
      expect(amount0DepositedMinted).to.be.lessThanOrEqual(amount0OutSwapped);
      expect(amount1DepositedMinted).to.be.lessThanOrEqual(amount1OutSwapped);
      expect(tokenIdMinted).to.be.equal(mintedTokenIdInLogRebalance);

      const positionInfoAfterRebalance = await positionManager.getPositionInfo(positionIdInLog);
      expect(positionInfoAfterRebalance.tokenId).to.be.equal(mintedTokenIdInLogRebalance);
      expect(positionInfoAfterRebalance.strategyProvider).to.be.equal(zeroAddress);
      expect(positionInfoAfterRebalance.strategyId).to.be.equal(strategyIdInLog);
      expect(positionInfoAfterRebalance.totalDepositUSDValue).to.be.greaterThan(0);
      expect(positionInfoAfterRebalance.amount0CollectedFee).to.be.equal(collectedFee0InLogRebalance);
      expect(positionInfoAfterRebalance.amount1CollectedFee).to.be.equal(collectedFee1InLogRebalance);
      expect(positionInfoAfterRebalance.amount0Leftover).to.be.equal(amount0LeftoverMinted);
      expect(positionInfoAfterRebalance.amount1Leftover).to.be.equal(amount1LeftoverMinted);
      expect(positionInfoAfterRebalance.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfoAfterRebalance.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      expect(positionInfoAfterRebalance.amount0Returned).to.be.equal(0);
      expect(positionInfoAfterRebalance.amount1Returned).to.be.equal(0);
      expect(positionInfoAfterRebalance.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionInfoAfterRebalance.amount1ReturnedUsdValue).to.be.equal(0);

      {
        // withdraw
        const user0BalanceBeforeWithdraw = await token0.balanceOf(user.address);
        const user1BalanceBeforeWithdraw = await token1.balanceOf(user.address);
        const txWithdraw = await withdrawRecipes.connect(user).withdraw(positionIdInLog);
        const receiptWithdraw = await txWithdraw.wait();
        const eventsWithdraw: any = receiptWithdraw.events;
        const fromInLogWithdraw = eventsWithdraw[eventsWithdraw.length - 1].args.from;
        const positionIdInLogWithdraw = eventsWithdraw[eventsWithdraw.length - 1].args.positionId;
        const tokenIdInLogWithdraw = eventsWithdraw[eventsWithdraw.length - 1].args.tokenId;

        expect(fromInLogWithdraw).to.be.equal(user.address);
        expect(positionIdInLogWithdraw).to.be.equal(positionIdInLog);
        expect(tokenIdInLogWithdraw).to.be.equal(mintedTokenIdInLogRebalance);

        let tokenIdClosed: BigNumber = BigNumber.from(0);
        let amount0CollectedFee: BigNumber = BigNumber.from(0);
        let amount1CollectedFee: BigNumber = BigNumber.from(0);
        let amount0Removed: BigNumber = BigNumber.from(0);
        let amount1Removed: BigNumber = BigNumber.from(0);
        let countClosed = 0;
        for (let i = 0; i < eventsWithdraw.length; i++) {
          if (eventsWithdraw[i].address === positionManager.address) {
            countClosed++;
            if (countClosed == 1) {
              const eventData = parseEventData(eventsWithdraw[i].data);
              tokenIdClosed = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
              amount0CollectedFee = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
              amount1CollectedFee = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
              amount0Removed = BigNumber.from(hexToInt256(hexToBn(eventData[3])));
              amount1Removed = BigNumber.from(hexToInt256(hexToBn(eventData[4])));
            }
          }
        }
        const user0BalanceAfterWithdraw = await token0.balanceOf(user.address);
        const user1BalanceAfterWithdraw = await token1.balanceOf(user.address);
        expect(tokenIdClosed).to.be.equal(mintedTokenIdInLogRebalance);
        expect(user0BalanceAfterWithdraw).to.be.equal(
          user0BalanceBeforeWithdraw.add(amount0Removed).add(amount0CollectedFee).add(amount0LeftoverMinted),
        );
        expect(user1BalanceAfterWithdraw).to.be.equal(
          user1BalanceBeforeWithdraw.add(amount1Removed).add(amount1CollectedFee).add(amount1LeftoverMinted),
        );
        const positionInfoClosed = await positionManager.getPositionInfo(positionIdInLog);
        expect(positionInfoClosed.tokenId).to.be.equal(mintedTokenIdInLogRebalance);
        expect(positionInfoClosed.strategyProvider).to.be.equal(zeroAddress);
        expect(positionInfoClosed.strategyId).to.be.equal(strategyIdInLog);
        expect(positionInfoClosed.totalDepositUSDValue).to.be.greaterThan(0);
        expect(positionInfoClosed.amount0CollectedFee).to.be.equal(
          amount0CollectedFee.add(collectedFee0InLogRebalance),
        );
        expect(positionInfoClosed.amount1CollectedFee).to.be.equal(
          amount1CollectedFee.add(collectedFee1InLogRebalance),
        );
        expect(positionInfoClosed.amount0Leftover).to.be.equal(0);
        expect(positionInfoClosed.amount1Leftover).to.be.equal(0);
        expect(positionInfoClosed.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
        expect(positionInfoClosed.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
        expect(positionInfoClosed.amount0Returned).to.be.equal(
          amount0Removed.add(amount0CollectedFee).add(amount0LeftoverMinted),
        );
        expect(positionInfoClosed.amount1Returned).to.be.equal(
          amount1Removed.add(amount1CollectedFee).add(amount1LeftoverMinted),
        );
        expect(positionInfoClosed.amount0ReturnedUsdValue).to.be.greaterThan(0);
        expect(positionInfoClosed.amount1ReturnedUsdValue).to.be.greaterThan(0);

        // get positionHelper
        const positionInfo = await positionHelper.getPositionInfo(user.address, positionIdInLog);
        expect(positionInfo.tokenId).to.be.equal(positionInfoClosed.tokenId);
        expect(positionInfo.strategyProvider).to.be.equal(positionInfoClosed.strategyProvider);
        expect(positionInfo.strategyId).to.be.equal(positionInfoClosed.strategyId);
        expect(positionInfo.totalDepositUSDValue).to.be.equal(positionInfoClosed.totalDepositUSDValue);
        expect(positionInfo.amount0CollectedFee).to.be.equal(positionInfoClosed.amount0CollectedFee);
        expect(positionInfo.amount1CollectedFee).to.be.equal(positionInfoClosed.amount1CollectedFee);
        expect(positionInfo.amount0Leftover).to.be.equal(positionInfoClosed.amount0Leftover);
        expect(positionInfo.amount1Leftover).to.be.equal(positionInfoClosed.amount1Leftover);
        expect(positionInfo.tickLowerDiff).to.be.equal(positionInfoClosed.tickLowerDiff);
        expect(positionInfo.tickUpperDiff).to.be.equal(positionInfoClosed.tickUpperDiff);
        expect(positionInfo.amount0Returned).to.be.equal(positionInfoClosed.amount0Returned);
        expect(positionInfo.amount1Returned).to.be.equal(positionInfoClosed.amount1Returned);
        expect(positionInfo.amount0ReturnedUsdValue).to.be.equal(positionInfoClosed.amount0ReturnedUsdValue);
        expect(positionInfo.amount1ReturnedUsdValue).to.be.equal(positionInfoClosed.amount1ReturnedUsdValue);
      }
    });

    it("estimate withdraw the position with strategy provider", async function () {
      // give pool some liquidity
      await providePoolLiquidity();

      const strategyId = ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16);
      const token0 = tokenOP.address < tokenUSDT.address ? tokenOP : tokenUSDT;
      const token1 = tokenOP.address < tokenUSDT.address ? tokenUSDT : tokenOP;
      const amount0Desired: BigNumber = BigNumber.from(10n * 10n ** 18n);
      const amount1Desired: BigNumber = BigNumber.from(2n * 10n ** 18n);
      const tickLowerDiff = 0n - 120n;
      const tickUpperDiff = 0n + 120n;
      const user0BalanceBefore = await token0.balanceOf(user.address);
      const user1BalanceBefore = await token1.balanceOf(user.address);

      // user2 add strategy
      const user2WalltAddress = await strategyProviderWalletFactory.providerToWallet(user2.address);
      const user2Wallet = (await ethers.getContractAt(
        "StrategyProviderWallet",
        user2WalltAddress,
      )) as StrategyProviderWallet;

      await user2Wallet
        .connect(user2)
        .addStrategy(
          strategyId,
          token0.address,
          token1.address,
          500,
          "2000",
          "0x0000000000000000000000000000000000000000",
          "3",
        );

      const txDeposit = await depositRecipes.connect(user).depositListedStrategy({
        token0: token0.address,
        token1: token1.address,
        fee: 500,
        tickLowerDiff: tickLowerDiff,
        tickUpperDiff: tickUpperDiff,
        amount0Desired: amount0Desired,
        amount1Desired: amount1Desired,
        strategyId: strategyId,
        strategyProvider: user2.address,
      });

      const receipt = await txDeposit.wait();
      const events: any = receipt.events;
      const fromInLog = events[events.length - 1].args.from;
      const positionIdInLog = events[events.length - 1].args.positionId;
      const strategyIdInLog = events[events.length - 1].args.strategyId;
      const strategyProviderInLog = events[events.length - 1].args.strategyProvider;

      expect(fromInLog).to.be.equal(user.address);
      expect(positionIdInLog).to.be.equal(1);
      expect(strategyIdInLog).to.be.equal(strategyId);
      expect(strategyProviderInLog).to.be.equal(user2.address);

      let amount0Deposited: BigNumber = BigNumber.from(0);
      let amount1Deposited: BigNumber = BigNumber.from(0);
      let tokenIdInLog: BigNumber = BigNumber.from(0);
      let count = 0;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === positionManager.address) {
          count++;

          const eventData = parseEventData(events[i].data);
          tokenIdInLog = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
          amount0Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
          amount1Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
        }
      }
      expect(count).to.be.equal(1);

      // user
      expect(await token0.balanceOf(user.address)).to.equal(user0BalanceBefore.sub(amount0Deposited));
      expect(await token1.balanceOf(user.address)).to.equal(user1BalanceBefore.sub(amount1Deposited));

      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);

      const positionInfo = await positionManager.getPositionInfo(positionIdInLog);
      expect(positionInfo.tokenId).to.be.equal(tokenIdInLog);
      expect(positionInfo.strategyProvider).to.be.equal(user2.address);
      expect(positionInfo.strategyId).to.be.equal(strategyIdInLog);
      expect(positionInfo.totalDepositUSDValue).to.be.greaterThan(0);
      expect(positionInfo.amount0CollectedFee).to.be.equal(0);
      expect(positionInfo.amount1CollectedFee).to.be.equal(0);
      expect(positionInfo.amount0Leftover).to.be.equal(0);
      expect(positionInfo.amount1Leftover).to.be.equal(0);
      expect(positionInfo.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfo.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      expect(positionInfo.amount0Returned).to.be.equal(0);
      expect(positionInfo.amount1Returned).to.be.equal(0);
      expect(positionInfo.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionInfo.amount1ReturnedUsdValue).to.be.equal(0);

      // swap
      await swapRouter.connect(user2).exactInputSingle({
        tokenIn: token0.address,
        tokenOut: token1.address,
        fee: 500,
        recipient: user2.address,
        deadline: Date.now() + 1000,
        amountIn: 100n * 10n ** 18n,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      });

      // estimate withdraw position
      const estimateWithdrawPositionInfo = await positionHelper.estimateWithdrawPosition(user.address, positionIdInLog);

      // withdraw
      const user0BalanceBeforeWithdraw = await token0.balanceOf(user.address);
      const user1BalanceBeforeWithdraw = await token1.balanceOf(user.address);
      const serviceFeeRecipient0BalanceBeforeWithdraw = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipient1BalanceBeforeWithdraw = await token1.balanceOf(serviceFeeRecipient.address);
      const strategyProvider0BalanceBeforeWithdraw = await token0.balanceOf(user2Wallet.address);
      const strategyProvider1BalanceBeforeWithdraw = await token1.balanceOf(user2Wallet.address);
      const txWithdraw = await withdrawRecipes.connect(user).withdraw(positionIdInLog);
      const receiptWithdraw = await txWithdraw.wait();
      const eventsWithdraw: any = receiptWithdraw.events;
      const fromInLogWithdraw = eventsWithdraw[eventsWithdraw.length - 1].args.from;
      const positionIdInLogWithdraw = eventsWithdraw[eventsWithdraw.length - 1].args.positionId;
      const tokenIdInLogWithdraw = eventsWithdraw[eventsWithdraw.length - 1].args.tokenId;

      expect(fromInLogWithdraw).to.be.equal(user.address);
      expect(positionIdInLogWithdraw).to.be.equal(positionIdInLog);
      expect(tokenIdInLogWithdraw).to.be.equal(tokenIdInLog);

      let tokenIdClosed: BigNumber = BigNumber.from(0);
      let amount0CollectedFee: BigNumber = BigNumber.from(0);
      let amount1CollectedFee: BigNumber = BigNumber.from(0);
      // let amount0Removed: BigNumber = BigNumber.from(0);
      // let amount1Removed: BigNumber = BigNumber.from(0);
      let performanceFeeAmount0: BigNumber = BigNumber.from(0);
      let performanceFeeAmount1: BigNumber = BigNumber.from(0);
      let serviceFeeAmount0: BigNumber = BigNumber.from(0);
      let serviceFeeAmount1: BigNumber = BigNumber.from(0);
      let returnedAmount0: BigNumber = BigNumber.from(0);
      let returnedAmount1: BigNumber = BigNumber.from(0);
      let countClosed = 0;
      for (let i = 0; i < eventsWithdraw.length; i++) {
        if (eventsWithdraw[i].address === positionManager.address) {
          countClosed++;
          if (countClosed == 1) {
            const eventData = parseEventData(eventsWithdraw[i].data);
            tokenIdClosed = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
            amount0CollectedFee = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
            amount1CollectedFee = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
            // amount0Removed = BigNumber.from(hexToInt256(hexToBn(eventData[3])));
            // amount1Removed = BigNumber.from(hexToInt256(hexToBn(eventData[4])));
          }

          if (countClosed == 2) {
            const eventData = parseEventData(eventsWithdraw[i].data);
            performanceFeeAmount0 = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
            performanceFeeAmount1 = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
            serviceFeeAmount0 = BigNumber.from(hexToInt256(hexToBn(eventData[3])));
            serviceFeeAmount1 = BigNumber.from(hexToInt256(hexToBn(eventData[4])));
            returnedAmount0 = BigNumber.from(hexToInt256(hexToBn(eventData[5])));
            returnedAmount1 = BigNumber.from(hexToInt256(hexToBn(eventData[6])));
          }
        }
      }
      expect(tokenIdClosed).to.be.equal(tokenIdInLog);
      const user0BalanceAfterWithdraw = await token0.balanceOf(user.address);
      const user1BalanceAfterWithdraw = await token1.balanceOf(user.address);
      const serviceFeeRecipient0BalanceAfterWithdraw = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipient1BalanceAfterWithdraw = await token1.balanceOf(serviceFeeRecipient.address);
      const strategyProvider0BalanceAfterWithdraw = await token0.balanceOf(user2Wallet.address);
      const strategyProvider1BalanceAfterWithdraw = await token1.balanceOf(user2Wallet.address);

      expect(user0BalanceAfterWithdraw).to.be.equal(user0BalanceBeforeWithdraw.add(returnedAmount0));
      expect(user1BalanceAfterWithdraw).to.be.equal(user1BalanceBeforeWithdraw.add(returnedAmount1));
      expect(serviceFeeRecipient0BalanceAfterWithdraw).to.be.equal(
        serviceFeeRecipient0BalanceBeforeWithdraw.add(serviceFeeAmount0),
      );
      expect(serviceFeeRecipient1BalanceAfterWithdraw).to.be.equal(
        serviceFeeRecipient1BalanceBeforeWithdraw.add(serviceFeeAmount1),
      );
      expect(strategyProvider0BalanceAfterWithdraw).to.be.equal(
        strategyProvider0BalanceBeforeWithdraw.add(performanceFeeAmount0),
      );
      expect(strategyProvider1BalanceAfterWithdraw).to.be.equal(
        strategyProvider1BalanceBeforeWithdraw.add(performanceFeeAmount1),
      );

      const positionInfoClosed = await positionManager.getPositionInfo(positionIdInLog);
      expect(positionInfoClosed.tokenId).to.be.equal(tokenIdInLog);
      expect(positionInfoClosed.strategyProvider).to.be.equal(user2.address);
      expect(positionInfoClosed.strategyId).to.be.equal(strategyIdInLog);
      expect(positionInfoClosed.totalDepositUSDValue).to.be.greaterThan(0);
      expect(positionInfoClosed.amount0CollectedFee).to.be.equal(amount0CollectedFee);
      expect(positionInfoClosed.amount1CollectedFee).to.be.equal(amount1CollectedFee);
      expect(positionInfoClosed.amount0Leftover).to.be.equal(0);
      expect(positionInfoClosed.amount1Leftover).to.be.equal(0);
      expect(positionInfoClosed.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfoClosed.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      expect(positionInfoClosed.amount0Returned).to.be.equal(returnedAmount0);
      expect(positionInfoClosed.amount1Returned).to.be.equal(returnedAmount1);
      expect(positionInfoClosed.amount0ReturnedUsdValue).to.be.greaterThan(0);
      expect(positionInfoClosed.amount1ReturnedUsdValue).to.be.greaterThan(0);

      expect(estimateWithdrawPositionInfo.amount0Returned.sub(positionInfoClosed.amount0Returned)).to.be.equal(1n);
      expect(estimateWithdrawPositionInfo.amount1Returned.sub(positionInfoClosed.amount1Returned)).to.be.equal(1n);
      expect(estimateWithdrawPositionInfo.amount0ReturnedUsdValue).to.be.greaterThan(0);
      expect(estimateWithdrawPositionInfo.amount1ReturnedUsdValue).to.be.greaterThan(0);
      expect(estimateWithdrawPositionInfo.amount0ReturnedToken1Value).to.be.greaterThan(0);
      expect(estimateWithdrawPositionInfo.amount1ReturnedToken0Value).to.be.greaterThan(0);
    });
  });
});
