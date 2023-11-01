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
  MockUniswapUncollectedFeeHelper,
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

describe("UniswapUncollectedFeeHelper.sol", function () {
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
  let uniswapUncollectedFeeHelper: MockUniswapUncollectedFeeHelper;

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

    const MockUniswapUncollectedFeeHelperFactory = await ethers.getContractFactory("MockUniswapUncollectedFeeHelper");
    uniswapUncollectedFeeHelper =
      (await MockUniswapUncollectedFeeHelperFactory.deploy()) as MockUniswapUncollectedFeeHelper;
    await uniswapUncollectedFeeHelper.deployed();

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

  describe("UniswapUncollectedFeeHelper", function () {
    it("getUncollectedFees", async function () {
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

      {
        // get uncollectedFees
        const uncollectedFeesInfo = await uniswapUncollectedFeeHelper.getUncollectedFees(
          uniswapV3Factory.address,
          nonFungiblePositionManager.address,
          tokenIdInLog,
        );
        expect(uncollectedFeesInfo.token0).to.be.equal(token0.address);
        expect(uncollectedFeesInfo.token1).to.be.equal(token1.address);
        expect(uncollectedFeesInfo.amount0).to.be.equal(0);
        expect(uncollectedFeesInfo.amount1).to.be.equal(0);
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
        // get uncollectedFees
        const uncollectedFeesInfo = await uniswapUncollectedFeeHelper.getUncollectedFees(
          uniswapV3Factory.address,
          nonFungiblePositionManager.address,
          tokenIdInLog,
        );
        expect(uncollectedFeesInfo.token0).to.be.equal(token0.address);
        expect(uncollectedFeesInfo.token1).to.be.equal(token1.address);
        expect(uncollectedFeesInfo.amount0).to.be.greaterThan(0);
        expect(uncollectedFeesInfo.amount1).to.be.equal(0);
      }
    });
  });
});
