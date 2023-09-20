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
  MockToken,
  MockWETH9,
  PositionManager,
  PositionManagerFactory,
  Registry,
  RegistryAddressHolder,
  StrategyProviderWallet,
  StrategyProviderWalletFactory,
  WithdrawRecipes,
} from "../../types";
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

describe("WithdrawRecipes.sol", function () {
  //GLOBAL VARIABLE - USE THIS

  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let user2: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let serviceFeeRecipient: SignerWithAddress;
  let strategyProvider: SignerWithAddress;
  let registry: Registry;

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
  let registryAddressHolder: RegistryAddressHolder;

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

    //deploy the tokens - ETH, USDC
    tokenWETH9 = (await weth9Fixture()).weth9Fixture;
    tokenWETH = tokenWETH9 as unknown as MockToken;
    tokenUSDC = (await tokensFixture("USDC", 6)).tokenFixture;
    tokenUSDT = (await tokensFixture("USDT", 6)).tokenFixture;
    tokenOP = (await tokensFixture("OP", 18)).tokenFixture;

    //deploy uniswap contracts needed
    [uniswapV3Factory, nonFungiblePositionManager, swapRouter] = await deployUniswapContracts(tokenWETH);

    //deploy first pool
    poolUSDCWETH = (await poolFixture(tokenUSDC, tokenWETH, 3000, uniswapV3Factory, 0)).pool;
    poolUSDTWETH = (await poolFixture(tokenUSDT, tokenWETH, 3000, uniswapV3Factory, 0)).pool;
    poolOPWETH = (await poolFixture(tokenOP, tokenWETH, 3000, uniswapV3Factory, 0)).pool;
    poolOPUSDC = (await poolFixture(tokenOP, tokenUSDC, 3000, uniswapV3Factory, 1)).pool;
    poolOPUSDT = (await poolFixture(tokenOP, tokenUSDT, 3000, uniswapV3Factory, -1)).pool;
    poolUSDCUSDT = (await poolFixture(tokenUSDC, tokenUSDT, 3000, uniswapV3Factory, 0)).pool;

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
        "ReturnProfit",
        "ShareProfit",
        "ClosePosition",
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
        fee: 3000,
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
        fee: 3000,
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
        fee: 3000,
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
  }

  describe("withdraw", function () {
    it("withdraw the position without strategy provider", async function () {
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
      const txDeposit = await depositRecipes.connect(user).deposit({
        token0: token0.address,
        token1: token1.address,
        fee: 3000,
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
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === positionManager.address) {
          const eventData = parseEventData(events[i].data);
          tokenIdInLog = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
          amount0Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
          amount1Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
        }
      }
      // user
      expect(await token0.balanceOf(user.address)).to.equal(user0BalanceBefore.sub(amount0Deposited));
      expect(await token1.balanceOf(user.address)).to.equal(user1BalanceBefore.sub(amount1Deposited));

      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);

      const positionInfo = await positionManager.getPositionInfo(positionIdInLog);
      expect(positionInfo.tokenId).to.be.equal(tokenIdInLog);
      expect(positionInfo.strategyProvider).to.be.equal(zeroAddress);
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
        fee: 3000,
        recipient: user2.address,
        deadline: Date.now() + 1000,
        amountIn: 100n * 10n ** 18n,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      });

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
      expect(tokenIdInLogWithdraw).to.be.equal(tokenIdInLog);

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
      expect(tokenIdClosed).to.be.equal(tokenIdInLog);
      expect(user0BalanceAfterWithdraw).to.be.equal(
        user0BalanceBeforeWithdraw.add(amount0Removed).add(amount0CollectedFee),
      );
      expect(user1BalanceAfterWithdraw).to.be.equal(
        user1BalanceBeforeWithdraw.add(amount1Removed).add(amount1CollectedFee),
      );

      const positionInfoClosed = await positionManager.getPositionInfo(positionIdInLog);
      expect(positionInfoClosed.tokenId).to.be.equal(tokenIdInLog);
      expect(positionInfoClosed.strategyProvider).to.be.equal(zeroAddress);
      expect(positionInfoClosed.strategyId).to.be.equal(strategyIdInLog);
      expect(positionInfoClosed.totalDepositUSDValue).to.be.greaterThan(0);
      expect(positionInfoClosed.amount0CollectedFee).to.be.equal(amount0CollectedFee);
      expect(positionInfoClosed.amount1CollectedFee).to.be.equal(amount1CollectedFee);
      expect(positionInfoClosed.amount0Leftover).to.be.equal(0);
      expect(positionInfoClosed.amount1Leftover).to.be.equal(0);
      expect(positionInfoClosed.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfoClosed.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      expect(positionInfoClosed.amount0Returned).to.be.equal(amount0Removed.add(amount0CollectedFee));
      expect(positionInfoClosed.amount1Returned).to.be.equal(amount1Removed.add(amount1CollectedFee));
      expect(positionInfoClosed.amount0ReturnedUsdValue).to.be.greaterThan(0);
      expect(positionInfoClosed.amount1ReturnedUsdValue).to.be.greaterThan(0);
    });

    it("withdraw the position with strategy provider", async function () {
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
          3000,
          "2000",
          "0x0000000000000000000000000000000000000000",
          "3",
        );

      const txDeposit = await depositRecipes.connect(user).depositListedStrategy({
        token0: token0.address,
        token1: token1.address,
        fee: 3000,
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
        fee: 3000,
        recipient: user2.address,
        deadline: Date.now() + 1000,
        amountIn: 100n * 10n ** 18n,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      });

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
    });

    it("singleTokenWithdraw the position without strategy provider", async function () {
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
      const txDeposit = await depositRecipes.connect(user).deposit({
        token0: token0.address,
        token1: token1.address,
        fee: 3000,
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
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === positionManager.address) {
          const eventData = parseEventData(events[i].data);
          tokenIdInLog = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
          amount0Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
          amount1Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
        }
      }
      // user
      expect(await token0.balanceOf(user.address)).to.equal(user0BalanceBefore.sub(amount0Deposited));
      expect(await token1.balanceOf(user.address)).to.equal(user1BalanceBefore.sub(amount1Deposited));

      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);

      const positionInfo = await positionManager.getPositionInfo(positionIdInLog);
      expect(positionInfo.tokenId).to.be.equal(tokenIdInLog);
      expect(positionInfo.strategyProvider).to.be.equal(zeroAddress);
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
        fee: 3000,
        recipient: user2.address,
        deadline: Date.now() + 1000,
        amountIn: 100n * 10n ** 18n,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      });

      // withdraw
      const user0BalanceBeforeWithdraw = await token0.balanceOf(user.address);
      const user1BalanceBeforeWithdraw = await token1.balanceOf(user.address);
      const txWithdraw = await withdrawRecipes.connect(user).singleTokenWithdraw(positionIdInLog, true);
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
      let amount0Removed: BigNumber = BigNumber.from(0);
      // let amount1Removed: BigNumber = BigNumber.from(0);
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
            // amount1Removed = BigNumber.from(hexToInt256(hexToBn(eventData[4])));
          }
        }
      }
      const user0BalanceAfterWithdraw = await token0.balanceOf(user.address);
      const user1BalanceAfterWithdraw = await token1.balanceOf(user.address);
      expect(tokenIdClosed).to.be.equal(tokenIdInLog);
      expect(user0BalanceAfterWithdraw).to.be.greaterThan(
        user0BalanceBeforeWithdraw.add(amount0Removed).add(amount0CollectedFee),
      );
      expect(user1BalanceAfterWithdraw).to.be.equal(user1BalanceBeforeWithdraw);

      const positionInfoClosed = await positionManager.getPositionInfo(positionIdInLog);
      expect(positionInfoClosed.tokenId).to.be.equal(tokenIdInLog);
      expect(positionInfoClosed.strategyProvider).to.be.equal(zeroAddress);
      expect(positionInfoClosed.strategyId).to.be.equal(strategyIdInLog);
      expect(positionInfoClosed.totalDepositUSDValue).to.be.greaterThan(0);
      expect(positionInfoClosed.amount0CollectedFee).to.be.equal(amount0CollectedFee);
      expect(positionInfoClosed.amount1CollectedFee).to.be.equal(amount1CollectedFee);
      expect(positionInfoClosed.amount0Leftover).to.be.equal(0);
      expect(positionInfoClosed.amount1Leftover).to.be.equal(0);
      expect(positionInfoClosed.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfoClosed.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      expect(positionInfoClosed.amount0Returned).to.be.greaterThan(amount0Removed.add(amount0CollectedFee));
      expect(positionInfoClosed.amount1Returned).to.be.equal(0);
      expect(positionInfoClosed.amount0ReturnedUsdValue).to.be.greaterThan(0);
      expect(positionInfoClosed.amount1ReturnedUsdValue).to.be.equal(0);
    });

    it("singleTokenWithdraw the position with strategy provider", async function () {
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
          3000,
          "2000",
          "0x0000000000000000000000000000000000000000",
          "3",
        );

      const txDeposit = await depositRecipes.connect(user).depositListedStrategy({
        token0: token0.address,
        token1: token1.address,
        fee: 3000,
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
        fee: 3000,
        recipient: user2.address,
        deadline: Date.now() + 1000,
        amountIn: 100n * 10n ** 18n,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      });

      // withdraw
      const user0BalanceBeforeWithdraw = await token0.balanceOf(user.address);
      const user1BalanceBeforeWithdraw = await token1.balanceOf(user.address);
      const serviceFeeRecipient0BalanceBeforeWithdraw = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipient1BalanceBeforeWithdraw = await token1.balanceOf(serviceFeeRecipient.address);
      const strategyProvider0BalanceBeforeWithdraw = await token0.balanceOf(user2Wallet.address);
      const strategyProvider1BalanceBeforeWithdraw = await token1.balanceOf(user2Wallet.address);
      const txWithdraw = await withdrawRecipes.connect(user).singleTokenWithdraw(positionIdInLog, false);
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

      expect(returnedAmount0).to.be.equal(0);

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
      expect(positionInfoClosed.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionInfoClosed.amount1ReturnedUsdValue).to.be.greaterThan(0);
    });

    it("should fail when withdraw recipes is paused", async function () {
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
          3000,
          "2000",
          "0x0000000000000000000000000000000000000000",
          "3",
        );

      const txDeposit = await depositRecipes.connect(user).depositListedStrategy({
        token0: token0.address,
        token1: token1.address,
        fee: 3000,
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
        fee: 3000,
        recipient: user2.address,
        deadline: Date.now() + 1000,
        amountIn: 100n * 10n ** 18n,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      });

      // withdraw
      const user0BalanceBeforeWithdraw = await token0.balanceOf(user.address);
      const user1BalanceBeforeWithdraw = await token1.balanceOf(user.address);
      const serviceFeeRecipient0BalanceBeforeWithdraw = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipient1BalanceBeforeWithdraw = await token1.balanceOf(serviceFeeRecipient.address);
      const strategyProvider0BalanceBeforeWithdraw = await token0.balanceOf(user2Wallet.address);
      const strategyProvider1BalanceBeforeWithdraw = await token1.balanceOf(user2Wallet.address);

      // pause withdraw recipes
      await withdrawRecipes.connect(deployer).pause();

      await expect(withdrawRecipes.connect(user).singleTokenWithdraw(positionIdInLog, false)).to.be.revertedWith(
        "Pausable: paused",
      );

      // unpause withdraw recipes
      await withdrawRecipes.connect(deployer).unpause();

      const txWithdraw = await withdrawRecipes.connect(user).singleTokenWithdraw(positionIdInLog, false);
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

      expect(returnedAmount0).to.be.equal(0);

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
      expect(positionInfoClosed.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionInfoClosed.amount1ReturnedUsdValue).to.be.greaterThan(0);
    });

    it("should fail when the position is not running", async function () {
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
          3000,
          "2000",
          "0x0000000000000000000000000000000000000000",
          "3",
        );

      const txDeposit = await depositRecipes.connect(user).depositListedStrategy({
        token0: token0.address,
        token1: token1.address,
        fee: 3000,
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
        fee: 3000,
        recipient: user2.address,
        deadline: Date.now() + 1000,
        amountIn: 100n * 10n ** 18n,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      });

      // withdraw
      const user0BalanceBeforeWithdraw = await token0.balanceOf(user.address);
      const user1BalanceBeforeWithdraw = await token1.balanceOf(user.address);
      const serviceFeeRecipient0BalanceBeforeWithdraw = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipient1BalanceBeforeWithdraw = await token1.balanceOf(serviceFeeRecipient.address);
      const strategyProvider0BalanceBeforeWithdraw = await token0.balanceOf(user2Wallet.address);
      const strategyProvider1BalanceBeforeWithdraw = await token1.balanceOf(user2Wallet.address);

      const txWithdraw = await withdrawRecipes.connect(user).singleTokenWithdraw(positionIdInLog, false);
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

      expect(returnedAmount0).to.be.equal(0);

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
      expect(positionInfoClosed.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionInfoClosed.amount1ReturnedUsdValue).to.be.greaterThan(0);

      await expect(withdrawRecipes.connect(user).singleTokenWithdraw(positionIdInLog, false)).to.be.revertedWith(
        "WRPIR",
      );
    });
  });
});
