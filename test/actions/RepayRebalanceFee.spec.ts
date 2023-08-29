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
  IRepayRebalanceFee,
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

describe("RepayRebalanceFee.sol", function () {
  //GLOBAL VARIABLE - USE THIS

  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let user2: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let serviceFeeRecipient: SignerWithAddress;
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
      ["RepayRebalanceFee"],
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

  describe("RepayRebalanceFeeAction - repayRebalanceFee", function () {
    it("should repay rebalance fee for pair OP/USDT", async function () {
      // give pool some liquidity
      await nonFungiblePositionManager.connect(liquidityProvider).mint(
        {
          token0: tokenOP.address,
          token1: tokenUSDT.address,
          fee: 500,
          tickLower: 0 - 20,
          tickUpper: 0 + 20,
          amount0Desired: 30000n * 10n ** 18n,
          amount1Desired: 30000n * 10n ** 6n,
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
          tickLower: 0 - 10000,
          tickUpper: 0 + 10000,
          amount0Desired: 100000n * 10n ** 6n,
          amount1Desired: 100000n * 10n ** 6n,
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
          token1: tokenWETH.address,
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

      const repay = (await ethers.getContractAt("IRepayRebalanceFee", positionManager.address)) as IRepayRebalanceFee;
      const amount0Desired: bigint = 3n * 10n ** 18n;
      const amount1Desired: bigint = 100n * 10n ** 6n;

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenOP, tokenUSDT);
      const [amount0Quota, amount1Quota] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      const token0BalanceBefore = await token0.balanceOf(user.address);
      const token1BalanceBefore = await token1.balanceOf(user.address);

      await token0.connect(user).transfer(positionManager.address, amount0Quota);
      await token1.connect(user).transfer(positionManager.address, amount1Quota);

      const serviceFeeRecipientETHValueBefore = await ethers.provider.getBalance(serviceFeeRecipient.address);
      const txRepay = await repay.connect(user).repayRebalanceFee({
        token0: token0.address,
        token1: token1.address,
        amount0Quota: amount0Quota,
        amount1Quota: amount1Quota,
        rebalanceFee: 10n ** 18n,
        receiver: serviceFeeRecipient.address,
      });

      const receipt = await txRepay.wait();
      const events: any = receipt.events;
      const token0Repaid = events[events.length - 1].args.token0Repaid;
      const token1Repaid = events[events.length - 1].args.token1Repaid;
      const totalWETH9Repaid = events[events.length - 1].args.totalWETH9Repaid;

      let usdcSwapped: bigint = 0n;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolOPUSDC.address) {
          const eventData = parseEventData(events[i].data);
          usdcSwapped += hexToInt256(hexToBn(eventData[0]));
          // Swap event token0Repaid verification
          expect(token0Repaid).to.be.equal(BigNumber.from(hexToInt256(hexToBn(eventData[1]))));
        }
        if (events[i].address === poolUSDCUSDT.address) {
          const eventData = parseEventData(events[i].data);
          usdcSwapped += hexToInt256(hexToBn(eventData[0]));
          expect(token1Repaid).to.be.equal(BigNumber.from(hexToInt256(hexToBn(eventData[1]))));
        }

        if (events[i].address === poolUSDCWETH.address) {
          const eventData = parseEventData(events[i].data);
          expect(0n - usdcSwapped).to.be.equal(hexToInt256(hexToBn(eventData[0])));
          expect(totalWETH9Repaid).to.be.equal(BigNumber.from(0n - hexToInt256(hexToBn(eventData[1]))));
        }
      }

      expect(await ethers.provider.getBalance(serviceFeeRecipient.address)).to.be.equal(
        serviceFeeRecipientETHValueBefore.add(totalWETH9Repaid),
      );
      expect(await tokenUSDC.balanceOf(positionManager.address)).to.equal(0);
      expect(await tokenWETH.balanceOf(positionManager.address)).to.equal(0);
      expect(await token0.balanceOf(positionManager.address)).to.equal(BigNumber.from(amount0Quota).sub(token0Repaid));
      expect(await token1.balanceOf(positionManager.address)).to.equal(BigNumber.from(amount1Quota).sub(token1Repaid));
      expect((await token0.balanceOf(user.address)).add(amount0Quota)).to.equal(token0BalanceBefore);
      expect((await token1.balanceOf(user.address)).add(amount1Quota)).to.equal(token1BalanceBefore);
    });

    it("should repay rebalance fee for pair OP/USDC", async function () {
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
          token1: tokenWETH.address,
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

      const repay = (await ethers.getContractAt("IRepayRebalanceFee", positionManager.address)) as IRepayRebalanceFee;
      const amount0Desired: bigint = 3n * 10n ** 18n;
      const amount1Desired: bigint = 100n * 10n ** 6n;

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenOP, tokenUSDC);
      const [amount0Quota, amount1Quota] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      const token0BalanceBefore = await token0.balanceOf(user.address);
      const token1BalanceBefore = await token1.balanceOf(user.address);

      await token0.connect(user).transfer(positionManager.address, amount0Quota);
      await token1.connect(user).transfer(positionManager.address, amount1Quota);
      const serviceFeeRecipientETHValueBefore = await ethers.provider.getBalance(serviceFeeRecipient.address);
      const txRepay = await repay.connect(user).repayRebalanceFee({
        token0: token0.address,
        token1: token1.address,
        amount0Quota: amount0Quota,
        amount1Quota: amount1Quota,
        rebalanceFee: 10n ** 18n,
        receiver: serviceFeeRecipient.address,
      });

      const receipt = await txRepay.wait();
      const events: any = receipt.events;
      const token0Repaid = events[events.length - 1].args.token0Repaid;
      const token1Repaid = events[events.length - 1].args.token1Repaid;
      const totalWETH9Repaid = events[events.length - 1].args.totalWETH9Repaid;

      let usdcSwapped: bigint = 0n;
      const tokenRepaid = isOrderChanged ? token0Repaid : token1Repaid;
      usdcSwapped -= tokenRepaid.toBigInt();
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolOPUSDC.address) {
          const eventData = parseEventData(events[i].data);
          usdcSwapped += hexToInt256(hexToBn(eventData[0]));
          // Swap event token0Repaid verification
          const tokenRepaid = isOrderChanged ? token1Repaid : token0Repaid;
          expect(tokenRepaid).to.be.equal(BigNumber.from(hexToInt256(hexToBn(eventData[1]))));
        }

        if (events[i].address === poolUSDCWETH.address) {
          const eventData = parseEventData(events[i].data);
          expect(0n - usdcSwapped).to.be.equal(hexToInt256(hexToBn(eventData[0])));
          expect(totalWETH9Repaid).to.be.equal(BigNumber.from(0n - hexToInt256(hexToBn(eventData[1]))));
        }
      }

      expect(await ethers.provider.getBalance(serviceFeeRecipient.address)).to.be.equal(
        serviceFeeRecipientETHValueBefore.add(totalWETH9Repaid),
      );
      expect(await tokenWETH.balanceOf(positionManager.address)).to.equal(0);
      expect(await token0.balanceOf(positionManager.address)).to.equal(BigNumber.from(amount0Quota).sub(token0Repaid));
      expect(await token1.balanceOf(positionManager.address)).to.equal(BigNumber.from(amount1Quota).sub(token1Repaid));
      expect((await token0.balanceOf(user.address)).add(amount0Quota)).to.equal(token0BalanceBefore);
      expect((await token1.balanceOf(user.address)).add(amount1Quota)).to.equal(token1BalanceBefore);
    });

    it("should repay rebalance fee for pair OP/WETH", async function () {
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
          token1: tokenWETH.address,
          fee: 500,
          tickLower: 0 - 30,
          tickUpper: 0 + 30,
          amount0Desired: 1000n * 10n ** 18n,
          amount1Desired: 1000n * 10n ** 18n,
          amount0Min: 0,
          amount1Min: 0,
          recipient: liquidityProvider.address,
          deadline: Date.now() + 1000,
        },
        { gasLimit: 670000 },
      );

      const repay = (await ethers.getContractAt("IRepayRebalanceFee", positionManager.address)) as IRepayRebalanceFee;
      const amount0Desired: bigint = 3n * 10n ** 18n;
      const amount1Desired: bigint = 1n * 10n ** 18n;

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenOP, tokenWETH);
      const [amount0Quota, amount1Quota] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      const token0BalanceBefore = await token0.balanceOf(user.address);
      const token1BalanceBefore = await token1.balanceOf(user.address);

      await token0.connect(user).transfer(positionManager.address, amount0Quota);
      await token1.connect(user).transfer(positionManager.address, amount1Quota);
      const serviceFeeRecipientETHValueBefore = await ethers.provider.getBalance(serviceFeeRecipient.address);
      const txRepay = await repay.connect(user).repayRebalanceFee({
        token0: token0.address,
        token1: token1.address,
        amount0Quota: amount0Quota,
        amount1Quota: amount1Quota,
        rebalanceFee: 10n ** 12n,
        receiver: serviceFeeRecipient.address,
      });

      const receipt = await txRepay.wait();
      const events: any = receipt.events;
      const token0Repaid = events[events.length - 1].args.token0Repaid;
      const token1Repaid = events[events.length - 1].args.token1Repaid;
      const totalWETH9Repaid = events[events.length - 1].args.totalWETH9Repaid;

      let usdcSwapped: bigint = 0n;
      const tokenRepaid = isOrderChanged ? token0Repaid : token1Repaid;
      const wethRepaid = tokenRepaid;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolOPUSDC.address) {
          const eventData = parseEventData(events[i].data);
          usdcSwapped += hexToInt256(hexToBn(eventData[0]));
          // Swap event token0Repaid verification
          const tokenRepaid = isOrderChanged ? token1Repaid : token0Repaid;
          expect(tokenRepaid).to.be.equal(BigNumber.from(hexToInt256(hexToBn(eventData[1]))));
        }

        if (events[i].address === poolUSDCWETH.address) {
          const eventData = parseEventData(events[i].data);
          expect(0n - usdcSwapped).to.be.equal(hexToInt256(hexToBn(eventData[0])));
          expect(totalWETH9Repaid).to.be.equal(BigNumber.from(0n - hexToInt256(hexToBn(eventData[1]))).add(wethRepaid));
        }
      }

      expect(await ethers.provider.getBalance(serviceFeeRecipient.address)).to.be.equal(
        serviceFeeRecipientETHValueBefore.add(totalWETH9Repaid),
      );
      expect(await token0.balanceOf(positionManager.address)).to.equal(BigNumber.from(amount0Quota).sub(token0Repaid));
      expect(await token1.balanceOf(positionManager.address)).to.equal(BigNumber.from(amount1Quota).sub(token1Repaid));
      expect((await token0.balanceOf(user.address)).add(amount0Quota)).to.equal(token0BalanceBefore);
      expect((await token1.balanceOf(user.address)).add(amount1Quota)).to.equal(token1BalanceBefore);
    });

    it("should repay rebalance fee for pair USDT/USDC", async function () {
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

      // give pool some liquidity
      await nonFungiblePositionManager.connect(liquidityProvider).mint(
        {
          token0: tokenUSDC.address,
          token1: tokenWETH.address,
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

      const repay = (await ethers.getContractAt("IRepayRebalanceFee", positionManager.address)) as IRepayRebalanceFee;
      const amount0Desired: bigint = 1n * 10n ** 18n;
      const amount1Desired: bigint = 1n * 10n ** 18n;

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenUSDT, tokenUSDC);
      const [amount0Quota, amount1Quota] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      const token0BalanceBefore = await token0.balanceOf(user.address);
      const token1BalanceBefore = await token1.balanceOf(user.address);

      await token0.connect(user).transfer(positionManager.address, amount0Quota);
      await token1.connect(user).transfer(positionManager.address, amount1Quota);
      const serviceFeeRecipientETHValueBefore = await ethers.provider.getBalance(serviceFeeRecipient.address);
      const txRepay = await repay.connect(user).repayRebalanceFee({
        token0: token0.address,
        token1: token1.address,
        amount0Quota: amount0Quota,
        amount1Quota: amount1Quota,
        rebalanceFee: 10n ** 10n,
        receiver: serviceFeeRecipient.address,
      });

      const receipt = await txRepay.wait();
      const events: any = receipt.events;
      const token0Repaid = events[events.length - 1].args.token0Repaid;
      const token1Repaid = events[events.length - 1].args.token1Repaid;
      const totalWETH9Repaid = events[events.length - 1].args.totalWETH9Repaid;

      let usdcSwapped: bigint = 0n;
      const tokenRepaid = isOrderChanged ? token0Repaid : token1Repaid;
      usdcSwapped -= tokenRepaid.toBigInt();
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolUSDCUSDT.address) {
          const eventData = parseEventData(events[i].data);
          usdcSwapped += hexToInt256(hexToBn(eventData[0]));
          // Swap event token0Repaid verification
          const tokenRepaid = isOrderChanged ? token1Repaid : token0Repaid;
          expect(tokenRepaid).to.be.equal(BigNumber.from(hexToInt256(hexToBn(eventData[1]))));
        }

        if (events[i].address === poolUSDCWETH.address) {
          const eventData = parseEventData(events[i].data);
          expect(0n - usdcSwapped).to.be.equal(hexToInt256(hexToBn(eventData[0])));
          expect(totalWETH9Repaid).to.be.equal(BigNumber.from(0n - hexToInt256(hexToBn(eventData[1]))));
        }
      }

      expect(await ethers.provider.getBalance(serviceFeeRecipient.address)).to.be.equal(
        serviceFeeRecipientETHValueBefore.add(totalWETH9Repaid),
      );
      expect(await tokenWETH.balanceOf(positionManager.address)).to.equal(0);
      expect(await token0.balanceOf(positionManager.address)).to.equal(BigNumber.from(amount0Quota).sub(token0Repaid));
      expect(await token1.balanceOf(positionManager.address)).to.equal(BigNumber.from(amount1Quota).sub(token1Repaid));
      expect((await token0.balanceOf(user.address)).add(amount0Quota)).to.equal(token0BalanceBefore);
      expect((await token1.balanceOf(user.address)).add(amount1Quota)).to.equal(token1BalanceBefore);
    });

    it("should repay rebalance fee for pair USDT/WETH", async function () {
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

      // give pool some liquidity
      await nonFungiblePositionManager.connect(liquidityProvider).mint(
        {
          token0: tokenUSDC.address,
          token1: tokenWETH.address,
          fee: 500,
          tickLower: 0 - 30,
          tickUpper: 0 + 30,
          amount0Desired: 1000n * 10n ** 18n,
          amount1Desired: 1000n * 10n ** 18n,
          amount0Min: 0,
          amount1Min: 0,
          recipient: liquidityProvider.address,
          deadline: Date.now() + 1000,
        },
        { gasLimit: 670000 },
      );

      const repay = (await ethers.getContractAt("IRepayRebalanceFee", positionManager.address)) as IRepayRebalanceFee;
      const amount0Desired: bigint = 3n * 10n ** 18n;
      const amount1Desired: bigint = 1n * 10n ** 18n;

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenUSDT, tokenWETH);
      const [amount0Quota, amount1Quota] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      const token0BalanceBefore = await token0.balanceOf(user.address);
      const token1BalanceBefore = await token1.balanceOf(user.address);

      await token0.connect(user).transfer(positionManager.address, amount0Quota);
      await token1.connect(user).transfer(positionManager.address, amount1Quota);
      const serviceFeeRecipientETHValueBefore = await ethers.provider.getBalance(serviceFeeRecipient.address);
      const txRepay = await repay.connect(user).repayRebalanceFee({
        token0: token0.address,
        token1: token1.address,
        amount0Quota: amount0Quota,
        amount1Quota: amount1Quota,
        rebalanceFee: 10n ** 12n,
        receiver: serviceFeeRecipient.address,
      });

      const receipt = await txRepay.wait();
      const events: any = receipt.events;
      const token0Repaid = events[events.length - 1].args.token0Repaid;
      const token1Repaid = events[events.length - 1].args.token1Repaid;
      const totalWETH9Repaid = events[events.length - 1].args.totalWETH9Repaid;

      let usdcSwapped: bigint = 0n;
      const tokenRepaid = isOrderChanged ? token0Repaid : token1Repaid;
      const wethRepaid = tokenRepaid;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolUSDCUSDT.address) {
          const eventData = parseEventData(events[i].data);
          usdcSwapped += hexToInt256(hexToBn(eventData[0]));
          // Swap event token0Repaid verification
          const tokenRepaid = isOrderChanged ? token1Repaid : token0Repaid;
          expect(tokenRepaid).to.be.equal(BigNumber.from(hexToInt256(hexToBn(eventData[1]))));
        }

        if (events[i].address === poolUSDCWETH.address) {
          const eventData = parseEventData(events[i].data);
          expect(0n - usdcSwapped).to.be.equal(hexToInt256(hexToBn(eventData[0])));
          expect(totalWETH9Repaid).to.be.equal(BigNumber.from(0n - hexToInt256(hexToBn(eventData[1]))).add(wethRepaid));
        }
      }

      expect(await ethers.provider.getBalance(serviceFeeRecipient.address)).to.be.equal(
        serviceFeeRecipientETHValueBefore.add(totalWETH9Repaid),
      );
      expect(await token0.balanceOf(positionManager.address)).to.equal(BigNumber.from(amount0Quota).sub(token0Repaid));
      expect(await token1.balanceOf(positionManager.address)).to.equal(BigNumber.from(amount1Quota).sub(token1Repaid));
      expect((await token0.balanceOf(user.address)).add(amount0Quota)).to.equal(token0BalanceBefore);
      expect((await token1.balanceOf(user.address)).add(amount1Quota)).to.equal(token1BalanceBefore);
    });

    it("should repay rebalance fee for pair USDC/WETH", async function () {
      // give pool some liquidity
      await nonFungiblePositionManager.connect(liquidityProvider).mint(
        {
          token0: tokenUSDC.address,
          token1: tokenWETH.address,
          fee: 500,
          tickLower: 0 - 30,
          tickUpper: 0 + 30,
          amount0Desired: 1000n * 10n ** 18n,
          amount1Desired: 1000n * 10n ** 18n,
          amount0Min: 0,
          amount1Min: 0,
          recipient: liquidityProvider.address,
          deadline: Date.now() + 1000,
        },
        { gasLimit: 670000 },
      );

      const repay = (await ethers.getContractAt("IRepayRebalanceFee", positionManager.address)) as IRepayRebalanceFee;
      const amount0Desired: bigint = 1n * 10n ** 18n;
      const amount1Desired: bigint = 1n * 10n ** 18n;

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenUSDC, tokenWETH);
      const [amount0Quota, amount1Quota] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      const token0BalanceBefore = await token0.balanceOf(user.address);
      const token1BalanceBefore = await token1.balanceOf(user.address);

      await token0.connect(user).transfer(positionManager.address, amount0Quota);
      await token1.connect(user).transfer(positionManager.address, amount1Quota);
      const serviceFeeRecipientETHValueBefore = await ethers.provider.getBalance(serviceFeeRecipient.address);
      const txRepay = await repay.connect(user).repayRebalanceFee({
        token0: token0.address,
        token1: token1.address,
        amount0Quota: amount0Quota,
        amount1Quota: amount1Quota,
        rebalanceFee: 10n ** 10n,
        receiver: serviceFeeRecipient.address,
      });

      const receipt = await txRepay.wait();
      const events: any = receipt.events;
      const token0Repaid = events[events.length - 1].args.token0Repaid;
      const token1Repaid = events[events.length - 1].args.token1Repaid;
      const totalWETH9Repaid = events[events.length - 1].args.totalWETH9Repaid;

      let usdcSwapped: bigint = 0n;
      usdcSwapped -= (isOrderChanged ? token1Repaid : token0Repaid).toBigInt();
      const wethRepaid = isOrderChanged ? token0Repaid : token1Repaid;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolUSDCWETH.address) {
          const eventData = parseEventData(events[i].data);
          expect(0n - usdcSwapped).to.be.equal(hexToInt256(hexToBn(eventData[0])));
          expect(totalWETH9Repaid).to.be.equal(BigNumber.from(0n - hexToInt256(hexToBn(eventData[1]))).add(wethRepaid));
        }
      }

      expect(await ethers.provider.getBalance(serviceFeeRecipient.address)).to.be.equal(
        serviceFeeRecipientETHValueBefore.add(totalWETH9Repaid),
      );
      expect(await token0.balanceOf(positionManager.address)).to.equal(BigNumber.from(amount0Quota).sub(token0Repaid));
      expect(await token1.balanceOf(positionManager.address)).to.equal(BigNumber.from(amount1Quota).sub(token1Repaid));
      expect((await token0.balanceOf(user.address)).add(amount0Quota)).to.equal(token0BalanceBefore);
      expect((await token1.balanceOf(user.address)).add(amount1Quota)).to.equal(token1BalanceBefore);
    });
  });
});
