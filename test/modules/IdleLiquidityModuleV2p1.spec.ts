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
  IdleLiquidityModuleV2p1,
  MockToken,
  MockWETH9,
  PositionManager,
  PositionManagerFactory,
  Registry,
  RegistryAddressHolder,
  StrategyProviderWallet,
  StrategyProviderWalletFactory,
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

describe("IdleLiquidityModuleV2p1.sol", function () {
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
  let idleLiquidityModule: IdleLiquidityModuleV2p1;

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
        "ClosePositionOneShot",
        "WithdrawNativeToken",
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

    //deploy IdleLiquidityModule contract
    idleLiquidityModule = (await deployContract("IdleLiquidityModuleV2p1", [
      registryAddressHolder.address,
      uniswapAddressHolder.address,
    ])) as IdleLiquidityModuleV2p1;

    await registry.addNewContract(
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("DepositRecipes")),
      depositRecipes.address,
      hre.ethers.utils.formatBytes32String("1"),
    );
    await registry.addNewContract(
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("IdleLiquidityModuleV2p1")),
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
      [nonFungiblePositionManager.address, swapRouter.address, positionManager.address, depositRecipes.address],
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
        token1: tokenUSDC.address < tokenOP.address ? tokenOP.address : tokenUSDC.address,
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
        token1: tokenUSDC.address < tokenUSDT.address ? tokenUSDT.address : tokenUSDC.address,
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
        token1: tokenUSDC.address < tokenWETH.address ? tokenWETH.address : tokenUSDC.address,
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

  describe("rebalance", function () {
    it("rebalance", async function () {
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
      expect(positionInfo.amount0Deposited).to.be.equal(amount0Deposited);
      expect(positionInfo.amount1Deposited).to.be.equal(amount1Deposited);
      expect(positionInfo.amount0DepositedUsdValue).to.be.greaterThan(0);
      expect(positionInfo.amount1DepositedUsdValue).to.be.greaterThan(0);
      expect(positionInfo.amount0CollectedFee).to.be.equal(0);
      expect(positionInfo.amount1CollectedFee).to.be.equal(0);
      expect(positionInfo.amount0Leftover).to.be.equal(0);
      expect(positionInfo.amount1Leftover).to.be.equal(0);
      expect(positionInfo.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfo.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      const positionSettlement = await positionManager.getPositionSettlement(positionIdInLog);
      expect(positionSettlement.amount0Returned).to.be.equal(0);
      expect(positionSettlement.amount1Returned).to.be.equal(0);
      expect(positionSettlement.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionSettlement.amount1ReturnedUsdValue).to.be.equal(0);

      // deposit gas fee to positionManager
      const gasFee = 10000n;
      const amountSendPM = 100000n;
      await user.sendTransaction({
        to: positionManager.address,
        value: amountSendPM,
      });

      const ethBalanceRebalanceFeeRecipient = await ethers.provider.getBalance(rebalanceFeeRecipient.address);
      // rebalance
      const txRebalance = await idleLiquidityModule.connect(keeper).rebalance({
        userAddress: user.address,
        feeReceiver: rebalanceFeeRecipient.address,
        positionId: positionIdInLog,
        estimatedGasFee: gasFee,
      });
      const receiptRebalance = await txRebalance.wait();
      const eventsRebalance: any = receiptRebalance.events;
      const positionIdInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.positionId;
      const closedTokenIdInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.closedTokenId;
      const mintedTokenIdInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.mintedTokenId;
      const removed0InLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.removed0;
      const removed1InLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.removed1;
      const collectedFee0InLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.collectedFee0;
      const collectedFee1InLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.collectedFee1;
      const repaidInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.repaid;

      expect(positionIdInLogRebalance).to.be.equal(positionIdInLog);
      expect(closedTokenIdInLogRebalance).to.be.equal(tokenIdInLog);
      let countAfterRebalance = 0;

      let tokenIdClosed: BigNumber = BigNumber.from(0);
      let amount0Collected: BigNumber = BigNumber.from(0);
      let amount1Collected: BigNumber = BigNumber.from(0);

      let rebalanceFee: BigNumber = BigNumber.from(0);

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
            amount0Collected = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
            amount1Collected = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
          }

          if (countAfterRebalance == 2) {
            // repay rebalance fee
            rebalanceFee = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
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

      expect(countAfterRebalance).to.be.equal(5);
      expect(tokenIdClosed).to.be.equal(tokenIdInLog);
      expect(rebalanceFee).to.be.equal(repaidInLogRebalance);
      expect(amount0Collected).to.be.equal(removed0InLogRebalance.add(collectedFee0InLogRebalance));
      expect(amount1Collected).to.be.equal(removed1InLogRebalance.add(collectedFee1InLogRebalance));
      expect(ethBalanceRebalanceFeeRecipient.add(rebalanceFee)).to.be.equal(
        await ethers.provider.getBalance(rebalanceFeeRecipient.address),
      );
      expect(amount0DepositedMinted).to.be.lessThanOrEqual(amount0OutSwapped);
      expect(amount1DepositedMinted).to.be.lessThanOrEqual(amount1OutSwapped);
      expect(tokenIdMinted).to.be.equal(mintedTokenIdInLogRebalance);

      expect(await token0.balanceOf(positionManager.address)).to.be.equal(amount0LeftoverMinted);
      expect(await token1.balanceOf(positionManager.address)).to.be.equal(amount1LeftoverMinted);
      expect((await ethers.provider.getBalance(positionManager.address)).toBigInt()).to.be.equal(amountSendPM - gasFee);

      const positionInfoAfterRebalance = await positionManager.getPositionInfo(positionIdInLog);
      expect(positionInfoAfterRebalance.tokenId).to.be.equal(mintedTokenIdInLogRebalance);
      expect(positionInfoAfterRebalance.strategyProvider).to.be.equal(zeroAddress);
      expect(positionInfoAfterRebalance.strategyId).to.be.equal(strategyIdInLog);
      expect(positionInfoAfterRebalance.amount0Deposited).to.be.equal(amount0Deposited);
      expect(positionInfoAfterRebalance.amount1Deposited).to.be.equal(amount1Deposited);
      expect(positionInfoAfterRebalance.amount0DepositedUsdValue).to.be.greaterThan(0);
      expect(positionInfoAfterRebalance.amount1DepositedUsdValue).to.be.greaterThan(0);
      expect(positionInfoAfterRebalance.amount0CollectedFee).to.be.equal(collectedFee0InLogRebalance);
      expect(positionInfoAfterRebalance.amount1CollectedFee).to.be.equal(collectedFee1InLogRebalance);
      expect(positionInfoAfterRebalance.amount0Leftover).to.be.equal(amount0LeftoverMinted);
      expect(positionInfoAfterRebalance.amount1Leftover).to.be.equal(amount1LeftoverMinted);
      expect(positionInfoAfterRebalance.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfoAfterRebalance.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      const positionSettlementAfterRebalance = await positionManager.getPositionSettlement(positionIdInLog);
      expect(positionSettlementAfterRebalance.amount0Returned).to.be.equal(0);
      expect(positionSettlementAfterRebalance.amount1Returned).to.be.equal(0);
      expect(positionSettlementAfterRebalance.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionSettlementAfterRebalance.amount1ReturnedUsdValue).to.be.equal(0);
    });

    it("rebalance with leftover", async function () {
      // give pool some liquidity
      await providePoolLiquidity();

      const strategyId = ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16);
      const token0 = tokenOP.address < tokenUSDT.address ? tokenOP : tokenUSDT;
      const token1 = tokenOP.address < tokenUSDT.address ? tokenUSDT : tokenOP;
      const amount0Desired: BigNumber = BigNumber.from(10n * 10n ** 18n);
      const isToken0In = true;
      const tickLowerDiff = 0n - 10n;
      const tickUpperDiff = 0n + 10n;
      const user0BalanceBefore = await token0.balanceOf(user.address);
      const user1BalanceBefore = await token1.balanceOf(user.address);

      // user2 add strategy
      const user2WalltAddress = await strategyProviderWalletFactory.providerToWallet(user2.address);
      const user2Wallet = (await ethers.getContractAt(
        "StrategyProviderWallet",
        user2WalltAddress,
      )) as StrategyProviderWallet;

      await user2Wallet.connect(user2).addStrategy(strategyId, token0.address, token1.address, 500, "2000", 2, "3");

      const txDeposit = await depositRecipes.connect(user).singleTokenDepositListedStrategy({
        token0: token0.address,
        token1: token1.address,
        isToken0In: isToken0In,
        fee: 500,
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
      let amount1Deposited: BigNumber = BigNumber.from(0);
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
          amount1Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[4])));
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
      expect(positionInfo.amount0Deposited).to.be.equal(amount0Deposited.add(amount0LeftoverInLog));
      expect(positionInfo.amount1Deposited).to.be.equal(amount1Deposited.add(amount1LeftoverInLog));
      expect(positionInfo.amount0DepositedUsdValue).to.be.greaterThan(0);
      expect(positionInfo.amount1DepositedUsdValue).to.be.greaterThan(0);
      expect(positionInfo.amount0CollectedFee).to.be.equal(0);
      expect(positionInfo.amount1CollectedFee).to.be.equal(0);
      expect(positionInfo.amount0Leftover).to.be.equal(amount0LeftoverInLog);
      expect(positionInfo.amount1Leftover).to.be.equal(amount1LeftoverInLog);
      expect(positionInfo.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfo.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      const positionSettlement = await positionManager.getPositionSettlement(positionIdInLog);
      expect(positionSettlement.amount0Returned).to.be.equal(0);
      expect(positionSettlement.amount1Returned).to.be.equal(0);
      expect(positionSettlement.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionSettlement.amount1ReturnedUsdValue).to.be.equal(0);
      // user
      expect(await token0.balanceOf(user.address)).to.lessThan(user0BalanceBefore.sub(amount0Deposited));
      expect(await token1.balanceOf(user.address)).to.equal(user1BalanceBefore);
      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(positionInfo.amount0Leftover);
      expect(await token1.balanceOf(positionManager.address)).to.equal(positionInfo.amount1Leftover);

      // deposit gas fee to positionManager
      const gasFee = 1n * 10n ** 18n;
      const amountSendPM = 10n * 10n ** 18n;
      await user.sendTransaction({
        to: positionManager.address,
        value: amountSendPM,
      });

      const ethBalanceRebalanceFeeRecipient = await ethers.provider.getBalance(rebalanceFeeRecipient.address);
      // rebalance
      const txRebalance = await idleLiquidityModule.connect(keeper).rebalance({
        userAddress: user.address,
        feeReceiver: rebalanceFeeRecipient.address,
        positionId: positionIdInLog,
        estimatedGasFee: gasFee,
      });
      const receiptRebalance = await txRebalance.wait();
      const eventsRebalance: any = receiptRebalance.events;
      const positionIdInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.positionId;
      const closedTokenIdInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.closedTokenId;
      const mintedTokenIdInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.mintedTokenId;
      const removed0InLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.removed0;
      const removed1InLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.removed1;
      const collectedFee0InLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.collectedFee0;
      const collectedFee1InLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.collectedFee1;
      const repaidInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.repaid;

      expect(positionIdInLogRebalance).to.be.equal(positionIdInLog);
      expect(closedTokenIdInLogRebalance).to.be.equal(tokenIdInLog);
      let countAfterRebalance = 0;

      let tokenIdClosed: BigNumber = BigNumber.from(0);
      let amount0Collected: BigNumber = BigNumber.from(0);
      let amount1Collected: BigNumber = BigNumber.from(0);

      let rebalanceFee: BigNumber = BigNumber.from(0);

      let amount0InSwapped: BigNumber = BigNumber.from(0);
      let amount1InSwapped: BigNumber = BigNumber.from(0);
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
            amount0Collected = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
            amount1Collected = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
          }

          if (countAfterRebalance == 2) {
            // repay rebalance fee
            rebalanceFee = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
          }

          if (countAfterRebalance == 3) {
            // swap to position ratio
            amount0InSwapped = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
            amount1InSwapped = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
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

      expect(countAfterRebalance).to.be.equal(5);
      expect(tokenIdClosed).to.be.equal(tokenIdInLog);
      expect(amount0Collected).to.be.equal(removed0InLogRebalance.add(collectedFee0InLogRebalance));
      expect(amount1Collected).to.be.equal(removed1InLogRebalance.add(collectedFee1InLogRebalance));
      expect(rebalanceFee).to.be.equal(repaidInLogRebalance);
      expect(ethBalanceRebalanceFeeRecipient.add(rebalanceFee)).to.be.equal(
        await ethers.provider.getBalance(rebalanceFeeRecipient.address),
      );
      expect(amount0InSwapped).to.be.equal(amount0Collected.add(amount0LeftoverInLog));
      expect(amount1InSwapped).to.be.equal(amount1Collected.add(amount1LeftoverInLog));

      expect(amount0DepositedMinted).to.be.lessThanOrEqual(amount0OutSwapped);
      expect(amount1DepositedMinted).to.be.lessThanOrEqual(amount1OutSwapped);
      expect(tokenIdMinted).to.be.equal(mintedTokenIdInLogRebalance);

      expect(await token0.balanceOf(positionManager.address)).to.be.equal(amount0LeftoverMinted);
      expect(await token1.balanceOf(positionManager.address)).to.be.equal(amount1LeftoverMinted);

      expect((await ethers.provider.getBalance(positionManager.address)).toBigInt()).to.be.equal(amountSendPM - gasFee);

      const positionInfoAfterRebalance = await positionManager.getPositionInfo(positionIdInLog);
      expect(positionInfoAfterRebalance.tokenId).to.be.equal(mintedTokenIdInLogRebalance);
      expect(positionInfoAfterRebalance.strategyProvider).to.be.equal(user2.address);
      expect(positionInfoAfterRebalance.strategyId).to.be.equal(strategyIdInLog);
      expect(positionInfoAfterRebalance.amount0Deposited).to.be.equal(amount0Deposited.add(amount0LeftoverInLog));
      expect(positionInfoAfterRebalance.amount1Deposited).to.be.equal(amount1Deposited.add(amount1LeftoverInLog));
      expect(positionInfoAfterRebalance.amount0DepositedUsdValue).to.be.greaterThan(0);
      expect(positionInfoAfterRebalance.amount1DepositedUsdValue).to.be.greaterThan(0);
      expect(positionInfoAfterRebalance.amount0CollectedFee).to.be.equal(collectedFee0InLogRebalance);
      expect(positionInfoAfterRebalance.amount1CollectedFee).to.be.equal(collectedFee1InLogRebalance);
      expect(positionInfoAfterRebalance.amount0Leftover).to.be.equal(amount0LeftoverMinted);
      expect(positionInfoAfterRebalance.amount1Leftover).to.be.equal(amount1LeftoverMinted);
      expect(positionInfoAfterRebalance.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfoAfterRebalance.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      const positionSettlementAfterRebalance = await positionManager.getPositionSettlement(positionIdInLog);
      expect(positionSettlementAfterRebalance.amount0Returned).to.be.equal(0);
      expect(positionSettlementAfterRebalance.amount1Returned).to.be.equal(0);
      expect(positionSettlementAfterRebalance.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionSettlementAfterRebalance.amount1ReturnedUsdValue).to.be.equal(0);
    });

    it("rebalance with tick", async function () {
      // give pool some liquidity
      await providePoolLiquidity();

      const strategyId = ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16);
      const token0 = tokenOP.address < tokenUSDT.address ? tokenOP : tokenUSDT;
      const token1 = tokenOP.address < tokenUSDT.address ? tokenUSDT : tokenOP;
      const amount0Desired: BigNumber = BigNumber.from(10n * 10n ** 18n);
      const isToken0In = true;
      const tickLowerDiff = 0n - 10n;
      const tickUpperDiff = 0n + 10n;
      const user0BalanceBefore = await token0.balanceOf(user.address);
      const user1BalanceBefore = await token1.balanceOf(user.address);

      // user2 add strategy
      const user2WalltAddress = await strategyProviderWalletFactory.providerToWallet(user2.address);
      const user2Wallet = (await ethers.getContractAt(
        "StrategyProviderWallet",
        user2WalltAddress,
      )) as StrategyProviderWallet;

      await user2Wallet.connect(user2).addStrategy(strategyId, token0.address, token1.address, 500, "2000", 2, "3");

      const txDeposit = await depositRecipes.connect(user).singleTokenDepositListedStrategy({
        token0: token0.address,
        token1: token1.address,
        isToken0In: isToken0In,
        fee: 500,
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
      let amount1Deposited: BigNumber = BigNumber.from(0);
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
          amount1Deposited = BigNumber.from(hexToInt256(hexToBn(eventData[4])));
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
      expect(positionInfo.amount0Deposited).to.be.equal(amount0Deposited.add(amount0LeftoverInLog));
      expect(positionInfo.amount1Deposited).to.be.equal(amount1Deposited.add(amount1LeftoverInLog));
      expect(positionInfo.amount0DepositedUsdValue).to.be.greaterThan(0);
      expect(positionInfo.amount1DepositedUsdValue).to.be.greaterThan(0);
      expect(positionInfo.amount0CollectedFee).to.be.equal(0);
      expect(positionInfo.amount1CollectedFee).to.be.equal(0);
      expect(positionInfo.amount0Leftover).to.be.equal(amount0LeftoverInLog);
      expect(positionInfo.amount1Leftover).to.be.equal(amount1LeftoverInLog);
      expect(positionInfo.tickLowerDiff).to.be.equal(BigNumber.from(tickLowerDiff));
      expect(positionInfo.tickUpperDiff).to.be.equal(BigNumber.from(tickUpperDiff));
      const positionSettlement = await positionManager.getPositionSettlement(positionIdInLog);
      expect(positionSettlement.amount0Returned).to.be.equal(0);
      expect(positionSettlement.amount1Returned).to.be.equal(0);
      expect(positionSettlement.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionSettlement.amount1ReturnedUsdValue).to.be.equal(0);
      // user
      expect(await token0.balanceOf(user.address)).to.lessThan(user0BalanceBefore.sub(amount0Deposited));
      expect(await token1.balanceOf(user.address)).to.equal(user1BalanceBefore);
      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(positionInfo.amount0Leftover);
      expect(await token1.balanceOf(positionManager.address)).to.equal(positionInfo.amount1Leftover);

      // deposit gas fee to positionManager
      const gasFee = 1n * 10n ** 18n;
      const amountSendPM = 10n * 10n ** 18n;
      await user.sendTransaction({
        to: positionManager.address,
        value: amountSendPM,
      });

      const ethBalanceRebalanceFeeRecipient = await ethers.provider.getBalance(rebalanceFeeRecipient.address);
      // rebalance
      const newTickLowerDiff = 0n - 20n;
      const newTickUpperDiff = 0n + 20n;
      const txRebalance = await idleLiquidityModule.connect(keeper).rebalanceWithTickDiffs({
        userAddress: user.address,
        feeReceiver: rebalanceFeeRecipient.address,
        positionId: positionIdInLog,
        estimatedGasFee: gasFee,
        tickLowerDiff: newTickLowerDiff,
        tickUpperDiff: newTickUpperDiff,
      });
      const receiptRebalance = await txRebalance.wait();
      const eventsRebalance: any = receiptRebalance.events;
      const positionIdInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.positionId;
      const closedTokenIdInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.closedTokenId;
      const mintedTokenIdInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.mintedTokenId;
      const removed0InLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.removed0;
      const removed1InLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.removed1;
      const collectedFee0InLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.collectedFee0;
      const collectedFee1InLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.collectedFee1;
      const repaidInLogRebalance = eventsRebalance[eventsRebalance.length - 1].args.repaid;

      expect(positionIdInLogRebalance).to.be.equal(positionIdInLog);
      expect(closedTokenIdInLogRebalance).to.be.equal(tokenIdInLog);
      let countAfterRebalance = 0;

      let tokenIdClosed: BigNumber = BigNumber.from(0);
      let amount0Collected: BigNumber = BigNumber.from(0);
      let amount1Collected: BigNumber = BigNumber.from(0);

      let rebalanceFee: BigNumber = BigNumber.from(0);

      let amount0InSwapped: BigNumber = BigNumber.from(0);
      let amount1InSwapped: BigNumber = BigNumber.from(0);
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
            amount0Collected = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
            amount1Collected = BigNumber.from(hexToInt256(hexToBn(eventData[2])));
          }

          if (countAfterRebalance == 2) {
            // repay rebalance fee
            rebalanceFee = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
          }

          if (countAfterRebalance == 3) {
            // swap to position ratio
            amount0InSwapped = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
            amount1InSwapped = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
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

      expect(countAfterRebalance).to.be.equal(5);
      expect(tokenIdClosed).to.be.equal(tokenIdInLog);
      expect(amount0Collected).to.be.equal(removed0InLogRebalance.add(collectedFee0InLogRebalance));
      expect(amount1Collected).to.be.equal(removed1InLogRebalance.add(collectedFee1InLogRebalance));
      expect(rebalanceFee).to.be.equal(repaidInLogRebalance);

      expect(ethBalanceRebalanceFeeRecipient.add(rebalanceFee)).to.be.equal(
        await ethers.provider.getBalance(rebalanceFeeRecipient.address),
      );
      expect(amount0InSwapped).to.be.equal(amount0Collected.add(amount0LeftoverInLog));
      expect(amount1InSwapped).to.be.equal(amount1Collected.add(amount1LeftoverInLog));

      expect(amount0DepositedMinted).to.be.lessThanOrEqual(amount0OutSwapped);
      expect(amount1DepositedMinted).to.be.lessThanOrEqual(amount1OutSwapped);
      expect(tokenIdMinted).to.be.equal(mintedTokenIdInLogRebalance);

      expect(await token0.balanceOf(positionManager.address)).to.be.equal(amount0LeftoverMinted);
      expect(await token1.balanceOf(positionManager.address)).to.be.equal(amount1LeftoverMinted);
      expect((await ethers.provider.getBalance(positionManager.address)).toBigInt()).to.be.equal(amountSendPM - gasFee);

      const positionInfoAfterRebalance = await positionManager.getPositionInfo(positionIdInLog);
      expect(positionInfoAfterRebalance.tokenId).to.be.equal(mintedTokenIdInLogRebalance);
      expect(positionInfoAfterRebalance.strategyProvider).to.be.equal(user2.address);
      expect(positionInfoAfterRebalance.strategyId).to.be.equal(strategyIdInLog);
      expect(positionInfoAfterRebalance.amount0Deposited).to.be.equal(amount0Deposited.add(amount0LeftoverInLog));
      expect(positionInfoAfterRebalance.amount1Deposited).to.be.equal(amount1Deposited.add(amount1LeftoverInLog));
      expect(positionInfoAfterRebalance.amount0DepositedUsdValue).to.be.greaterThan(0);
      expect(positionInfoAfterRebalance.amount1DepositedUsdValue).to.be.greaterThan(0);
      expect(positionInfoAfterRebalance.amount0CollectedFee).to.be.equal(collectedFee0InLogRebalance);
      expect(positionInfoAfterRebalance.amount1CollectedFee).to.be.equal(collectedFee1InLogRebalance);
      expect(positionInfoAfterRebalance.amount0Leftover).to.be.equal(amount0LeftoverMinted);
      expect(positionInfoAfterRebalance.amount1Leftover).to.be.equal(amount1LeftoverMinted);
      expect(positionInfoAfterRebalance.tickLowerDiff).to.be.equal(BigNumber.from(newTickLowerDiff));
      expect(positionInfoAfterRebalance.tickUpperDiff).to.be.equal(BigNumber.from(newTickUpperDiff));
      const positionSettlementAfterRebalance = await positionManager.getPositionSettlement(positionIdInLog);
      expect(positionSettlementAfterRebalance.amount0Returned).to.be.equal(0);
      expect(positionSettlementAfterRebalance.amount1Returned).to.be.equal(0);
      expect(positionSettlementAfterRebalance.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionSettlementAfterRebalance.amount1ReturnedUsdValue).to.be.equal(0);
    });
  });
});
