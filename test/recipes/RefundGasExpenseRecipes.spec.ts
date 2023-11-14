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
  ISwapRouter,
  IUniswapV3Pool,
  MockToken,
  MockWETH9,
  PositionManager,
  PositionManagerFactory,
  RefundGasExpenseRecipes,
  Registry,
  RegistryAddressHolder,
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
  mintSTDAmount,
  poolFixture,
  tokensFixture,
  weth9Fixture,
} from "../shared/fixtures";

describe("RefundGasExpenseRecipes.sol", function () {
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

  let uniswapV3Factory: Contract; // the factory that will deploy all pools
  let nonFungiblePositionManager: INonfungiblePositionManager; // NonFungiblePositionManager contract by UniswapV3
  let swapRouter: ISwapRouter;
  let positionManager: PositionManager; // Position manager contract
  let positionManager2: PositionManager; // Position manager contract
  let strategyProviderWalletFactory: StrategyProviderWalletFactory;
  let refundGasExpenseRecipes: RefundGasExpenseRecipes;
  let registryAddressHolder: RegistryAddressHolder;

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
      ["WithdrawNativeToken"],
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

    //deploy RefundGasExpenseRecipes contract
    refundGasExpenseRecipes = (await deployContract("RefundGasExpenseRecipes", [
      registryAddressHolder.address,
    ])) as RefundGasExpenseRecipes;

    await registry.addNewContract(
      hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("RefundGasExpenseRecipes")),
      refundGasExpenseRecipes.address,
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
        refundGasExpenseRecipes.address,
      ],
      [tokenWETH, tokenUSDC, tokenUSDT, tokenOP],
    );
    //approval nfts
    await nonFungiblePositionManager.setApprovalForAll(positionManager.address, true);
  });

  describe("RefundGasExpense", function () {
    it("should refundGasExpense success", async function () {
      const userBeforeValue = await ethers.provider.getBalance(user.address);
      const amountToPM = BigNumber.from(1n * 10n ** 18n);
      await user2.sendTransaction({
        to: positionManager.address,
        value: amountToPM,
      });

      const amount = BigNumber.from(1n * 10n ** 18n);
      const txRefund = await refundGasExpenseRecipes.connect(user).refundGasExpense(amount);

      const receipt = await txRefund.wait();

      const events: any = receipt.events;
      const fromInLog = events[events.length - 1].args.from;
      const receiverInLog = events[events.length - 1].args.receiver;
      const amountInLog = events[events.length - 1].args.amount;

      expect(fromInLog).to.be.equal(user.address);
      expect(receiverInLog).to.be.equal(user.address);
      expect(amountInLog).to.be.equal(amount);

      expect(await ethers.provider.getBalance(user.address)).to.equal(
        userBeforeValue.add(amount).sub(receipt.effectiveGasPrice.mul(receipt.gasUsed)),
      );
      expect(await ethers.provider.getBalance(positionManager.address)).to.equal(0n);
    });

    it("should refundGasExpense with leftover in position manager success", async function () {
      const userBeforeValue = await ethers.provider.getBalance(user.address);
      const amountToPM = BigNumber.from(2n * 10n ** 18n);
      await user2.sendTransaction({
        to: positionManager.address,
        value: amountToPM,
      });

      const amount = BigNumber.from(1n * 10n ** 18n);
      const txRefund = await refundGasExpenseRecipes.connect(user).refundGasExpense(amount);

      const receipt = await txRefund.wait();
      const events: any = receipt.events;
      const fromInLog = events[events.length - 1].args.from;
      const receiverInLog = events[events.length - 1].args.receiver;
      const amountInLog = events[events.length - 1].args.amount;

      expect(fromInLog).to.be.equal(user.address);
      expect(receiverInLog).to.be.equal(user.address);
      expect(amountInLog).to.be.equal(amount);

      expect(await ethers.provider.getBalance(user.address)).to.equal(
        userBeforeValue.add(amount).sub(receipt.effectiveGasPrice.mul(receipt.gasUsed)),
      );
      expect(await ethers.provider.getBalance(positionManager.address)).to.equal(1n * 10n ** 18n);
    });

    it("should refundGasExpense reverted with WNTMIB", async function () {
      const amountToPM = BigNumber.from(1n * 10n ** 18n);
      await user.sendTransaction({
        to: positionManager.address,
        value: amountToPM,
      });

      const amount = BigNumber.from(2n * 10n ** 18n);
      await expect(refundGasExpenseRecipes.connect(user).refundGasExpense(amount)).to.be.revertedWith("WNTMIB");
    });
  });
});
