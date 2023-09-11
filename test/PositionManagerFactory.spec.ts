import "@nomiclabs/hardhat-ethers";
import { expect } from "chai";
import { Signer } from "ethers";
import { ethers } from "hardhat";
import hre from "hardhat";

// import PositionManagerContract from "../artifacts/contracts/PositionManager.sol/PositionManager.json";
import {
  DiamondCutFacet,
  Mint,
  MockToken,
  PositionManager,
  PositionManagerFactory,
  Registry,
  StrategyProviderWalletFactory,
  SwapToPositionRatio,
  UniswapAddressHolder,
} from "../types";
import {
  RegistryFixture,
  deployContract,
  deployUniswapContracts,
  getSelectors,
  tokensFixture,
  zeroAddress,
} from "./shared/fixtures";

describe("PositionManagerFactory.sol", function () {
  let deployer: Signer;
  let user: Signer;
  let serviceFeeRecipient: Signer;
  let usdValueTokenAddress: MockToken;
  let weth: MockToken;
  let Registry: Registry;
  let token0: MockToken;
  let token1: MockToken;
  let PMF: PositionManagerFactory;
  let SPWF: StrategyProviderWalletFactory;
  let DCF: DiamondCutFacet;
  let UAH: UniswapAddressHolder;
  let mintAction: Mint;
  let swapToPositionRatioAction: SwapToPositionRatio;

  async function deployRegistry() {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];
    serviceFeeRecipient = signers[2];

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

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];
    serviceFeeRecipient = signers[2];

    await deployRegistry();

    token0 = (await tokensFixture("ETH", 18)).tokenFixture;
    token1 = (await tokensFixture("USDC", 6)).tokenFixture;

    //deploy factory, used for pools
    const [uniswapFactory, nonFungiblePositionManager, swapRouter] = await deployUniswapContracts(token0);
    UAH = (await deployContract("UniswapAddressHolder", [
      nonFungiblePositionManager.address,
      uniswapFactory.address,
      swapRouter.address,
      Registry.address,
    ])) as UniswapAddressHolder;

    await token0.mint(await user.getAddress(), ethers.utils.parseEther("1000000000000"));
    await token1.mint(await user.getAddress(), ethers.utils.parseEther("1000000000000"));

    DCF = (await deployContract("DiamondCutFacet")) as DiamondCutFacet;

    await token0
      .connect(signers[0])
      .approve(nonFungiblePositionManager.address, ethers.utils.parseEther("1000000000000"));

    await token1.approve(nonFungiblePositionManager.address, ethers.utils.parseEther("1000000000000"), {
      from: signers[0].address,
    });

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
  });

  describe("PositionManagerFactory changeRegistry", function () {
    it("Should success change registry", async () => {
      await PMF.connect(deployer).changeRegistry(await deployer.getAddress());
      expect(await PMF.registry()).to.be.equal(await deployer.getAddress());
    });

    it("Should fail change registry by others not owner", async () => {
      await expect(PMF.connect(user).changeRegistry(await deployer.getAddress())).to.be.revertedWith("PFOG");
    });

    it("Should fail change registry by zero address", async () => {
      await expect(PMF.connect(deployer).changeRegistry(zeroAddress)).to.be.revertedWith("PFCR");
    });
  });

  describe("PositionManagerFactory - create", function () {
    it("Should create a new position manager instance", async function () {
      await Registry.addNewContract(
        hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("PositionManagerFactory")),
        PMF.address,
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

      await PMF.connect(deployer).create();

      const deployedContract = await PMF.positionManagers(0);
      const PM = (await ethers.getContractAt("PositionManager", deployedContract)) as PositionManager;

      expect(PM).to.exist;

      const { managers, newCursor } = await PMF.getPositionManagers(0, 3);
      expect(managers.length).to.be.equal(1);
      expect(newCursor).to.be.equal(1);
      expect(managers[0]).to.be.equal(deployedContract);
    });

    it("Should fail to create a new position manager instance when contract is paused", async function () {
      await Registry.addNewContract(
        hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("PositionManagerFactory")),
        PMF.address,
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
      await PMF.connect(deployer).pause();

      await expect(PMF.connect(deployer).create()).to.be.revertedWith("Pausable: paused");

      // unpause
      await PMF.connect(deployer).unpause();

      await PMF.connect(deployer).create();

      const deployedContract = await PMF.positionManagers(0);
      const PM = (await ethers.getContractAt("PositionManager", deployedContract)) as PositionManager;

      expect(PM).to.exist;
    });

    it("should remove the mint action from an existing position manager", async () => {
      await Registry.addNewContract(
        hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("PositionManagerFactory")),
        PMF.address,
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

      await PMF.connect(deployer).create();

      const deployedContract = await PMF.positionManagers(0);
      const PM = (await ethers.getContractAt("PositionManager", deployedContract)) as PositionManager;

      expect(PM).to.exist;

      const positionManagerAddress = await PMF.positionManagers(0);

      await PMF.updateDiamond(positionManagerAddress, [
        {
          facetAddress: "0x0000000000000000000000000000000000000000",
          action: 2,
          functionSelectors: await getSelectors(mintAction),
        },
      ]);
    });

    it("should change the swap action address from an existing position manager", async () => {
      await Registry.addNewContract(
        hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("PositionManagerFactory")),
        PMF.address,
        hre.ethers.utils.formatBytes32String("1"),
      );

      await Registry.setPositionManagerFactory(PMF.address);
      await Registry.setStrategyProviderWalletFactory(SPWF.address);

      await PMF.connect(deployer).updateActionData({
        facetAddress: mintAction.address,
        action: 0,
        functionSelectors: await getSelectors(mintAction),
      });

      await Registry.connect(deployer).setPositionManagerFactory(PMF.address);

      await PMF.connect(deployer).create();

      const deployedContract = await PMF.positionManagers(0);
      const PM = (await ethers.getContractAt("PositionManager", deployedContract)) as PositionManager;

      expect(PM).to.exist;

      const positionManagerAddress = await PMF.positionManagers(0);

      await PMF.updateDiamond(positionManagerAddress, [
        {
          facetAddress: swapToPositionRatioAction.address,
          action: 1,
          functionSelectors: await getSelectors(mintAction),
        },
      ]);
    });

    it("should remove an action from actionData array", async () => {
      await Registry.addNewContract(
        hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("PositionManagerFactory")),
        PMF.address,
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

      await PMF.connect(deployer).create();

      const deployedContract = await PMF.positionManagers(0);
      const PM = (await ethers.getContractAt("PositionManager", deployedContract)) as PositionManager;

      expect(PM).to.exist;
      const oldActionData = await PMF.actions(0);
      await PMF.updateActionData({
        facetAddress: mintAction.address,
        action: 2,
        functionSelectors: await getSelectors(mintAction),
      });
      const newActionData = await PMF.actions(0);

      expect(oldActionData.facetAddress).to.be.not.equal(newActionData.facetAddress);
    });
  });
});
