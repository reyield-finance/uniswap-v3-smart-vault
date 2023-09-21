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
  IZapIn,
  MockToken,
  MockWETH9,
  PositionManager,
  PositionManagerFactory,
  Registry,
  RegistryAddressHolder,
  StrategyProviderWallet,
  StrategyProviderWalletFactory,
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

describe("DepositRecipes.sol", function () {
  //GLOBAL VARIABLE - USE THIS

  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let user2: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let serviceFeeRecipient: SignerWithAddress;
  let strategyProvider: SignerWithAddress;
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
      ["IncreaseLiquidity", "SingleTokenIncreaseLiquidity", "Mint", "ZapIn"],
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

    await registry.addNewContract(
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("DepositRecipes")),
      depositRecipes.address,
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
      [user, liquidityProvider],
      [nonFungiblePositionManager.address, positionManager.address, depositRecipes.address],
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

  describe("deposit", function () {
    it("deposit", async function () {
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
      let count = 0;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === positionManager.address) {
          count++;

          const eventData = parseEventData(events[i].data);
          tokenIdInLog = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
          amount0Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
          amount1Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
          break;
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
    });

    it("depositListedStrategy", async function () {
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

      await user2Wallet.connect(user2).addStrategy(strategyId, token0.address, token1.address, 3000, "2000", 2, "3");

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
          break;
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
    });

    it("increaseLiquidity", async function () {
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

      await user2Wallet.connect(user2).addStrategy(strategyId, token0.address, token1.address, 3000, "2000", 2, "3");

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
          break;
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

      // increase liquidity
      const user0BalanceBeforeIncrease = await token0.balanceOf(user.address);
      const user1BalanceBeforeIncrease = await token1.balanceOf(user.address);
      const amount0Increase: BigNumber = BigNumber.from(3n * 10n ** 18n);
      const amount1Increase: BigNumber = BigNumber.from(4n * 10n ** 18n);
      const txIncreased = await depositRecipes
        .connect(user)
        .increaseLiquidity(positionIdInLog, amount0Increase, amount1Increase);
      const receiptIncreased = await txIncreased.wait();
      const eventsIncreased: any = receiptIncreased.events;
      const fromInLogIncreased = eventsIncreased[eventsIncreased.length - 1].args.from;
      const positionIdInLogIncreased = eventsIncreased[eventsIncreased.length - 1].args.positionId;

      expect(fromInLogIncreased).to.be.equal(user.address);
      expect(positionIdInLogIncreased).to.be.equal(positionIdInLog);

      let amount0Increased: BigNumber = BigNumber.from(0);
      let amount1Increased: BigNumber = BigNumber.from(0);
      let tokenIdIncreasedInLog: BigNumber = BigNumber.from(0);
      let countIncreased = 0;
      for (let i = 0; i < eventsIncreased.length; i++) {
        if (eventsIncreased[i].address === positionManager.address) {
          countIncreased++;

          const eventData = parseEventData(eventsIncreased[i].data);
          tokenIdIncreasedInLog = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
          amount0Increased = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
          amount1Increased = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
          break;
        }
      }
      expect(countIncreased).to.be.equal(1);
      expect(tokenIdIncreasedInLog).to.be.equal(tokenIdInLog);

      expect(await token0.balanceOf(user.address)).to.equal(user0BalanceBeforeIncrease.sub(amount0Increased));
      expect(await token1.balanceOf(user.address)).to.equal(user1BalanceBeforeIncrease.sub(amount1Increased));
      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);

      const positionInfoIncreased = await positionManager.getPositionInfo(positionIdInLogIncreased);
      expect(positionInfoIncreased.tokenId).to.be.equal(tokenIdInLog);
      expect(positionInfoIncreased.strategyProvider).to.be.equal(user2.address);
      expect(positionInfoIncreased.strategyId).to.be.equal(strategyIdInLog);
      expect(positionInfoIncreased.totalDepositUSDValue).to.be.greaterThan(positionInfo.totalDepositUSDValue);
      expect(positionInfoIncreased.amount0CollectedFee).to.be.equal(0);
      expect(positionInfoIncreased.amount1CollectedFee).to.be.equal(0);
      expect(positionInfoIncreased.amount0Leftover).to.be.equal(0);
      expect(positionInfoIncreased.amount1Leftover).to.be.equal(0);
      expect(positionInfoIncreased.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfoIncreased.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      expect(positionInfoIncreased.amount0Returned).to.be.equal(0);
      expect(positionInfoIncreased.amount1Returned).to.be.equal(0);
      expect(positionInfoIncreased.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionInfoIncreased.amount1ReturnedUsdValue).to.be.equal(0);
    });

    it("singleTokenDeposit", async function () {
      // give pool some liquidity
      await providePoolLiquidity();

      const strategyId = ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16);
      const token0 = tokenOP.address < tokenUSDT.address ? tokenOP : tokenUSDT;
      const token1 = tokenOP.address < tokenUSDT.address ? tokenUSDT : tokenOP;
      const amount0Desired: BigNumber = BigNumber.from(10n * 10n ** 18n);
      const isToken0In = true;
      const tickLowerDiff = 0n - 120n;
      const tickUpperDiff = 0n + 120n;
      const user0BalanceBefore = await token0.balanceOf(user.address);
      const user1BalanceBefore = await token1.balanceOf(user.address);
      const txDeposit = await depositRecipes.connect(user).singleTokenDeposit({
        token0: token0.address,
        token1: token1.address,
        isToken0In: isToken0In,
        fee: 3000,
        tickLowerDiff: tickLowerDiff,
        tickUpperDiff: tickUpperDiff,
        amountIn: amount0Desired,
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
      // let amount1Deposited: BigNumber = BigNumber.from(0);
      let amountInInLog: BigNumber = BigNumber.from(0);
      let tokenIdInLog: BigNumber = BigNumber.from(0);
      let amount0LeftoverInLog: BigNumber = BigNumber.from(0);
      let amount1LeftoverInLog: BigNumber = BigNumber.from(0);
      let count = 0;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === positionManager.address) {
          count++;
          const eventData = parseEventData(events[i].data);
          tokenIdInLog = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
          amountInInLog = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
          amount0Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[3])));
          // amount1Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[4])));
          amount0LeftoverInLog = BigNumber.from(hexToInt256(hexToBn(eventData[5])));
          amount1LeftoverInLog = BigNumber.from(hexToInt256(hexToBn(eventData[6])));
          break;
        }
      }
      expect(count).to.be.equal(1);
      expect(amountInInLog).to.be.equal(amount0Desired);

      const positionInfo = await positionManager.getPositionInfo(positionIdInLog);
      expect(positionInfo.tokenId).to.be.equal(tokenIdInLog);
      expect(positionInfo.strategyProvider).to.be.equal(zeroAddress);
      expect(positionInfo.strategyId).to.be.equal(strategyIdInLog);
      expect(positionInfo.totalDepositUSDValue).to.be.greaterThan(0);
      expect(positionInfo.amount0CollectedFee).to.be.equal(0);
      expect(positionInfo.amount1CollectedFee).to.be.equal(0);
      expect(positionInfo.amount0Leftover).to.be.equal(amount0LeftoverInLog);
      expect(positionInfo.amount1Leftover).to.be.equal(amount1LeftoverInLog);
      expect(positionInfo.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfo.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      expect(positionInfo.amount0Returned).to.be.equal(0);
      expect(positionInfo.amount1Returned).to.be.equal(0);
      expect(positionInfo.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionInfo.amount1ReturnedUsdValue).to.be.equal(0);
      // user
      expect(await token0.balanceOf(user.address)).to.lessThan(user0BalanceBefore.sub(amount0Deposited));
      expect(await token1.balanceOf(user.address)).to.equal(user1BalanceBefore);
      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(positionInfo.amount0Leftover);
      expect(await token1.balanceOf(positionManager.address)).to.equal(positionInfo.amount1Leftover);
    });

    it("singleTokenDepositListedStrategy", async function () {
      // give pool some liquidity
      await providePoolLiquidity();

      const strategyId = ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16);
      const token0 = tokenOP.address < tokenUSDT.address ? tokenOP : tokenUSDT;
      const token1 = tokenOP.address < tokenUSDT.address ? tokenUSDT : tokenOP;
      const amount0Desired: BigNumber = BigNumber.from(10n * 10n ** 18n);
      const isToken0In = true;
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

      await user2Wallet.connect(user2).addStrategy(strategyId, token0.address, token1.address, 3000, "2000", 2, "3");

      const txDeposit = await depositRecipes.connect(user).singleTokenDepositListedStrategy({
        token0: token0.address,
        token1: token1.address,
        isToken0In: isToken0In,
        fee: 3000,
        tickLowerDiff: tickLowerDiff,
        tickUpperDiff: tickUpperDiff,
        amountIn: amount0Desired,
        strategyId: strategyId,
        strategyProvider: user2.address,
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
      // let amount1Deposited: BigNumber = BigNumber.from(0);
      let amountInInLog: BigNumber = BigNumber.from(0);
      let tokenIdInLog: BigNumber = BigNumber.from(0);
      let amount0LeftoverInLog: BigNumber = BigNumber.from(0);
      let amount1LeftoverInLog: BigNumber = BigNumber.from(0);
      let count = 0;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === positionManager.address) {
          count++;
          const eventData = parseEventData(events[i].data);
          tokenIdInLog = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
          amountInInLog = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
          amount0Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[3])));
          // amount1Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[4])));
          amount0LeftoverInLog = BigNumber.from(hexToInt256(hexToBn(eventData[5])));
          amount1LeftoverInLog = BigNumber.from(hexToInt256(hexToBn(eventData[6])));
          break;
        }
      }
      expect(count).to.be.equal(1);
      expect(amountInInLog).to.be.equal(amount0Desired);

      const positionInfo = await positionManager.getPositionInfo(positionIdInLog);
      expect(positionInfo.tokenId).to.be.equal(tokenIdInLog);
      expect(positionInfo.strategyProvider).to.be.equal(user2.address);
      expect(positionInfo.strategyId).to.be.equal(strategyIdInLog);
      expect(positionInfo.totalDepositUSDValue).to.be.greaterThan(0);
      expect(positionInfo.amount0CollectedFee).to.be.equal(0);
      expect(positionInfo.amount1CollectedFee).to.be.equal(0);
      expect(positionInfo.amount0Leftover).to.be.equal(amount0LeftoverInLog);
      expect(positionInfo.amount1Leftover).to.be.equal(amount1LeftoverInLog);
      expect(positionInfo.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfo.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      expect(positionInfo.amount0Returned).to.be.equal(0);
      expect(positionInfo.amount1Returned).to.be.equal(0);
      expect(positionInfo.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionInfo.amount1ReturnedUsdValue).to.be.equal(0);
      // user
      expect(await token0.balanceOf(user.address)).to.lessThan(user0BalanceBefore.sub(amount0Deposited));
      expect(await token1.balanceOf(user.address)).to.equal(user1BalanceBefore);
      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(positionInfo.amount0Leftover);
      expect(await token1.balanceOf(positionManager.address)).to.equal(positionInfo.amount1Leftover);
    });

    it("singleTokenIncreaseLiquidity", async function () {
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

      await user2Wallet.connect(user2).addStrategy(strategyId, token0.address, token1.address, 3000, "2000", 2, "3");

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
          break;
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

      // single token increase liquidity
      const user0BalanceBeforeIncrease = await token0.balanceOf(user.address);
      const user1BalanceBeforeIncrease = await token1.balanceOf(user.address);
      const amount0Increase: BigNumber = BigNumber.from(3n * 10n ** 18n);
      // const amount1Increase: BigNumber = BigNumber.from(4n * 10n ** 18n);
      const isToken0In = true;
      const txIncreased = await depositRecipes
        .connect(user)
        .singleTokenIncreaseLiquidity(positionIdInLog, isToken0In, amount0Increase);
      const receiptIncreased = await txIncreased.wait();
      const eventsIncreased: any = receiptIncreased.events;
      const fromInLogIncreased = eventsIncreased[eventsIncreased.length - 1].args.from;
      const positionIdInLogIncreased = eventsIncreased[eventsIncreased.length - 1].args.positionId;

      expect(fromInLogIncreased).to.be.equal(user.address);
      expect(positionIdInLogIncreased).to.be.equal(positionIdInLog);
      let amountInInLog: BigNumber = BigNumber.from(0);
      let amount0Increased: BigNumber = BigNumber.from(0);
      // let amount1Increased: BigNumber = BigNumber.from(0);
      let tokenIdIncreasedInLog: BigNumber = BigNumber.from(0);
      let amount0LeftoverInLog: BigNumber = BigNumber.from(0);
      let amount1LeftoverInLog: BigNumber = BigNumber.from(0);
      let countIncreased = 0;
      for (let i = 0; i < eventsIncreased.length; i++) {
        if (eventsIncreased[i].address === positionManager.address) {
          countIncreased++;

          const eventData = parseEventData(eventsIncreased[i].data);
          tokenIdIncreasedInLog = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
          amountInInLog = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
          amount0Increased = BigNumber.from(hexToInt256(hexToBn(eventData[3])));
          // amount1Increased = BigNumber.from(hexToInt256(hexToBn(eventData[4])));
          amount0LeftoverInLog = BigNumber.from(hexToInt256(hexToBn(eventData[5])));
          amount1LeftoverInLog = BigNumber.from(hexToInt256(hexToBn(eventData[6])));
          break;
        }
      }
      expect(countIncreased).to.be.equal(1);
      expect(tokenIdIncreasedInLog).to.be.equal(tokenIdInLog);
      expect(amountInInLog).to.be.equal(amount0Increase);

      expect(await token0.balanceOf(user.address)).to.lessThan(user0BalanceBeforeIncrease.sub(amount0Increased));
      expect(await token1.balanceOf(user.address)).to.equal(user1BalanceBeforeIncrease);
      expect(await token0.balanceOf(positionManager.address)).to.equal(amount0LeftoverInLog);
      expect(await token1.balanceOf(positionManager.address)).to.equal(amount1LeftoverInLog);

      const positionInfoIncreased = await positionManager.getPositionInfo(positionIdInLogIncreased);
      expect(positionInfoIncreased.tokenId).to.be.equal(tokenIdInLog);
      expect(positionInfoIncreased.strategyProvider).to.be.equal(user2.address);
      expect(positionInfoIncreased.strategyId).to.be.equal(strategyIdInLog);
      expect(positionInfoIncreased.totalDepositUSDValue).to.be.greaterThan(positionInfo.totalDepositUSDValue);
      expect(positionInfoIncreased.amount0CollectedFee).to.be.equal(0);
      expect(positionInfoIncreased.amount1CollectedFee).to.be.equal(0);
      expect(positionInfoIncreased.amount0Leftover).to.be.equal(amount0LeftoverInLog);
      expect(positionInfoIncreased.amount1Leftover).to.be.equal(amount1LeftoverInLog);
      expect(positionInfoIncreased.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfoIncreased.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      expect(positionInfoIncreased.amount0Returned).to.be.equal(0);
      expect(positionInfoIncreased.amount1Returned).to.be.equal(0);
      expect(positionInfoIncreased.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionInfoIncreased.amount1ReturnedUsdValue).to.be.equal(0);
    });

    it("should fail to deposit when the recipes is paused", async function () {
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

      await user2Wallet.connect(user2).addStrategy(strategyId, token0.address, token1.address, 3000, "2000", "2", "3");

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
          break;
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

      // single token increase liquidity
      const user0BalanceBeforeIncrease = await token0.balanceOf(user.address);
      const user1BalanceBeforeIncrease = await token1.balanceOf(user.address);
      const amount0Increase: BigNumber = BigNumber.from(3n * 10n ** 18n);
      // const amount1Increase: BigNumber = BigNumber.from(4n * 10n ** 18n);

      const isToken0In = true;
      // pause deposit recipes
      await depositRecipes.connect(deployer).pause();

      await expect(
        depositRecipes.connect(user).singleTokenIncreaseLiquidity(positionIdInLog, isToken0In, amount0Increase),
      ).to.be.revertedWith("Pausable: paused");

      // unpause deposit recipes
      await depositRecipes.connect(deployer).unpause();

      const txIncreased = await depositRecipes
        .connect(user)
        .singleTokenIncreaseLiquidity(positionIdInLog, isToken0In, amount0Increase);
      const receiptIncreased = await txIncreased.wait();
      const eventsIncreased: any = receiptIncreased.events;
      const fromInLogIncreased = eventsIncreased[eventsIncreased.length - 1].args.from;
      const positionIdInLogIncreased = eventsIncreased[eventsIncreased.length - 1].args.positionId;

      expect(fromInLogIncreased).to.be.equal(user.address);
      expect(positionIdInLogIncreased).to.be.equal(positionIdInLog);
      let amountInInLog: BigNumber = BigNumber.from(0);
      let amount0Increased: BigNumber = BigNumber.from(0);
      // let amount1Increased: BigNumber = BigNumber.from(0);
      let tokenIdIncreasedInLog: BigNumber = BigNumber.from(0);
      let amount0LeftoverInLog: BigNumber = BigNumber.from(0);
      let amount1LeftoverInLog: BigNumber = BigNumber.from(0);
      let countIncreased = 0;
      for (let i = 0; i < eventsIncreased.length; i++) {
        if (eventsIncreased[i].address === positionManager.address) {
          countIncreased++;

          const eventData = parseEventData(eventsIncreased[i].data);
          tokenIdIncreasedInLog = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
          amountInInLog = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
          amount0Increased = BigNumber.from(hexToInt256(hexToBn(eventData[3])));
          // amount1Increased = BigNumber.from(hexToInt256(hexToBn(eventData[4])));
          amount0LeftoverInLog = BigNumber.from(hexToInt256(hexToBn(eventData[5])));
          amount1LeftoverInLog = BigNumber.from(hexToInt256(hexToBn(eventData[6])));
          break;
        }
      }
      expect(countIncreased).to.be.equal(1);
      expect(tokenIdIncreasedInLog).to.be.equal(tokenIdInLog);
      expect(amountInInLog).to.be.equal(amount0Increase);

      expect(await token0.balanceOf(user.address)).to.lessThan(user0BalanceBeforeIncrease.sub(amount0Increased));
      expect(await token1.balanceOf(user.address)).to.equal(user1BalanceBeforeIncrease);
      expect(await token0.balanceOf(positionManager.address)).to.equal(amount0LeftoverInLog);
      expect(await token1.balanceOf(positionManager.address)).to.equal(amount1LeftoverInLog);

      const positionInfoIncreased = await positionManager.getPositionInfo(positionIdInLogIncreased);
      expect(positionInfoIncreased.tokenId).to.be.equal(tokenIdInLog);
      expect(positionInfoIncreased.strategyProvider).to.be.equal(user2.address);
      expect(positionInfoIncreased.strategyId).to.be.equal(strategyIdInLog);
      expect(positionInfoIncreased.totalDepositUSDValue).to.be.greaterThan(positionInfo.totalDepositUSDValue);
      expect(positionInfoIncreased.amount0CollectedFee).to.be.equal(0);
      expect(positionInfoIncreased.amount1CollectedFee).to.be.equal(0);
      expect(positionInfoIncreased.amount0Leftover).to.be.equal(amount0LeftoverInLog);
      expect(positionInfoIncreased.amount1Leftover).to.be.equal(amount1LeftoverInLog);
      expect(positionInfoIncreased.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfoIncreased.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      expect(positionInfoIncreased.amount0Returned).to.be.equal(0);
      expect(positionInfoIncreased.amount1Returned).to.be.equal(0);
      expect(positionInfoIncreased.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionInfoIncreased.amount1ReturnedUsdValue).to.be.equal(0);
    });

    it("should fail to depositListedStrategy when strategy is not exist", async function () {
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

      await user2Wallet.connect(user2).addStrategy(strategyId, token0.address, token1.address, 3000, "2000", "2", "3");

      // provider do not create wallet
      await expect(
        depositRecipes.connect(user).depositListedStrategy({
          token0: token0.address,
          token1: token1.address,
          fee: 3000,
          tickLowerDiff: tickLowerDiff,
          tickUpperDiff: tickUpperDiff,
          amount0Desired: amount0Desired,
          amount1Desired: amount1Desired,
          strategyId: strategyId,
          strategyProvider: liquidityProvider.address,
        }),
      ).to.be.revertedWith("DRSPW");

      // strategy pool not exist
      await expect(
        depositRecipes.connect(user).depositListedStrategy({
          token0: token0.address,
          token1: token1.address,
          fee: 500,
          tickLowerDiff: tickLowerDiff,
          tickUpperDiff: tickUpperDiff,
          amount0Desired: amount0Desired,
          amount1Desired: amount1Desired,
          strategyId: strategyId,
          strategyProvider: user2.address,
        }),
      ).to.be.revertedWith("DRP0");

      // pool not match
      await poolFixture(tokenOP, tokenUSDT, 500, uniswapV3Factory, -1);
      const strategyId2 = ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16);
      await user2Wallet.connect(user2).addStrategy(strategyId2, token0.address, token1.address, 500, "2000", "2", "3");

      await expect(
        depositRecipes.connect(user).depositListedStrategy({
          token0: token0.address,
          token1: token1.address,
          fee: 3000,
          tickLowerDiff: tickLowerDiff,
          tickUpperDiff: tickUpperDiff,
          amount0Desired: amount0Desired,
          amount1Desired: amount1Desired,
          strategyId: strategyId2,
          strategyProvider: user2.address,
        }),
      ).to.be.revertedWith("DRSPWSE");
    });

    it("should fail to depositListedStrategy when tokens are not valid", async function () {
      // give pool some liquidity
      await providePoolLiquidity();
      const tokenREYLD = (await tokensFixture("REYLD", 18)).tokenFixture;
      const strategyId = ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16);
      const token0 = tokenREYLD.address < tokenUSDT.address ? tokenREYLD : tokenUSDT;
      const token1 = tokenREYLD.address < tokenUSDT.address ? tokenUSDT : tokenREYLD;
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

      await poolFixture(tokenREYLD, tokenUSDT, 3000, uniswapV3Factory, -1);
      await user2Wallet.connect(user2).addStrategy(strategyId, token0.address, token1.address, 3000, "2000", "2", "3");

      await expect(
        depositRecipes.connect(user).depositListedStrategy({
          token0: token0.address,
          token1: token1.address,
          fee: 3000,
          tickLowerDiff: tickLowerDiff,
          tickUpperDiff: tickUpperDiff,
          amount0Desired: amount0Desired,
          amount1Desired: amount1Desired,
          strategyId: strategyId,
          strategyProvider: user2.address,
        }),
      ).to.be.revertedWith("DRCSTW");
    });

    it("should fail to depositListedStrategy when tick spacing for feeTier is not valid", async function () {
      // give pool some liquidity
      await providePoolLiquidity();

      const strategyId = ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16);
      const token0 = tokenOP.address < tokenUSDT.address ? tokenOP : tokenUSDT;
      const token1 = tokenOP.address < tokenUSDT.address ? tokenUSDT : tokenOP;
      const amount0Desired: BigNumber = BigNumber.from(10n * 10n ** 18n);
      const amount1Desired: BigNumber = BigNumber.from(2n * 10n ** 18n);
      const tickLowerDiff = 0n - 125n;
      const tickUpperDiff = 0n + 120n;
      const user0BalanceBefore = await token0.balanceOf(user.address);
      const user1BalanceBefore = await token1.balanceOf(user.address);

      // user2 add strategy
      const user2WalltAddress = await strategyProviderWalletFactory.providerToWallet(user2.address);
      const user2Wallet = (await ethers.getContractAt(
        "StrategyProviderWallet",
        user2WalltAddress,
      )) as StrategyProviderWallet;

      await user2Wallet.connect(user2).addStrategy(strategyId, token0.address, token1.address, 3000, "2000", "2", "3");

      // provider do not create wallet
      await expect(
        depositRecipes.connect(user).depositListedStrategy({
          token0: token0.address,
          token1: token1.address,
          fee: 3000,
          tickLowerDiff: tickLowerDiff,
          tickUpperDiff: tickUpperDiff,
          amount0Desired: amount0Desired,
          amount1Desired: amount1Desired,
          strategyId: strategyId,
          strategyProvider: user2.address,
        }),
      ).to.be.revertedWith("DRTD");
    });
  });
});
