import { reset } from "@nomicfoundation/hardhat-network-helpers";
import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import hre from "hardhat";

import {
  DepositRecipes,
  DiamondCutFacet,
  INonfungiblePositionManager,
  IUniswapV3Factory,
  IUniswapV3Pool,
  IdleLiquidityModule,
  Mint,
  MockToken,
  PositionManager,
  PositionManagerFactory,
  Registry,
  StrategyProviderWalletFactory,
  SwapToPositionRatio,
  UniswapAddressHolder,
  WithdrawRecipes,
} from "../types";
import {
  RegistryFixture,
  deployContract,
  deployUniswapContracts,
  doAllApprovals,
  getSelectors,
  poolFixture,
  tokensFixture,
} from "./shared/fixtures";

describe("PositionManagerFactory.sol", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let serviceFeeRecipient: SignerWithAddress;
  let dummyWhitelist: SignerWithAddress;
  let usdValueTokenAddress: MockToken;
  let weth: MockToken;
  let Registry: Registry;
  let WETH: MockToken;
  let USDC: MockToken;
  let DAI: MockToken;
  let PMF: PositionManagerFactory;
  let SPWF: StrategyProviderWalletFactory;
  let PM: PositionManager;
  let DCF: DiamondCutFacet;
  let UAH: UniswapAddressHolder;
  let mintAction: Mint;
  let swapToPositionRatioAction: SwapToPositionRatio;
  let uniswapV3Factory: IUniswapV3Factory;
  let nonFungiblePositionManager: INonfungiblePositionManager;
  let ILM: IdleLiquidityModule;
  let DR: DepositRecipes;
  let WR: WithdrawRecipes;
  let tokenId: number;
  let tokenId2: number;
  let PoolUSDCWETH500: IUniswapV3Pool;

  async function deployRegistry() {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];
    serviceFeeRecipient = signers[2];
    dummyWhitelist = signers[3];

    usdValueTokenAddress = (await tokensFixture("USDC", 6)).tokenFixture;
    weth = (await tokensFixture("WETH", 18)).tokenFixture;

    //deploy the registry
    Registry = (
      await RegistryFixture(
        await deployer.getAddress(),
        await serviceFeeRecipient.getAddress(),
        500,
        4,
        usdValueTokenAddress.address,
        weth.address,
      )
    ).registryFixture;
  }
  async function deployModules() {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];
    serviceFeeRecipient = signers[2];

    //Deploy modules
    const IdleLiquidityModuleFactory = await ethers.getContractFactory("IdleLiquidityModule");
    ILM = (await IdleLiquidityModuleFactory.deploy(
      Registry.address,
      UAH.address, //we don't need this contract for this test
    )) as IdleLiquidityModule;

    const DepositRecipesFactory = await ethers.getContractFactory("DepositRecipes");
    DR = (await DepositRecipesFactory.deploy(
      Registry.address,
      UAH.address, //we don't need this contract for this test
    )) as DepositRecipes;

    const WithdrawRecipesFactory = await ethers.getContractFactory("WithdrawRecipes");
    WR = (await WithdrawRecipesFactory.deploy(
      Registry.address,
      UAH.address, //we don't need this contract for this test
    )) as WithdrawRecipes;
  }

  async function createPositionManager() {
    await Registry.addNewContract(
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("DummyWhitelist")),
      await dummyWhitelist.getAddress(),
      hre.ethers.utils.formatBytes32String("1"),
    );

    await Registry.addNewContract(
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("PositionManagerFactory")),
      PMF.address,
      hre.ethers.utils.formatBytes32String("1"),
    );

    await Registry.addNewContract(
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("IdleLiquidityModule")),
      ILM.address,
      hre.ethers.utils.formatBytes32String("1"),
    );

    await Registry.addNewContract(
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("DepositRecipes")),
      DR.address,
      hre.ethers.utils.formatBytes32String("1"),
    );

    await Registry.addNewContract(
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("WithdrawRecipes")),
      WR.address,
      hre.ethers.utils.formatBytes32String("1"),
    );

    await Registry.setPositionManagerFactory(PMF.address);
    await Registry.setStrategyProviderWalletFactory(SPWF.address);

    await PMF.connect(deployer).updateActionData({
      facetAddress: mintAction.address,
      action: 0,
      functionSelectors: await getSelectors(mintAction),
    });

    await PMF.connect(deployer).updateActionData({
      facetAddress: swapToPositionRatioAction.address,
      action: 0,
      functionSelectors: await getSelectors(swapToPositionRatioAction),
    });
    await Registry.connect(deployer).setPositionManagerFactory(PMF.address);

    await PMF.connect(user).create();

    const positionManagerAddress = await PMF.userToPositionManager(await user.getAddress());

    PM = (await ethers.getContractAt("PositionManager", positionManagerAddress)) as PositionManager;

    expect(PM).to.exist;
  }

  beforeEach(async function () {
    // NOTE: block gas limit may not enough so we need to reset
    await reset(process.env.ALCHEMY_OPTIMISM_MAINNET, 107735214);

    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];
    serviceFeeRecipient = signers[2];

    await deployRegistry();

    WETH = (await tokensFixture("WETH", 18)).tokenFixture;
    USDC = (await tokensFixture("USDC", 6)).tokenFixture;
    DAI = (await tokensFixture("DAI", 6)).tokenFixture;

    //deploy factory, used for pools
    const [uniswapFactory, nonFungible, swapRouter] = await deployUniswapContracts(WETH);
    UAH = (await deployContract("UniswapAddressHolder", [
      nonFungible.address,
      uniswapFactory.address,
      swapRouter.address,
      Registry.address,
    ])) as UniswapAddressHolder;
    uniswapV3Factory = uniswapFactory as IUniswapV3Factory;
    nonFungiblePositionManager = nonFungible as INonfungiblePositionManager;
    PoolUSDCWETH500 = (await poolFixture(USDC, WETH, 500, uniswapV3Factory, 0)).pool;

    await WETH.mint(await user.getAddress(), 100000n * 10n ** 18n);
    await USDC.mint(await user.getAddress(), 100000n * 10n ** 6n);
    await DAI.mint(await user.getAddress(), 100000n * 10n ** 6n);

    DCF = (await deployContract("DiamondCutFacet")) as DiamondCutFacet;

    const mint = await ethers.getContractFactory("Mint");
    mintAction = (await mint.deploy()) as Mint;
    await mintAction.deployed();

    const swapToPositionRatio = await ethers.getContractFactory("SwapToPositionRatio");
    swapToPositionRatioAction = (await swapToPositionRatio.deploy()) as SwapToPositionRatio;
    await swapToPositionRatioAction.deployed();

    const positionManagerFactory = await ethers.getContractFactory("PositionManagerFactory");
    PMF = (await positionManagerFactory.deploy(Registry.address, DCF.address, UAH.address)) as PositionManagerFactory;
    await PMF.deployed();
    const strategyProviderWalletFactory = await ethers.getContractFactory("StrategyProviderWalletFactory");
    SPWF = (await strategyProviderWalletFactory.deploy(Registry.address, UAH.address)) as StrategyProviderWalletFactory;
    await SPWF.deployed();

    await SPWF.connect(deployer).addCreatorWhitelist(PMF.address);

    await deployModules();

    await createPositionManager();

    await doAllApprovals([user], [nonFungiblePositionManager.address], [DAI, WETH, USDC]);

    // give pools some liquidity
    const mintTx = await nonFungiblePositionManager.connect(user).mint({
      token0: USDC.address,
      token1: WETH.address,
      fee: 500,
      tickLower: 0 - 60 * 1000,
      tickUpper: 0 + 60 * 1000,
      amount0Desired: 1000n * 10n ** 6n,
      amount1Desired: 1000n * 10n ** 18n,
      amount0Min: 0,
      amount1Min: 0,
      recipient: PM.address,
      deadline: Date.now() + 1000,
    });

    const events: any = (await mintTx.wait()).events;
    tokenId = await events[events.length - 1].args.tokenId.toNumber();

    const mintTx2 = await nonFungiblePositionManager.connect(user).mint({
      token0: USDC.address,
      token1: WETH.address,
      fee: 500,
      tickLower: 0 - 60 * 1000,
      tickUpper: 0 + 60 * 1000,
      amount0Desired: 1000n * 10n ** 6n,
      amount1Desired: 1000n * 10n ** 18n,
      amount0Min: 0,
      amount1Min: 0,
      recipient: PM.address,
      deadline: Date.now() + 1000,
    });

    const events2: any = (await mintTx2.wait()).events;
    tokenId2 = await events2[events2.length - 1].args.tokenId.toNumber();
  });

  describe("PositionManager.sol", function () {
    it("Should success create & increase liquidity & rebalance & close position by whitelisted", async () => {
      await PM.connect(dummyWhitelist).createPosition({
        tokenId: tokenId,
        strategyProvider: await deployer.getAddress(),
        strategyId: ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
        totalDepositUSDValue: 3000n * 10n ** 6n,
        tickLowerDiff: -1n,
        tickUpperDiff: 1n,
        amount0Leftover: 12n,
        amount1Leftover: 10n,
      });
      /*
        tokenId: BigNumber;
        strategyProvider: string;
        strategyId: string;
        totalDepositUSDValue: BigNumber;
        amount0CollectedFee: BigNumber;
        amount1CollectedFee: BigNumber;
        amount0Leftover: BigNumber;
        amount1Leftover: BigNumber;
        tickLowerDiff: number;
        tickUpperDiff: number;
        amount0Returned: BigNumber;
        amount1Returned: BigNumber;
        amount0ReturnedUsdValue: BigNumber;
        amount1ReturnedUsdValue: BigNumber;
      */
      const positionInfo = await PM.getPositionInfo(1);
      expect(positionInfo.tokenId).to.be.equal(tokenId);
      expect(positionInfo.strategyProvider).to.be.equal(await deployer.getAddress());
      expect(positionInfo.strategyId).to.be.equal(ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16));
      expect(positionInfo.totalDepositUSDValue).to.be.equal(3000n * 10n ** 6n);
      expect(positionInfo.amount0CollectedFee).to.be.equal(0);
      expect(positionInfo.amount1CollectedFee).to.be.equal(0);
      expect(positionInfo.amount0Leftover).to.be.equal(12n);
      expect(positionInfo.amount1Leftover).to.be.equal(10n);
      expect(positionInfo.tickLowerDiff).to.be.equal(-1n);
      expect(positionInfo.tickUpperDiff).to.be.equal(1n);
      expect(positionInfo.amount0Returned).to.be.equal(0);
      expect(positionInfo.amount1Returned).to.be.equal(0);
      expect(positionInfo.amount0ReturnedUsdValue).to.be.equal(0);
      expect(positionInfo.amount1ReturnedUsdValue).to.be.equal(0);

      const { runningPositions } = await PM.getRunningPositions(0, 3);
      expect(runningPositions.length).to.be.equal(1);
      expect(runningPositions[0]).to.be.equal(1);

      const { closedPositions } = await PM.getClosedPositions(0, 3);
      expect(closedPositions.length).to.be.equal(0);

      const { nfts } = await PM.getUniswapNFTs(0, 3);
      expect(nfts.length).to.be.equal(1);
      expect(nfts[0]).to.be.equal(tokenId);

      await PM.connect(dummyWhitelist).createPosition({
        tokenId: tokenId2,
        strategyProvider: await deployer.getAddress(),
        strategyId: ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16),
        totalDepositUSDValue: 3000n * 10n ** 6n,
        tickLowerDiff: -5n,
        tickUpperDiff: 5n,
        amount0Leftover: 11n,
        amount1Leftover: 100n,
      });

      {
        const positionInfo = await PM.getPositionInfo(2);
        expect(positionInfo.tokenId).to.be.equal(tokenId2);
        expect(positionInfo.strategyProvider).to.be.equal(await deployer.getAddress());
        expect(positionInfo.strategyId).to.be.equal(ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16));
        expect(positionInfo.totalDepositUSDValue).to.be.equal(3000n * 10n ** 6n);
        expect(positionInfo.amount0CollectedFee).to.be.equal(0);
        expect(positionInfo.amount1CollectedFee).to.be.equal(0);
        expect(positionInfo.amount0Leftover).to.be.equal(11n);
        expect(positionInfo.amount1Leftover).to.be.equal(100n);
        expect(positionInfo.tickLowerDiff).to.be.equal(-5n);
        expect(positionInfo.tickUpperDiff).to.be.equal(5n);
        expect(positionInfo.amount0Returned).to.be.equal(0);
        expect(positionInfo.amount1Returned).to.be.equal(0);
        expect(positionInfo.amount0ReturnedUsdValue).to.be.equal(0);
        expect(positionInfo.amount1ReturnedUsdValue).to.be.equal(0);
      }
      {
        const { runningPositions } = await PM.getRunningPositions(0, 3);
        expect(runningPositions.length).to.be.equal(2);
        expect(runningPositions[0]).to.be.equal(1);
        expect(runningPositions[1]).to.be.equal(2);

        const { closedPositions } = await PM.getClosedPositions(0, 3);
        expect(closedPositions.length).to.be.equal(0);

        const { nfts } = await PM.getUniswapNFTs(0, 3);
        expect(nfts.length).to.be.equal(2);
        expect(nfts[0]).to.be.equal(tokenId);
        expect(nfts[1]).to.be.equal(tokenId2);
      }

      await expect(await PM.connect(dummyWhitelist).isPositionRunning(1)).to.be.true;
      await expect(await PM.connect(dummyWhitelist).isPositionRunning(2)).to.be.true;
      await expect(await PM.connect(dummyWhitelist).isPositionRunning(3)).to.be.false;

      // increase liquidity
      await PM.connect(dummyWhitelist).middlewareIncreaseLiquidity(1, 2000000n * 10n ** 6n, 100n, 50n);
      {
        const positionInfo = await PM.getPositionInfo(1);
        expect(positionInfo.tokenId).to.be.equal(tokenId);
        expect(positionInfo.strategyProvider).to.be.equal(await deployer.getAddress());
        expect(positionInfo.strategyId).to.be.equal(ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16));
        expect(positionInfo.totalDepositUSDValue).to.be.equal(2000000n * 10n ** 6n);
        expect(positionInfo.amount0CollectedFee).to.be.equal(0);
        expect(positionInfo.amount1CollectedFee).to.be.equal(0);
        expect(positionInfo.amount0Leftover).to.be.equal(100n);
        expect(positionInfo.amount1Leftover).to.be.equal(50n);
        expect(positionInfo.tickLowerDiff).to.be.equal(-1n);
        expect(positionInfo.tickUpperDiff).to.be.equal(1n);
        expect(positionInfo.amount0Returned).to.be.equal(0);
        expect(positionInfo.amount1Returned).to.be.equal(0);
        expect(positionInfo.amount0ReturnedUsdValue).to.be.equal(0);
        expect(positionInfo.amount1ReturnedUsdValue).to.be.equal(0);
      }

      // rebalance
      await PM.connect(dummyWhitelist).middlewareRebalance(1, tokenId2, -2n, 2n, 2000n, 4000n, 0n, 20n);
      {
        const positionInfo = await PM.getPositionInfo(1);
        expect(positionInfo.tokenId).to.be.equal(tokenId2);
        expect(positionInfo.strategyProvider).to.be.equal(await deployer.getAddress());
        expect(positionInfo.strategyId).to.be.equal(ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16));
        expect(positionInfo.totalDepositUSDValue).to.be.equal(2000000n * 10n ** 6n);
        expect(positionInfo.amount0CollectedFee).to.be.equal(2000n);
        expect(positionInfo.amount1CollectedFee).to.be.equal(4000n);
        expect(positionInfo.amount0Leftover).to.be.equal(0n);
        expect(positionInfo.amount1Leftover).to.be.equal(20n);
        expect(positionInfo.tickLowerDiff).to.be.equal(-2n);
        expect(positionInfo.tickUpperDiff).to.be.equal(2n);
        expect(positionInfo.amount0Returned).to.be.equal(0);
        expect(positionInfo.amount1Returned).to.be.equal(0);
        expect(positionInfo.amount0ReturnedUsdValue).to.be.equal(0);
        expect(positionInfo.amount1ReturnedUsdValue).to.be.equal(0);
      }

      // close position
      await PM.connect(dummyWhitelist).middlewareWithdraw({
        positionId: 1,
        amount0CollectedFee: 2000n * 10n ** 6n,
        amount1CollectedFee: 2n * 10n ** 18n,
        amount0Returned: 100n,
        amount1Returned: 200n,
        amount0ReturnedUsdValue: 50n,
        amount1ReturnedUsdValue: 100n,
      });
      {
        const positionInfo = await PM.getPositionInfo(1);
        expect(positionInfo.tokenId).to.be.equal(tokenId2);
        expect(positionInfo.strategyProvider).to.be.equal(await deployer.getAddress());
        expect(positionInfo.strategyId).to.be.equal(ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16));
        expect(positionInfo.totalDepositUSDValue).to.be.equal(2000000n * 10n ** 6n);
        expect(positionInfo.amount0CollectedFee).to.be.equal(2000n * 10n ** 6n);
        expect(positionInfo.amount1CollectedFee).to.be.equal(2n * 10n ** 18n);
        expect(positionInfo.amount0Leftover).to.be.equal(0n);
        expect(positionInfo.amount1Leftover).to.be.equal(0n);
        expect(positionInfo.tickLowerDiff).to.be.equal(-2n);
        expect(positionInfo.tickUpperDiff).to.be.equal(2n);
        expect(positionInfo.amount0Returned).to.be.equal(100n);
        expect(positionInfo.amount1Returned).to.be.equal(200n);
        expect(positionInfo.amount0ReturnedUsdValue).to.be.equal(50n);
        expect(positionInfo.amount1ReturnedUsdValue).to.be.equal(100n);
      }

      expect(await PM.connect(dummyWhitelist).isPositionRunning(1)).to.be.false;
      expect(await PM.connect(dummyWhitelist).isPositionRunning(2)).to.be.true;
      expect(await PM.connect(dummyWhitelist).isPositionRunning(3)).to.be.false;

      {
        const { runningPositions } = await PM.getRunningPositions(0, 3);
        expect(runningPositions.length).to.be.equal(1);
        expect(runningPositions[0]).to.be.equal(2);

        const { closedPositions } = await PM.getClosedPositions(0, 3);
        expect(closedPositions.length).to.be.equal(1);
        expect(closedPositions[0]).to.be.equal(1);

        const { nfts } = await PM.getUniswapNFTs(0, 3);
        expect(nfts.length).to.be.equal(3);
        expect(nfts[0]).to.be.equal(tokenId);
        expect(nfts[1]).to.be.equal(tokenId2);
        expect(nfts[2]).to.be.equal(tokenId2);
      }
    });

    it("Should fail create position & increase liquidity & rebalance & close position by other not whitelist", async () => {
      await expect(
        PM.connect(user).createPosition({
          tokenId: tokenId,
          strategyProvider: await deployer.getAddress(),
          strategyId: ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
          totalDepositUSDValue: 3000n * 10n ** 6n,
          tickLowerDiff: -1n,
          tickUpperDiff: 1n,
          amount0Leftover: 12n,
          amount1Leftover: 10n,
        }),
      ).to.be.revertedWith("PMOW");

      await expect(PM.connect(user).middlewareIncreaseLiquidity(1, 2000000n * 10n ** 6n, 100n, 50n)).to.be.revertedWith(
        "PMOW",
      );

      await expect(
        PM.connect(user).middlewareRebalance(1, tokenId2, -2n, 2n, 2000n, 4000n, 0n, 20n),
      ).to.be.revertedWith("PMOW");

      await expect(
        PM.connect(user).middlewareWithdraw({
          positionId: 1,
          amount0CollectedFee: 2000n * 10n ** 6n,
          amount1CollectedFee: 2n * 10n ** 18n,
          amount0Returned: 100n,
          amount1Returned: 200n,
          amount0ReturnedUsdValue: 50n,
          amount1ReturnedUsdValue: 100n,
        }),
      ).to.be.revertedWith("PMOW");
    });
    it("Should success get owner", async () => {
      expect(await PM.getOwner()).to.be.equal(user.address);
    });

    it("Should success get tick diff", async () => {
      await PM.connect(dummyWhitelist).createPosition({
        tokenId: tokenId,
        strategyProvider: await deployer.getAddress(),
        strategyId: ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
        totalDepositUSDValue: 3000n * 10n ** 6n,
        tickLowerDiff: -1n,
        tickUpperDiff: 1n,
        amount0Leftover: 12n,
        amount1Leftover: 10n,
      });
      const ticks = await PM.getPositionTickDiffs(1);
      expect(ticks[0]).to.be.equal(-1);
      expect(ticks[1]).to.be.equal(1);
    });

    it("Should success withdraw erc20 by governance", async () => {
      const userBalance = await USDC.balanceOf(user.address);
      await USDC.connect(user).transfer(PM.address, 200n * 10n ** 6n);
      expect(await USDC.balanceOf(PM.address)).to.be.equal(200n * 10n ** 6n);

      await PM.connect(deployer).withdrawERC20ToOwner(USDC.address, 100n * 10n ** 6n);
      expect(await USDC.balanceOf(PM.address)).to.be.equal(100n * 10n ** 6n);
      expect(await USDC.balanceOf(user.address)).to.be.equal(userBalance.sub(100n * 10n ** 6n));
    });
  });
});
