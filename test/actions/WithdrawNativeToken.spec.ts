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
  IWithdrawNativeToken,
  MockToken,
  MockWETH9,
  PositionManager,
  PositionManagerFactory,
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
  doAllApprovals,
  tokensFixture,
  weth9Fixture,
} from "../shared/fixtures";

describe("WithdrawNativeToken.sol", function () {
  //GLOBAL VARIABLE - USE THIS

  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let user2: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let serviceFeeRecipient: SignerWithAddress;
  let registry: Registry;
  let registryAddressHolder: RegistryAddressHolder;

  //all the token used globally
  let tokenWETH9: MockWETH9;
  let tokenWETH: MockToken, tokenUSDC: MockToken;
  let uniswapV3Factory: Contract; // the factory that will deploy all pools
  let nonFungiblePositionManager: INonfungiblePositionManager; // NonFungiblePositionManager contract by UniswapV3
  let swapRouter: ISwapRouter;
  let positionManager: PositionManager; // Position manager contract

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

    //deploy uniswap contracts needed
    [uniswapV3Factory, nonFungiblePositionManager, swapRouter] = await deployUniswapContracts(tokenWETH);

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
    const strategyProviderWalletFactory = (await strategyProviderWalletFactoryFactory.deploy(
      registryAddressHolder.address,
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
      [tokenWETH, tokenUSDC],
    );
    //approval nfts
    await nonFungiblePositionManager.setApprovalForAll(positionManager.address, true);
  });

  describe("WithdrawNativeTokenAction - withdrawNativeToken", function () {
    it("should withdraw native token success", async function () {
      const user2BeforeValue = await ethers.provider.getBalance(user2.address);

      // send some ETH to positionManager
      await user.sendTransaction({
        to: positionManager.address,
        value: 2n * 10n ** 18n,
      });

      const withdrawNT = (await ethers.getContractAt(
        "IWithdrawNativeToken",
        positionManager.address,
      )) as IWithdrawNativeToken;

      await withdrawNT.connect(user).withdrawNativeToken({
        amount: 1n * 10n ** 18n,
        receiver: user2.address,
      });

      expect(await ethers.provider.getBalance(user2.address)).to.equal(user2BeforeValue.add(1n * 10n ** 18n));
      expect(await ethers.provider.getBalance(positionManager.address)).to.equal(1n * 10n ** 18n);
    });

    it("should withdraw native token reverted with WNTMIB", async function () {
      // send some ETH to positionManager
      await user.sendTransaction({
        to: positionManager.address,
        value: 2n * 10n ** 18n,
      });

      const withdrawNT = (await ethers.getContractAt(
        "IWithdrawNativeToken",
        positionManager.address,
      )) as IWithdrawNativeToken;

      await expect(
        withdrawNT.connect(user).withdrawNativeToken({
          amount: 3n * 10n ** 18n,
          receiver: user2.address,
        }),
      ).to.be.revertedWith("WNTMIB");
    });
  });
});
