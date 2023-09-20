import { reset } from "@nomicfoundation/hardhat-network-helpers";
import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract } from "ethers";
import { ethers } from "hardhat";
import hre from "hardhat";

import {
  IClosePosition,
  INonfungiblePositionManager,
  MockToken,
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
  mintSTDAmount,
  poolFixture,
  tokensFixture,
} from "../shared/fixtures";

describe("ClosePosition.sol", function () {
  //GLOBAL VARIABLE - USE THIS

  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let serviceFeeRecipient: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let registry: Registry;
  let registryAddressHolder: RegistryAddressHolder;

  //all the token used globally
  let tokenWETH: MockToken, tokenUSDC: MockToken;

  let uniswapV3Factory: Contract; // the factory that will deploy all pools
  let nonFungiblePositionManager: INonfungiblePositionManager; // NonFungiblePositionManager contract by UniswapV3
  let positionManager: PositionManager; // Position manager contract

  beforeEach(async function () {
    await reset(process.env.ALCHEMY_OPTIMISM_MAINNET, 107735214);
    //deploy our contracts
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];
    serviceFeeRecipient = signers[2];
    liquidityProvider = signers[3];

    //deploy the tokens - ETH, USDC
    tokenWETH = (await tokensFixture("WETH", 18)).tokenFixture;
    tokenUSDC = (await tokensFixture("USDC", 6)).tokenFixture;

    //deploy uniswap contracts needed
    [uniswapV3Factory, nonFungiblePositionManager] = await deployUniswapContracts(tokenWETH);

    //deploy first pool
    await poolFixture(tokenUSDC, tokenWETH, 500, uniswapV3Factory, 0);

    //mint 1e30 token, you can call with arbitrary amount
    await mintSTDAmount(tokenWETH, "100000000000000000000");
    await mintSTDAmount(tokenUSDC);
    //deploy the registry
    registry = (
      await RegistryFixture(
        await deployer.getAddress(),
        await serviceFeeRecipient.getAddress(),
        500,
        4,
        tokenUSDC.address,
        tokenWETH.address,
      )
    ).registryFixture;
    registryAddressHolder = (await RegistryAddressHolderFixture(registry.address)).registryAddressHolderFixture;

    const uniswapAddressHolder = await deployContract("UniswapAddressHolder", [
      registryAddressHolder.address,
      nonFungiblePositionManager.address,
      uniswapV3Factory.address,
      nonFungiblePositionManager.address,
    ]);
    const diamondCutFacet = await deployContract("DiamondCutFacet");

    //deploy the PositionManagerFactory => deploy PositionManager
    const positionManagerFactory = (await deployPositionManagerFactoryAndActions(
      registryAddressHolder.address,
      uniswapAddressHolder.address,
      diamondCutFacet.address,
      ["ClosePosition"],
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
    // give pool some liquidity
    const txMint = await nonFungiblePositionManager.connect(liquidityProvider).mint(
      {
        token0: tokenUSDC.address < tokenWETH.address ? tokenUSDC.address : tokenWETH.address,
        token1: tokenWETH.address > tokenUSDC.address ? tokenWETH.address : tokenUSDC.address,
        fee: 500,
        tickLower: 0 - 60,
        tickUpper: 0 + 60,
        amount0Desired: 1000n * 10n ** 6n,
        amount1Desired: 1n * 10n ** 18n,
        amount0Min: 0,
        amount1Min: 0,
        recipient: liquidityProvider.address,
        deadline: Date.now() + 1000,
      },
      { gasLimit: 670000 },
    );
    await txMint.wait();
  });

  describe("ClosePositionAction - closePosition", function () {
    it("should close a uni position without return user", async function () {
      const usdcBalanceBefore = await tokenUSDC.balanceOf(user.address);
      const wethBalanceBefore = await tokenWETH.balanceOf(user.address);
      const minAmount0 = "0x" + (1e9).toString(16);
      const minAmount1 = "0x" + (1e9).toString(16);
      const txMint = await nonFungiblePositionManager.connect(user).mint(
        {
          token0: tokenUSDC.address < tokenWETH.address ? tokenUSDC.address : tokenWETH.address,
          token1: tokenWETH.address > tokenUSDC.address ? tokenWETH.address : tokenUSDC.address,
          fee: 500,
          tickLower: 0 - 60 * 1000,
          tickUpper: 0 + 60 * 1000,
          amount0Desired: minAmount0,
          amount1Desired: minAmount1,
          amount0Min: 0,
          amount1Min: 0,
          recipient: positionManager.address,
          deadline: Date.now() + 1000,
        },
        { gasLimit: 670000 },
      );

      const receipt = await txMint.wait();
      const events: any = receipt.events;
      const tokenId = events[events.length - 1].args.tokenId;

      const usdcBalanceCurrent = await tokenUSDC.balanceOf(user.address);
      const wethBalanceCurrent = await tokenWETH.balanceOf(user.address);

      expect(usdcBalanceBefore.sub(usdcBalanceCurrent)).to.equal(events[events.length - 1].args.amount0);
      expect(wethBalanceBefore.sub(wethBalanceCurrent)).to.equal(events[events.length - 1].args.amount1);

      const close = (await ethers.getContractAt("IClosePosition", positionManager.address)) as IClosePosition;
      const txClosed = await close.connect(user).closePosition(tokenId, false);
      const eventsClosed: any = (await txClosed.wait()).events;
      const tokenIdClosed = eventsClosed[eventsClosed.length - 1].args.tokenId;
      const amount0Received = ((eventsClosed[eventsClosed.length - 1].args.amount0CollectedFee as bigint) +
        eventsClosed[eventsClosed.length - 1].args.amount0Removed) as bigint;
      const amount1Received = ((eventsClosed[eventsClosed.length - 1].args.amount1CollectedFee as bigint) +
        eventsClosed[eventsClosed.length - 1].args.amount1Removed) as bigint;
      expect(tokenIdClosed).to.equal(tokenId);
      expect(await tokenUSDC.balanceOf(positionManager.address)).to.equal(amount0Received);
      expect(await tokenWETH.balanceOf(positionManager.address)).to.equal(amount1Received);
    });

    it("should close a uni position with return user", async function () {
      const usdcBalanceBefore = await tokenUSDC.balanceOf(user.address);
      const wethBalanceBefore = await tokenWETH.balanceOf(user.address);
      const minAmount0 = "0x" + (1e9).toString(16);
      const minAmount1 = "0x" + (1e9).toString(16);
      const txMint = await nonFungiblePositionManager.connect(user).mint(
        {
          token0: tokenUSDC.address < tokenWETH.address ? tokenUSDC.address : tokenWETH.address,
          token1: tokenWETH.address > tokenUSDC.address ? tokenWETH.address : tokenUSDC.address,
          fee: 500,
          tickLower: 0 - 60 * 1000,
          tickUpper: 0 + 60 * 1000,
          amount0Desired: minAmount0,
          amount1Desired: minAmount1,
          amount0Min: 0,
          amount1Min: 0,
          recipient: positionManager.address,
          deadline: Date.now() + 1000,
        },
        { gasLimit: 670000 },
      );

      const receipt = await txMint.wait();
      const events: any = receipt.events;
      const tokenId = events[events.length - 1].args.tokenId;

      const usdcBalanceCurrent = await tokenUSDC.balanceOf(user.address);
      const wethBalanceCurrent = await tokenWETH.balanceOf(user.address);

      expect(usdcBalanceBefore.sub(usdcBalanceCurrent)).to.equal(events[events.length - 1].args.amount0);
      expect(wethBalanceBefore.sub(wethBalanceCurrent)).to.equal(events[events.length - 1].args.amount1);

      const close = (await ethers.getContractAt("IClosePosition", positionManager.address)) as IClosePosition;
      const txClosed = await close.connect(user).closePosition(tokenId, true);
      const eventsClosed: any = (await txClosed.wait()).events;
      const tokenIdClosed = eventsClosed[eventsClosed.length - 1].args.tokenId;
      const amount0Received = eventsClosed[eventsClosed.length - 1].args.amount0CollectedFee.add(
        eventsClosed[eventsClosed.length - 1].args.amount0Removed,
      );
      const amount1Received = eventsClosed[eventsClosed.length - 1].args.amount1CollectedFee.add(
        eventsClosed[eventsClosed.length - 1].args.amount1Removed,
      );
      expect(tokenIdClosed).to.equal(tokenId);
      expect(await tokenUSDC.balanceOf(user.address)).to.equal(amount0Received.add(usdcBalanceCurrent));
      expect(await tokenWETH.balanceOf(user.address)).to.equal(amount1Received.add(wethBalanceCurrent));
    });
  });
});
