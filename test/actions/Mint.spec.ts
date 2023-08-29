import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract } from "ethers";
import { ethers } from "hardhat";
import hre from "hardhat";

import {
  IMint,
  INonfungiblePositionManager,
  MockToken,
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
  doAllApprovals,
  mintSTDAmount,
  poolFixture,
  tokensFixture,
} from "../shared/fixtures";

describe("Mint.sol", function () {
  //GLOBAL VARIABLE - USE THIS

  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let serviceFeeRecipient: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let registry: Registry;

  //all the token used globally
  let tokenWETH: MockToken, tokenUSDC: MockToken;

  let uniswapV3Factory: Contract; // the factory that will deploy all pools
  let nonFungiblePositionManager: INonfungiblePositionManager; // NonFungiblePositionManager contract by UniswapV3
  let positionManager: PositionManager; // Position manager contract

  beforeEach(async function () {
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
    await poolFixture(tokenUSDC, tokenWETH, 500, uniswapV3Factory, -1);

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
    const uniswapAddressHolder = await deployContract("UniswapAddressHolder", [
      nonFungiblePositionManager.address,
      uniswapV3Factory.address,
      nonFungiblePositionManager.address,
      registry.address,
    ]);
    const diamondCutFacet = await deployContract("DiamondCutFacet");

    //deploy the PositionManagerFactory => deploy PositionManager
    const positionManagerFactory = (await deployPositionManagerFactoryAndActions(
      registry.address,
      diamondCutFacet.address,
      uniswapAddressHolder.address,
      ["Mint"],
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
      [tokenWETH, tokenUSDC],
    );
    //approval nfts
    await nonFungiblePositionManager.setApprovalForAll(positionManager.address, true);

    // give pool some liquidity
    await nonFungiblePositionManager.connect(liquidityProvider).mint(
      {
        token0: tokenUSDC.address,
        token1: tokenWETH.address,
        fee: 500,
        tickLower: 0 - 60,
        tickUpper: 0 + 60,
        amount0Desired: "0x" + (1e12).toString(16),
        amount1Desired: "0x" + (1e20).toString(16),
        amount0Min: 0,
        amount1Min: 0,
        recipient: liquidityProvider.address,
        deadline: Date.now() + 1000,
      },
      { gasLimit: 670000 },
    );
  });

  describe("MintAction - mint", function () {
    it("should mint a uni position", async function () {
      const usdcBalanceBefore = await tokenUSDC.balanceOf(user.address);
      const wethBalanceBefore = await tokenWETH.balanceOf(user.address);

      const mint = (await ethers.getContractAt("IMint", positionManager.address)) as IMint;

      const amount0Desired = 100n * 10n ** 6n;
      const amount1Desired = 3n * 10n ** 18n;

      await tokenUSDC.connect(user).transfer(positionManager.address, amount0Desired);
      await tokenWETH.connect(user).transfer(positionManager.address, amount1Desired);
      /*
      0.01% - 可調整區間 0.01%
      0.05% - 可調整區間 0.1%
      0.3% - 可調整區間 0.6%
      1% - 可調整區間 2%
      */
      const tickLower = -20n;
      const tickUpper = 20n;
      const txMint = await mint.connect(user).mint({
        token0Address: tokenUSDC.address,
        token1Address: tokenWETH.address,
        fee: 500,
        tickLower: tickLower,
        tickUpper: tickUpper,
        amount0Desired: amount0Desired,
        amount1Desired: amount1Desired,
        isReturnLeftOver: true,
      });

      const receipt = await txMint.wait();
      const events: any = receipt.events;
      const amount0Deposited = events[events.length - 1].args.amount0Deposited;
      const amount1Deposited = events[events.length - 1].args.amount1Deposited;

      expect(await tokenUSDC.balanceOf(positionManager.address)).to.equal(0);
      expect(await tokenWETH.balanceOf(positionManager.address)).to.equal(0);
      expect((await tokenUSDC.balanceOf(user.address)).add(amount0Deposited)).to.equal(usdcBalanceBefore);
      expect((await tokenWETH.balanceOf(user.address)).add(amount1Deposited)).to.equal(wethBalanceBefore);
    });
  });
});
