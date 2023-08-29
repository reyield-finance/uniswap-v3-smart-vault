import { BigNumber } from "@ethersproject/bignumber";
import { reset } from "@nomicfoundation/hardhat-network-helpers";
import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract } from "ethers";
import { ethers } from "hardhat";
import hre from "hardhat";

import {
  INonfungiblePositionManager,
  IShareProfit,
  ISwapRouter,
  MockToken,
  MockWETH9,
  PositionManager,
  PositionManagerFactory,
  Registry,
  StrategyProviderWalletFactory,
} from "../../types";
import {
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
} from "../shared/fixtures";

describe("ShareProfit.sol", function () {
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
    strategyProvider = signers[5];

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
    poolOPUSDC = (await poolFixture(tokenOP, tokenUSDC, 500, uniswapV3Factory, 0)).pool;
    poolOPUSDT = (await poolFixture(tokenOP, tokenUSDT, 500, uniswapV3Factory, 0)).pool;
    poolUSDCUSDT = (await poolFixture(tokenUSDC, tokenUSDT, 500, uniswapV3Factory, 0)).pool;

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
    const uniswapAddressHolder = await deployContract("UniswapAddressHolder", [
      nonFungiblePositionManager.address,
      uniswapV3Factory.address,
      swapRouter.address,
      registry.address,
    ]);
    const diamondCutFacet = await deployContract("DiamondCutFacet");

    //deploy the PositionManagerFactory => deploy PositionManager
    const positionManagerFactory = (await deployPositionManagerFactoryAndActions(
      registry.address,
      diamondCutFacet.address,
      uniswapAddressHolder.address,
      ["ShareProfit"],
    )) as PositionManagerFactory;

    const strategyProviderWalletFactoryFactory = await ethers.getContractFactory("StrategyProviderWalletFactory");
    const strategyProviderWalletFactory = (await strategyProviderWalletFactoryFactory.deploy(
      registry.address,
      uniswapAddressHolder.address,
    )) as StrategyProviderWalletFactory;
    await strategyProviderWalletFactory.deployed();

    await strategyProviderWalletFactory.addCreatorWhitelist(positionManagerFactory.address);

    //registry setup
    await registry.setPositionManagerFactory(positionManagerFactory.address);
    await registry.setStrategyProviderWalletFactory(strategyProviderWalletFactory.address);
    await registry.addNewContract(
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("Test")),
      user.address,
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

    //get AbiCoder
    // abiCoder = ethers.utils.defaultAbiCoder;

    //APPROVE
    await doAllApprovals(
      [user, liquidityProvider],
      [nonFungiblePositionManager.address, positionManager.address],
      [tokenWETH, tokenUSDC, tokenUSDT, tokenOP],
    );
    //approval nfts
    await nonFungiblePositionManager.setApprovalForAll(positionManager.address, true);
  });

  // 3*3
  // token0 token1
  // token1 token0
  // token0 token0
  // token1 token1
  // token0  null
  // token1  null
  // null  token0
  // null  token1
  // null  null

  async function providePoolLiquidity() {
    // give pool some liquidity
    await nonFungiblePositionManager.connect(liquidityProvider).mint(
      {
        token0: tokenOP.address,
        token1: tokenUSDT.address,
        fee: 500,
        tickLower: 0 - 20,
        tickUpper: 0 + 20,
        amount0Desired: 30000n * 10n ** 18n,
        amount1Desired: 30000n * 10n ** 18n,
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
        token0: tokenUSDC.address,
        token1: tokenOP.address,
        fee: 500,
        tickLower: 0 - 30,
        tickUpper: 0 + 30,
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
        token0: tokenUSDC.address,
        token1: tokenUSDT.address,
        fee: 500,
        tickLower: 0 - 30,
        tickUpper: 0 + 30,
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

  describe("ShareProfitAction - shareProfit", function () {
    it("should received all token0 profit for user & received all token0 profit for strategy provider for OP/USDT pair", async function () {
      // provide liquidity
      await providePoolLiquidity();

      const shareProfit = (await ethers.getContractAt("IShareProfit", positionManager.address)) as IShareProfit;
      let amount0Desired: BigNumber = BigNumber.from(3n * 10n ** 18n);
      let amount1Desired: BigNumber = BigNumber.from(100n * 10n ** 6n);
      const originalDepositUsdValue: BigNumber = BigNumber.from(10n ** 6n);
      const performanceFeeRatio: BigNumber = BigNumber.from(1000n); //10%

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenOP, tokenUSDT);
      [amount0Desired, amount1Desired] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];
      const returnedToken = token0;
      const performanceFeeReceivedToken = token0;

      await token0.connect(user).transfer(positionManager.address, amount0Desired);
      await token1.connect(user).transfer(positionManager.address, amount1Desired);

      const userToken0BalanceBefore = await token0.balanceOf(user.address);
      const userToken1BalanceBefore = await token1.balanceOf(user.address);
      const strategyProviderToken0BalanceBefore = await token0.balanceOf(strategyProvider.address);
      const strategyProviderToken1BalanceBefore = await token1.balanceOf(strategyProvider.address);
      const serviceFeeRecipientToken0BalanceBefore = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipientToken1BalanceBefore = await token1.balanceOf(serviceFeeRecipient.address);

      const txShare = await shareProfit.connect(user).shareProfit({
        token0: token0.address,
        token1: token1.address,
        returnedToken: returnedToken.address,
        amount0: amount0Desired,
        amount1: amount1Desired,
        originalDepositUsdValue: originalDepositUsdValue,
        performanceFeeRecipient: strategyProvider.address,
        performanceFeeReceivedToken: performanceFeeReceivedToken.address,
        performanceFeeRatio: performanceFeeRatio,
        serviceFeeRatio: await registry.getServiceFeeRatioFromLicenseAmount(1), // with 1 license
      });

      const receipt = await txShare.wait();
      const events: any = receipt.events;
      const amount0Returned = events[events.length - 1].args.returnedAmount0;
      const amount1Returned = events[events.length - 1].args.returnedAmount1;
      const amount0PerformanceFee = events[events.length - 1].args.performanceFeeAmount0;
      const amount1PerformanceFee = events[events.length - 1].args.performanceFeeAmount1;
      const amount0ServiceFee = events[events.length - 1].args.serviceFeeAmount0;
      const amount1ServiceFee = events[events.length - 1].args.serviceFeeAmount1;

      expect(amount1Returned).to.be.equal(0);
      expect(amount1PerformanceFee).to.be.equal(0);
      expect(amount1ServiceFee).to.be.equal(0);

      const userToken0BalanceAfter = await token0.balanceOf(user.address);
      const userToken1BalanceAfter = await token1.balanceOf(user.address);
      const strategyProviderToken0BalanceAfter = await token0.balanceOf(strategyProvider.address);
      const strategyProviderToken1BalanceAfter = await token1.balanceOf(strategyProvider.address);
      const serviceFeeRecipientToken0BalanceAfter = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipientToken1BalanceAfter = await token1.balanceOf(serviceFeeRecipient.address);

      let token0SwappedFromToken1PerformanceFee: BigNumber = BigNumber.from(0);
      let token0SwappedFromToken1UserReturned: BigNumber = BigNumber.from(0);
      let performanceFeeToken1: BigNumber = BigNumber.from(0);
      let userReturnedToken1: BigNumber = BigNumber.from(0);

      let isTheFirstSwap: boolean = true;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolOPUSDT.address) {
          if (isTheFirstSwap) {
            isTheFirstSwap = false;
            // performance fee
            const eventData = parseEventData(events[i].data);

            token0SwappedFromToken1PerformanceFee = token0SwappedFromToken1PerformanceFee.add(
              BigNumber.from(0n - hexToInt256(hexToBn(eventData[0]))),
            );
            performanceFeeToken1 = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
          } else {
            // user returned amounts
            const eventData = parseEventData(events[i].data);
            token0SwappedFromToken1UserReturned = token0SwappedFromToken1UserReturned.add(
              BigNumber.from(0n - hexToInt256(hexToBn(eventData[0]))),
            );
            userReturnedToken1 = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
          }
        }
      }
      expect(isTheFirstSwap).to.be.false;

      expect(performanceFeeToken1.add(userReturnedToken1)).to.be.equal(amount1Desired);
      expect(amount0ServiceFee).to.lessThanOrEqual(amount0PerformanceFee);
      expect(amount0PerformanceFee.add(amount0ServiceFee)).to.be.greaterThan(token0SwappedFromToken1PerformanceFee);
      expect(amount0Returned).to.be.greaterThan(token0SwappedFromToken1UserReturned);

      // service fee recipient
      expect(serviceFeeRecipientToken0BalanceAfter.sub(serviceFeeRecipientToken0BalanceBefore)).to.be.equal(
        amount0ServiceFee,
      );
      expect(serviceFeeRecipientToken1BalanceAfter.sub(serviceFeeRecipientToken1BalanceBefore)).to.be.equal(
        amount1ServiceFee,
      );

      // strategy provider
      expect(strategyProviderToken0BalanceAfter.sub(strategyProviderToken0BalanceBefore)).to.be.equal(
        amount0PerformanceFee,
      );
      expect(strategyProviderToken1BalanceAfter.sub(strategyProviderToken1BalanceBefore)).to.be.equal(
        amount1PerformanceFee,
      );

      // user
      expect(userToken0BalanceAfter.sub(userToken0BalanceBefore)).to.be.equal(amount0Returned);
      expect(userToken1BalanceAfter.sub(userToken1BalanceBefore)).to.be.equal(amount1Returned);

      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);
    });

    it("should received all token1 profit for user & received all token1 profit for strategy provider for OP/USDT pair", async function () {
      await providePoolLiquidity();
      const shareProfit = (await ethers.getContractAt("IShareProfit", positionManager.address)) as IShareProfit;
      let amount0Desired: BigNumber = BigNumber.from(3n * 10n ** 18n);
      let amount1Desired: BigNumber = BigNumber.from(1000n * 10n ** 6n);
      const originalDepositUsdValue: BigNumber = BigNumber.from(10n ** 6n);
      const performanceFeeRatio: BigNumber = BigNumber.from(1000n); //10%

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenOP, tokenUSDT);
      [amount0Desired, amount1Desired] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      const returnedToken = token1;
      const performanceFeeReceivedToken = token1;

      await token0.connect(user).transfer(positionManager.address, amount0Desired);
      await token1.connect(user).transfer(positionManager.address, amount1Desired);

      const userToken0BalanceBefore = await token0.balanceOf(user.address);
      const userToken1BalanceBefore = await token1.balanceOf(user.address);
      const strategyProviderToken0BalanceBefore = await token0.balanceOf(strategyProvider.address);
      const strategyProviderToken1BalanceBefore = await token1.balanceOf(strategyProvider.address);
      const serviceFeeRecipientToken0BalanceBefore = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipientToken1BalanceBefore = await token1.balanceOf(serviceFeeRecipient.address);

      const txShare = await shareProfit.connect(user).shareProfit({
        token0: token0.address,
        token1: token1.address,
        returnedToken: returnedToken.address,
        amount0: amount0Desired,
        amount1: amount1Desired,
        originalDepositUsdValue: originalDepositUsdValue,
        performanceFeeRecipient: strategyProvider.address,
        performanceFeeReceivedToken: performanceFeeReceivedToken.address,
        performanceFeeRatio: performanceFeeRatio,
        serviceFeeRatio: await registry.getServiceFeeRatioFromLicenseAmount(1), // with 1 license
      });

      const receipt = await txShare.wait();
      const events: any = receipt.events;
      const amount0Returned = events[events.length - 1].args.returnedAmount0;
      const amount1Returned = events[events.length - 1].args.returnedAmount1;
      const amount0PerformanceFee = events[events.length - 1].args.performanceFeeAmount0;
      const amount1PerformanceFee = events[events.length - 1].args.performanceFeeAmount1;
      const amount0ServiceFee = events[events.length - 1].args.serviceFeeAmount0;
      const amount1ServiceFee = events[events.length - 1].args.serviceFeeAmount1;

      expect(amount0Returned).to.be.equal(0);
      expect(amount0PerformanceFee).to.be.equal(0);
      expect(amount0ServiceFee).to.be.equal(0);

      const userToken0BalanceAfter = await token0.balanceOf(user.address);
      const userToken1BalanceAfter = await token1.balanceOf(user.address);
      const strategyProviderToken0BalanceAfter = await token0.balanceOf(strategyProvider.address);
      const strategyProviderToken1BalanceAfter = await token1.balanceOf(strategyProvider.address);
      const serviceFeeRecipientToken0BalanceAfter = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipientToken1BalanceAfter = await token1.balanceOf(serviceFeeRecipient.address);

      let token1SwappedFromToken0PerformanceFee: BigNumber = BigNumber.from(0);
      let token1SwappedFromToken0UserReturned: BigNumber = BigNumber.from(0);
      let performanceFeeToken0: BigNumber = BigNumber.from(0);
      let userReturnedToken0: BigNumber = BigNumber.from(0);

      let isTheFirstSwap: boolean = true;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolOPUSDT.address) {
          if (isTheFirstSwap) {
            isTheFirstSwap = false;
            // performance fee
            const eventData = parseEventData(events[i].data);

            token1SwappedFromToken0PerformanceFee = token1SwappedFromToken0PerformanceFee.add(
              BigNumber.from(0n - hexToInt256(hexToBn(eventData[1]))),
            );
            performanceFeeToken0 = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
          } else {
            // user returned amounts
            const eventData = parseEventData(events[i].data);
            token1SwappedFromToken0UserReturned = token1SwappedFromToken0UserReturned.add(
              BigNumber.from(0n - hexToInt256(hexToBn(eventData[1]))),
            );
            userReturnedToken0 = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
          }
        }
      }
      expect(isTheFirstSwap).to.be.false;
      expect(performanceFeeToken0.add(userReturnedToken0)).to.be.equal(amount0Desired);
      expect(amount1ServiceFee).to.lessThanOrEqual(amount1PerformanceFee);
      expect(amount1PerformanceFee.add(amount1ServiceFee)).to.be.greaterThan(token1SwappedFromToken0PerformanceFee);
      expect(amount1Returned).to.be.greaterThan(token1SwappedFromToken0UserReturned);

      // service fee recipient
      expect(serviceFeeRecipientToken0BalanceAfter.sub(serviceFeeRecipientToken0BalanceBefore)).to.be.equal(
        amount0ServiceFee,
      );
      expect(serviceFeeRecipientToken1BalanceAfter.sub(serviceFeeRecipientToken1BalanceBefore)).to.be.equal(
        amount1ServiceFee,
      );

      // strategy provider
      expect(strategyProviderToken0BalanceAfter.sub(strategyProviderToken0BalanceBefore)).to.be.equal(
        amount0PerformanceFee,
      );
      expect(strategyProviderToken1BalanceAfter.sub(strategyProviderToken1BalanceBefore)).to.be.equal(
        amount1PerformanceFee,
      );

      // user
      expect(userToken0BalanceAfter.sub(userToken0BalanceBefore)).to.be.equal(amount0Returned);
      expect(userToken1BalanceAfter.sub(userToken1BalanceBefore)).to.be.equal(amount1Returned);

      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);
    });

    it("should received all token0 profit for user & received token0 & token1 profit for strategy provider for OP/USDT pair", async function () {
      await providePoolLiquidity();
      const shareProfit = (await ethers.getContractAt("IShareProfit", positionManager.address)) as IShareProfit;
      let amount0Desired: BigNumber = BigNumber.from(3n * 10n ** 18n);
      let amount1Desired: BigNumber = BigNumber.from(1000n * 10n ** 6n);
      const originalDepositUsdValue: BigNumber = BigNumber.from(10n ** 6n);
      const performanceFeeRatio: BigNumber = BigNumber.from(1000n); //10%

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenOP, tokenUSDT);
      [amount0Desired, amount1Desired] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      const returnedToken = token0;
      // const performanceFeeReceivedToken = token1;

      await token0.connect(user).transfer(positionManager.address, amount0Desired);
      await token1.connect(user).transfer(positionManager.address, amount1Desired);

      const userToken0BalanceBefore = await token0.balanceOf(user.address);
      const userToken1BalanceBefore = await token1.balanceOf(user.address);
      const strategyProviderToken0BalanceBefore = await token0.balanceOf(strategyProvider.address);
      const strategyProviderToken1BalanceBefore = await token1.balanceOf(strategyProvider.address);
      const serviceFeeRecipientToken0BalanceBefore = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipientToken1BalanceBefore = await token1.balanceOf(serviceFeeRecipient.address);

      const txShare = await shareProfit.connect(user).shareProfit({
        token0: token0.address,
        token1: token1.address,
        returnedToken: returnedToken.address,
        amount0: amount0Desired,
        amount1: amount1Desired,
        originalDepositUsdValue: originalDepositUsdValue,
        performanceFeeRecipient: strategyProvider.address,
        performanceFeeReceivedToken: "0x0000000000000000000000000000000000000000",
        performanceFeeRatio: performanceFeeRatio,
        serviceFeeRatio: await registry.getServiceFeeRatioFromLicenseAmount(1), // with 1 license
      });

      const receipt = await txShare.wait();
      const events: any = receipt.events;
      const amount0Returned = events[events.length - 1].args.returnedAmount0;
      const amount1Returned = events[events.length - 1].args.returnedAmount1;
      const amount0PerformanceFee = events[events.length - 1].args.performanceFeeAmount0;
      const amount1PerformanceFee = events[events.length - 1].args.performanceFeeAmount1;
      const amount0ServiceFee = events[events.length - 1].args.serviceFeeAmount0;
      const amount1ServiceFee = events[events.length - 1].args.serviceFeeAmount1;

      expect(amount1Returned).to.be.equal(0);
      expect(amount1PerformanceFee).to.be.greaterThan(0);
      expect(amount1ServiceFee).to.be.greaterThan(0);

      const userToken0BalanceAfter = await token0.balanceOf(user.address);
      const userToken1BalanceAfter = await token1.balanceOf(user.address);
      const strategyProviderToken0BalanceAfter = await token0.balanceOf(strategyProvider.address);
      const strategyProviderToken1BalanceAfter = await token1.balanceOf(strategyProvider.address);
      const serviceFeeRecipientToken0BalanceAfter = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipientToken1BalanceAfter = await token1.balanceOf(serviceFeeRecipient.address);

      let token0SwappedFromToken1UserReturned: BigNumber = BigNumber.from(0);
      let userReturnedToken1: BigNumber = BigNumber.from(0);

      let count = 0;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolOPUSDT.address) {
          count++;

          // user returned amounts
          const eventData = parseEventData(events[i].data);
          token0SwappedFromToken1UserReturned = token0SwappedFromToken1UserReturned.add(
            BigNumber.from(0n - hexToInt256(hexToBn(eventData[0]))),
          );
          userReturnedToken1 = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
        }
      }
      expect(count).to.be.equal(1);
      expect(amount1ServiceFee.add(userReturnedToken1).add(amount1PerformanceFee)).to.be.equal(amount1Desired);
      expect(amount0ServiceFee).to.lessThanOrEqual(amount0PerformanceFee);
      expect(amount1ServiceFee).to.lessThanOrEqual(amount1PerformanceFee);
      expect(amount0Returned).to.be.greaterThan(token0SwappedFromToken1UserReturned);

      // service fee recipient
      expect(serviceFeeRecipientToken0BalanceAfter.sub(serviceFeeRecipientToken0BalanceBefore)).to.be.equal(
        amount0ServiceFee,
      );
      expect(serviceFeeRecipientToken1BalanceAfter.sub(serviceFeeRecipientToken1BalanceBefore)).to.be.equal(
        amount1ServiceFee,
      );

      // strategy provider
      expect(strategyProviderToken0BalanceAfter.sub(strategyProviderToken0BalanceBefore)).to.be.equal(
        amount0PerformanceFee,
      );
      expect(strategyProviderToken1BalanceAfter.sub(strategyProviderToken1BalanceBefore)).to.be.equal(
        amount1PerformanceFee,
      );

      // user
      expect(userToken0BalanceAfter.sub(userToken0BalanceBefore)).to.be.equal(amount0Returned);
      expect(userToken1BalanceAfter.sub(userToken1BalanceBefore)).to.be.equal(amount1Returned);

      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);
    });

    it("should received token0 & token1 profit for user & received all token0 profit for strategy provider for OP/USDT pair", async function () {
      await providePoolLiquidity();
      const shareProfit = (await ethers.getContractAt("IShareProfit", positionManager.address)) as IShareProfit;
      let amount0Desired: BigNumber = BigNumber.from(3n * 10n ** 18n);
      let amount1Desired: BigNumber = BigNumber.from(1000n * 10n ** 6n);
      const originalDepositUsdValue: BigNumber = BigNumber.from(10n ** 6n);
      const performanceFeeRatio: BigNumber = BigNumber.from(1000n); //10%

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenOP, tokenUSDT);
      [amount0Desired, amount1Desired] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      // const returnedToken = token0;
      const performanceFeeReceivedToken = token0;

      await token0.connect(user).transfer(positionManager.address, amount0Desired);
      await token1.connect(user).transfer(positionManager.address, amount1Desired);

      const userToken0BalanceBefore = await token0.balanceOf(user.address);
      const userToken1BalanceBefore = await token1.balanceOf(user.address);
      const strategyProviderToken0BalanceBefore = await token0.balanceOf(strategyProvider.address);
      const strategyProviderToken1BalanceBefore = await token1.balanceOf(strategyProvider.address);
      const serviceFeeRecipientToken0BalanceBefore = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipientToken1BalanceBefore = await token1.balanceOf(serviceFeeRecipient.address);

      const txShare = await shareProfit.connect(user).shareProfit({
        token0: token0.address,
        token1: token1.address,
        returnedToken: "0x0000000000000000000000000000000000000000",
        amount0: amount0Desired,
        amount1: amount1Desired,
        originalDepositUsdValue: originalDepositUsdValue,
        performanceFeeRecipient: strategyProvider.address,
        performanceFeeReceivedToken: performanceFeeReceivedToken.address,
        performanceFeeRatio: performanceFeeRatio,
        serviceFeeRatio: await registry.getServiceFeeRatioFromLicenseAmount(1), // with 1 license
      });

      const receipt = await txShare.wait();
      const events: any = receipt.events;
      const amount0Returned = events[events.length - 1].args.returnedAmount0;
      const amount1Returned = events[events.length - 1].args.returnedAmount1;
      const amount0PerformanceFee = events[events.length - 1].args.performanceFeeAmount0;
      const amount1PerformanceFee = events[events.length - 1].args.performanceFeeAmount1;
      const amount0ServiceFee = events[events.length - 1].args.serviceFeeAmount0;
      const amount1ServiceFee = events[events.length - 1].args.serviceFeeAmount1;

      expect(amount0Returned).to.be.greaterThan(0);
      expect(amount1Returned).to.be.greaterThan(0);
      expect(amount1PerformanceFee).to.be.equal(0);
      expect(amount1ServiceFee).to.be.equal(0);

      const userToken0BalanceAfter = await token0.balanceOf(user.address);
      const userToken1BalanceAfter = await token1.balanceOf(user.address);
      const strategyProviderToken0BalanceAfter = await token0.balanceOf(strategyProvider.address);
      const strategyProviderToken1BalanceAfter = await token1.balanceOf(strategyProvider.address);
      const serviceFeeRecipientToken0BalanceAfter = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipientToken1BalanceAfter = await token1.balanceOf(serviceFeeRecipient.address);

      let token0SwappedFromToken1PerformanceFee: BigNumber = BigNumber.from(0);
      let performanceFeeToken1: BigNumber = BigNumber.from(0);

      let count = 0;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolOPUSDT.address) {
          count++;

          // performance fee swapped
          const eventData = parseEventData(events[i].data);
          token0SwappedFromToken1PerformanceFee = token0SwappedFromToken1PerformanceFee.add(
            BigNumber.from(0n - hexToInt256(hexToBn(eventData[0]))),
          );
          performanceFeeToken1 = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
        }
      }
      expect(count).to.be.equal(1);
      expect(performanceFeeToken1.add(amount1Returned)).to.be.equal(amount1Desired);
      expect(amount0ServiceFee).to.lessThanOrEqual(amount0PerformanceFee);
      expect(amount1ServiceFee).to.lessThanOrEqual(amount1PerformanceFee);
      expect(amount0ServiceFee.add(amount0PerformanceFee)).greaterThan(token0SwappedFromToken1PerformanceFee);

      // service fee recipient
      expect(serviceFeeRecipientToken0BalanceAfter.sub(serviceFeeRecipientToken0BalanceBefore)).to.be.equal(
        amount0ServiceFee,
      );
      expect(serviceFeeRecipientToken1BalanceAfter.sub(serviceFeeRecipientToken1BalanceBefore)).to.be.equal(
        amount1ServiceFee,
      );

      // strategy provider
      expect(strategyProviderToken0BalanceAfter.sub(strategyProviderToken0BalanceBefore)).to.be.equal(
        amount0PerformanceFee,
      );
      expect(strategyProviderToken1BalanceAfter.sub(strategyProviderToken1BalanceBefore)).to.be.equal(
        amount1PerformanceFee,
      );

      // user
      expect(userToken0BalanceAfter.sub(userToken0BalanceBefore)).to.be.equal(amount0Returned);
      expect(userToken1BalanceAfter.sub(userToken1BalanceBefore)).to.be.equal(amount1Returned);

      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);
    });

    it("should received token0 & token1 profit for user & received token0 & token1 profit for strategy provider for OP/USDT pair", async function () {
      await providePoolLiquidity();
      const shareProfit = (await ethers.getContractAt("IShareProfit", positionManager.address)) as IShareProfit;
      let amount0Desired: BigNumber = BigNumber.from(3n * 10n ** 18n);
      let amount1Desired: BigNumber = BigNumber.from(1000n * 10n ** 6n);
      const originalDepositUsdValue: BigNumber = BigNumber.from(10n ** 6n);
      const performanceFeeRatio: BigNumber = BigNumber.from(1000n); //10%

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenOP, tokenUSDT);
      [amount0Desired, amount1Desired] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      // const returnedToken = token0;
      // const performanceFeeReceivedToken = token0;

      await token0.connect(user).transfer(positionManager.address, amount0Desired);
      await token1.connect(user).transfer(positionManager.address, amount1Desired);

      const userToken0BalanceBefore = await token0.balanceOf(user.address);
      const userToken1BalanceBefore = await token1.balanceOf(user.address);
      const strategyProviderToken0BalanceBefore = await token0.balanceOf(strategyProvider.address);
      const strategyProviderToken1BalanceBefore = await token1.balanceOf(strategyProvider.address);
      const serviceFeeRecipientToken0BalanceBefore = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipientToken1BalanceBefore = await token1.balanceOf(serviceFeeRecipient.address);

      const txShare = await shareProfit.connect(user).shareProfit({
        token0: token0.address,
        token1: token1.address,
        returnedToken: "0x0000000000000000000000000000000000000000",
        amount0: amount0Desired,
        amount1: amount1Desired,
        originalDepositUsdValue: originalDepositUsdValue,
        performanceFeeRecipient: strategyProvider.address,
        performanceFeeReceivedToken: "0x0000000000000000000000000000000000000000",
        performanceFeeRatio: performanceFeeRatio,
        serviceFeeRatio: await registry.getServiceFeeRatioFromLicenseAmount(1), // with 1 license
      });

      const receipt = await txShare.wait();
      const events: any = receipt.events;
      const amount0Returned = events[events.length - 1].args.returnedAmount0;
      const amount1Returned = events[events.length - 1].args.returnedAmount1;
      const amount0PerformanceFee = events[events.length - 1].args.performanceFeeAmount0;
      const amount1PerformanceFee = events[events.length - 1].args.performanceFeeAmount1;
      const amount0ServiceFee = events[events.length - 1].args.serviceFeeAmount0;
      const amount1ServiceFee = events[events.length - 1].args.serviceFeeAmount1;

      expect(amount0Returned).to.be.greaterThan(0);
      expect(amount1Returned).to.be.greaterThan(0);
      expect(amount0PerformanceFee).to.be.greaterThan(0);
      expect(amount1PerformanceFee).to.be.greaterThan(0);
      expect(amount0ServiceFee).to.be.greaterThan(0);
      expect(amount1ServiceFee).to.be.greaterThan(0);

      const userToken0BalanceAfter = await token0.balanceOf(user.address);
      const userToken1BalanceAfter = await token1.balanceOf(user.address);
      const strategyProviderToken0BalanceAfter = await token0.balanceOf(strategyProvider.address);
      const strategyProviderToken1BalanceAfter = await token1.balanceOf(strategyProvider.address);
      const serviceFeeRecipientToken0BalanceAfter = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipientToken1BalanceAfter = await token1.balanceOf(serviceFeeRecipient.address);

      let count = 0;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolOPUSDT.address) {
          count++;
        }
      }
      expect(count).to.be.equal(0);
      expect(amount0PerformanceFee.add(amount0Returned).add(amount0ServiceFee)).to.be.equal(amount0Desired);
      expect(amount1PerformanceFee.add(amount1Returned).add(amount1ServiceFee)).to.be.equal(amount1Desired);
      expect(amount0ServiceFee).to.lessThanOrEqual(amount0PerformanceFee);
      expect(amount1ServiceFee).to.lessThanOrEqual(amount1PerformanceFee);
      expect(amount0PerformanceFee.add(amount0ServiceFee)).to.lessThan(amount0Returned);
      expect(amount1PerformanceFee.add(amount1ServiceFee)).to.lessThan(amount1Returned);

      // service fee recipient
      expect(serviceFeeRecipientToken0BalanceAfter.sub(serviceFeeRecipientToken0BalanceBefore)).to.be.equal(
        amount0ServiceFee,
      );
      expect(serviceFeeRecipientToken1BalanceAfter.sub(serviceFeeRecipientToken1BalanceBefore)).to.be.equal(
        amount1ServiceFee,
      );

      // strategy provider
      expect(strategyProviderToken0BalanceAfter.sub(strategyProviderToken0BalanceBefore)).to.be.equal(
        amount0PerformanceFee,
      );
      expect(strategyProviderToken1BalanceAfter.sub(strategyProviderToken1BalanceBefore)).to.be.equal(
        amount1PerformanceFee,
      );

      // user
      expect(userToken0BalanceAfter.sub(userToken0BalanceBefore)).to.be.equal(amount0Returned);
      expect(userToken1BalanceAfter.sub(userToken1BalanceBefore)).to.be.equal(amount1Returned);

      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);
    });

    it("should received token0 & token1 profit for user & strategy provide no share because of originalDepositUsdValue greater than total desired amount for OP/USDT pair", async function () {
      await providePoolLiquidity();
      const shareProfit = (await ethers.getContractAt("IShareProfit", positionManager.address)) as IShareProfit;
      let amount0Desired: BigNumber = BigNumber.from(3n * 10n ** 18n);
      let amount1Desired: BigNumber = BigNumber.from(1000n * 10n ** 6n);
      const originalDepositUsdValue: BigNumber = BigNumber.from(10000n ** 18n);
      const performanceFeeRatio: BigNumber = BigNumber.from(1000n); //10%

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenOP, tokenUSDT);
      [amount0Desired, amount1Desired] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      // const returnedToken = token0;
      // const performanceFeeReceivedToken = token0;

      await token0.connect(user).transfer(positionManager.address, amount0Desired);
      await token1.connect(user).transfer(positionManager.address, amount1Desired);

      const userToken0BalanceBefore = await token0.balanceOf(user.address);
      const userToken1BalanceBefore = await token1.balanceOf(user.address);
      const strategyProviderToken0BalanceBefore = await token0.balanceOf(strategyProvider.address);
      const strategyProviderToken1BalanceBefore = await token1.balanceOf(strategyProvider.address);
      const serviceFeeRecipientToken0BalanceBefore = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipientToken1BalanceBefore = await token1.balanceOf(serviceFeeRecipient.address);

      const txShare = await shareProfit.connect(user).shareProfit({
        token0: token0.address,
        token1: token1.address,
        returnedToken: "0x0000000000000000000000000000000000000000",
        amount0: amount0Desired,
        amount1: amount1Desired,
        originalDepositUsdValue: originalDepositUsdValue,
        performanceFeeRecipient: strategyProvider.address,
        performanceFeeReceivedToken: "0x0000000000000000000000000000000000000000",
        performanceFeeRatio: performanceFeeRatio,
        serviceFeeRatio: await registry.getServiceFeeRatioFromLicenseAmount(1), // with 1 license
      });

      const receipt = await txShare.wait();
      const events: any = receipt.events;
      const amount0Returned = events[events.length - 1].args.returnedAmount0;
      const amount1Returned = events[events.length - 1].args.returnedAmount1;
      const amount0PerformanceFee = events[events.length - 1].args.performanceFeeAmount0;
      const amount1PerformanceFee = events[events.length - 1].args.performanceFeeAmount1;
      const amount0ServiceFee = events[events.length - 1].args.serviceFeeAmount0;
      const amount1ServiceFee = events[events.length - 1].args.serviceFeeAmount1;

      expect(amount0Returned).to.be.equal(amount0Desired);
      expect(amount1Returned).to.be.equal(amount1Desired);
      expect(amount0PerformanceFee).to.be.equal(0);
      expect(amount1PerformanceFee).to.be.equal(0);
      expect(amount0ServiceFee).to.be.equal(0);
      expect(amount1ServiceFee).to.be.equal(0);

      const userToken0BalanceAfter = await token0.balanceOf(user.address);
      const userToken1BalanceAfter = await token1.balanceOf(user.address);
      const strategyProviderToken0BalanceAfter = await token0.balanceOf(strategyProvider.address);
      const strategyProviderToken1BalanceAfter = await token1.balanceOf(strategyProvider.address);
      const serviceFeeRecipientToken0BalanceAfter = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipientToken1BalanceAfter = await token1.balanceOf(serviceFeeRecipient.address);

      // service fee recipient
      expect(serviceFeeRecipientToken0BalanceAfter.sub(serviceFeeRecipientToken0BalanceBefore)).to.be.equal(
        amount0ServiceFee,
      );
      expect(serviceFeeRecipientToken1BalanceAfter.sub(serviceFeeRecipientToken1BalanceBefore)).to.be.equal(
        amount1ServiceFee,
      );

      // strategy provider
      expect(strategyProviderToken0BalanceAfter.sub(strategyProviderToken0BalanceBefore)).to.be.equal(
        amount0PerformanceFee,
      );
      expect(strategyProviderToken1BalanceAfter.sub(strategyProviderToken1BalanceBefore)).to.be.equal(
        amount1PerformanceFee,
      );

      // user
      expect(userToken0BalanceAfter.sub(userToken0BalanceBefore)).to.be.equal(amount0Returned);
      expect(userToken1BalanceAfter.sub(userToken1BalanceBefore)).to.be.equal(amount1Returned);

      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);
    });

    it("should received all token0 profit for user & strategy provide no share because of originalDepositUsdValue greater than total desired amount for OP/USDT pair", async function () {
      await providePoolLiquidity();
      const shareProfit = (await ethers.getContractAt("IShareProfit", positionManager.address)) as IShareProfit;
      let amount0Desired: BigNumber = BigNumber.from(3n * 10n ** 18n);
      let amount1Desired: BigNumber = BigNumber.from(1000n * 10n ** 6n);
      const originalDepositUsdValue: BigNumber = BigNumber.from(10000n ** 18n);
      const performanceFeeRatio: BigNumber = BigNumber.from(1000n); //10%

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenOP, tokenUSDT);
      [amount0Desired, amount1Desired] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      const returnedToken = token0;
      // const performanceFeeReceivedToken = token0;

      await token0.connect(user).transfer(positionManager.address, amount0Desired);
      await token1.connect(user).transfer(positionManager.address, amount1Desired);

      const userToken0BalanceBefore = await token0.balanceOf(user.address);
      const userToken1BalanceBefore = await token1.balanceOf(user.address);
      const strategyProviderToken0BalanceBefore = await token0.balanceOf(strategyProvider.address);
      const strategyProviderToken1BalanceBefore = await token1.balanceOf(strategyProvider.address);
      const serviceFeeRecipientToken0BalanceBefore = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipientToken1BalanceBefore = await token1.balanceOf(serviceFeeRecipient.address);

      const txShare = await shareProfit.connect(user).shareProfit({
        token0: token0.address,
        token1: token1.address,
        returnedToken: returnedToken.address,
        amount0: amount0Desired,
        amount1: amount1Desired,
        originalDepositUsdValue: originalDepositUsdValue,
        performanceFeeRecipient: strategyProvider.address,
        performanceFeeReceivedToken: "0x0000000000000000000000000000000000000000",
        performanceFeeRatio: performanceFeeRatio,
        serviceFeeRatio: await registry.getServiceFeeRatioFromLicenseAmount(1), // with 1 license
      });

      const receipt = await txShare.wait();
      const events: any = receipt.events;
      const amount0Returned = events[events.length - 1].args.returnedAmount0;
      const amount1Returned = events[events.length - 1].args.returnedAmount1;
      const amount0PerformanceFee = events[events.length - 1].args.performanceFeeAmount0;
      const amount1PerformanceFee = events[events.length - 1].args.performanceFeeAmount1;
      const amount0ServiceFee = events[events.length - 1].args.serviceFeeAmount0;
      const amount1ServiceFee = events[events.length - 1].args.serviceFeeAmount1;

      expect(amount0Returned).to.be.greaterThan(amount0Desired);
      expect(amount1Returned).to.be.equal(0);
      expect(amount0PerformanceFee).to.be.equal(0);
      expect(amount1PerformanceFee).to.be.equal(0);
      expect(amount0ServiceFee).to.be.equal(0);
      expect(amount1ServiceFee).to.be.equal(0);

      const userToken0BalanceAfter = await token0.balanceOf(user.address);
      const userToken1BalanceAfter = await token1.balanceOf(user.address);
      const strategyProviderToken0BalanceAfter = await token0.balanceOf(strategyProvider.address);
      const strategyProviderToken1BalanceAfter = await token1.balanceOf(strategyProvider.address);
      const serviceFeeRecipientToken0BalanceAfter = await token0.balanceOf(serviceFeeRecipient.address);
      const serviceFeeRecipientToken1BalanceAfter = await token1.balanceOf(serviceFeeRecipient.address);

      let token0SwappedFromToken1UserReturned: BigNumber = BigNumber.from(0);
      let userReturnedToken1: BigNumber = BigNumber.from(0);
      let count = 0;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolOPUSDT.address) {
          count++;

          // user returned amounts
          const eventData = parseEventData(events[i].data);
          token0SwappedFromToken1UserReturned = token0SwappedFromToken1UserReturned.add(
            BigNumber.from(0n - hexToInt256(hexToBn(eventData[0]))),
          );
          userReturnedToken1 = BigNumber.from(hexToInt256(hexToBn(eventData[1])));
        }
      }
      expect(count).to.be.equal(1);
      expect(userReturnedToken1).to.be.equal(amount1Desired);
      expect(amount0Desired.add(token0SwappedFromToken1UserReturned)).to.be.equal(amount0Returned);

      // service fee recipient
      expect(serviceFeeRecipientToken0BalanceAfter.sub(serviceFeeRecipientToken0BalanceBefore)).to.be.equal(
        amount0ServiceFee,
      );
      expect(serviceFeeRecipientToken1BalanceAfter.sub(serviceFeeRecipientToken1BalanceBefore)).to.be.equal(
        amount1ServiceFee,
      );

      // strategy provider
      expect(strategyProviderToken0BalanceAfter.sub(strategyProviderToken0BalanceBefore)).to.be.equal(
        amount0PerformanceFee,
      );
      expect(strategyProviderToken1BalanceAfter.sub(strategyProviderToken1BalanceBefore)).to.be.equal(
        amount1PerformanceFee,
      );

      // user
      expect(userToken0BalanceAfter.sub(userToken0BalanceBefore)).to.be.equal(amount0Returned);
      expect(userToken1BalanceAfter.sub(userToken1BalanceBefore)).to.be.equal(amount1Returned);

      // positionManager
      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);
    });
  });
});
