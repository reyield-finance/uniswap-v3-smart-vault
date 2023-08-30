import { reset } from "@nomicfoundation/hardhat-network-helpers";
import "@nomiclabs/hardhat-ethers";
import { expect } from "chai";
import { Signer } from "ethers";
import { ethers } from "hardhat";
import hre from "hardhat";

// import PositionManagerContract from "../artifacts/contracts/PositionManager.sol/PositionManager.json";
import {
  DiamondCutFacet,
  IUniswapV3Factory,
  Mint,
  MockToken,
  PositionManagerFactory,
  Registry,
  StrategyProviderWallet,
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
} from "./shared/fixtures";

describe("StrategyProviderWallet.sol", function () {
  let deployer: Signer;
  let user: Signer;
  let serviceFeeRecipient: Signer;
  let usdValueTokenAddress: MockToken;
  let weth: MockToken;
  let Registry: Registry;
  let token0: MockToken;
  let token1: MockToken;
  let token2: MockToken;
  let PMF: PositionManagerFactory;
  let SPWF: StrategyProviderWalletFactory;
  let SPW: StrategyProviderWallet;
  let DCF: DiamondCutFacet;
  let UAH: UniswapAddressHolder;
  let mintAction: Mint;
  let swapToPositionRatioAction: SwapToPositionRatio;
  let uniswapV3Factory: IUniswapV3Factory;

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

  async function createStrategyProviderWallet() {
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

    await PMF.connect(user).create();

    const strategyProviderWalletAddress = await SPWF.providerToWallet(await user.getAddress());

    SPW = (await ethers.getContractAt(
      "StrategyProviderWallet",
      strategyProviderWalletAddress,
    )) as StrategyProviderWallet;

    expect(SPW).to.exist;
  }

  before(async function () {
    await reset(process.env.ALCHEMY_OPTIMISM_MAINNET, 107735214);
  });

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];
    serviceFeeRecipient = signers[2];

    await deployRegistry();

    token0 = (await tokensFixture("ETH", 18)).tokenFixture;
    token1 = (await tokensFixture("USDC", 6)).tokenFixture;
    token2 = (await tokensFixture("USDT", 6)).tokenFixture;

    //deploy factory, used for pools
    const [uniswapFactory, nonFungiblePositionManager, swapRouter] = await deployUniswapContracts(token0);
    UAH = (await deployContract("UniswapAddressHolder", [
      nonFungiblePositionManager.address,
      uniswapFactory.address,
      swapRouter.address,
      Registry.address,
    ])) as UniswapAddressHolder;
    uniswapV3Factory = uniswapFactory as IUniswapV3Factory;
    await uniswapV3Factory.connect(deployer).createPool(token0.address, token1.address, 500);
    await uniswapV3Factory.connect(deployer).createPool(token1.address, token2.address, 500);

    await token0.mint(await user.getAddress(), ethers.utils.parseEther("1000000000000"));
    await token1.mint(await user.getAddress(), ethers.utils.parseEther("1000000000000"));
    await token2.mint(await user.getAddress(), ethers.utils.parseEther("1000000000000"));

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

    await createStrategyProviderWallet();
  });

  describe("StrategyProviderWalletFactory - create", function () {
    it("Should all set the variables in constructor", async () => {
      expect(await SPW.registry()).to.be.equal(Registry.address);
      expect(await SPW.uniswapAddressHolder()).to.be.equal(UAH.address);
      expect(await SPW.owner()).to.be.equal(await user.getAddress());
    });

    it("Should success add strategy by owner", async () => {
      await SPW.connect(user).addStrategy(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
        token0.address,
        token1.address,
        "500",
        "2000",
        token0.address,
        "3",
      );
      const sInfo = await SPW.getStrategyInfo(ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16));
      const poolAddress = await uniswapV3Factory.getPool(token0.address, token1.address, 500);
      expect(sInfo[0]).to.be.equal(poolAddress);
      expect(sInfo[1]).to.be.equal(2000);
      expect(sInfo[2]).to.be.equal(token0.address);
      expect(sInfo[3]).to.be.equal(3);

      const { wallets } = await SPWF.getStrategyProviderWallets(0, 30);
      expect(wallets.length).to.be.equal(1);
      expect(wallets[0]).to.be.equal(SPW.address);
    });

    it("Should fail add strategy with invalid input", async () => {
      await SPW.connect(user).addStrategy(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
        token0.address,
        token1.address,
        "500",
        "2000",
        "0x0000000000000000000000000000000000000000",
        "3",
      );

      // same strategy Id error
      await expect(
        SPW.connect(user).addStrategy(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
          token0.address,
          token1.address,
          "500",
          "2000",
          token0.address,
          "3",
        ),
      ).to.be.revertedWith("SPWSE");

      await expect(
        SPW.connect(user).addStrategy(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16),
          token2.address,
          token0.address,
          "500",
          "2000",
          token2.address,
          "3",
        ),
      ).to.be.revertedWith("SPWAP0");
      await expect(
        SPW.connect(user).addStrategy(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16),
          token0.address,
          token1.address,
          "100",
          "2000",
          "0x0000000000000000000000000000000000000000",
          "3",
        ),
      ).to.be.revertedWith("SPWAP0");
      await expect(
        SPW.connect(user).addStrategy(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16),
          token0.address,
          token1.address,
          "500",
          "10001",
          "0x0000000000000000000000000000000000000000",
          "3",
        ),
      ).to.be.revertedWith("SPWPFR");
      await expect(
        SPW.connect(user).addStrategy(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16),
          token0.address,
          token1.address,
          "500",
          "10000",
          "0x0000000000000000000000000000000000000000",
          "0",
        ),
      ).to.be.revertedWith("SPWLA");
    });

    it("Should success collect token", async () => {
      expect(await token0.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));
      expect(await token1.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));
      expect(await token2.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));

      await token0.connect(user).transfer(SPW.address, ethers.utils.parseEther("1000000000000"));
      await token1.connect(user).transfer(SPW.address, ethers.utils.parseEther("1000000000000"));
      await token2.connect(user).transfer(SPW.address, ethers.utils.parseEther("1000000000000"));

      expect(await token0.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("0"));
      expect(await token1.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("0"));
      expect(await token2.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("0"));

      await SPW.connect(user).collectFromToken(
        token0.address,
        ethers.utils.parseEther("1000000000000"),
        await user.getAddress(),
      );

      expect(await token0.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));
      expect(await token1.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("0"));
      expect(await token2.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("0"));

      await SPW.connect(user).collectAll(await user.getAddress());
      expect(await token0.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));
      expect(await token1.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("0"));
      expect(await token2.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("0"));

      await SPW.connect(user).addStrategy(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
        token0.address,
        token1.address,
        "500",
        "2000",
        "0x0000000000000000000000000000000000000000",
        "3",
      );
      await SPW.connect(user).collectAll(await user.getAddress());
      expect(await token0.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));
      expect(await token1.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));
      expect(await token2.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("0"));

      await SPW.connect(user).addStrategy(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16),
        token1.address,
        token2.address,
        "500",
        "2000",
        "0x0000000000000000000000000000000000000000",
        "3",
      );

      await SPW.connect(user).collectAll(await user.getAddress());
      expect(await token0.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));
      expect(await token1.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));
      expect(await token2.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));

      const { tokens } = await SPW.connect(user).getReceivedTokens(0, 3);
      expect(tokens.length).to.be.equal(3);
      expect(tokens[0]).to.be.equal(token0.address);
      expect(tokens[1]).to.be.equal(token1.address);
      expect(tokens[2]).to.be.equal(token2.address);

      await token0.connect(user).transfer(SPW.address, ethers.utils.parseEther("1000000000000"));
      await token1.connect(user).transfer(SPW.address, ethers.utils.parseEther("1000000000000"));
      await token2.connect(user).transfer(SPW.address, ethers.utils.parseEther("1000000000000"));

      expect(await token0.balanceOf(SPW.address)).to.be.equal(ethers.utils.parseEther("1000000000000"));
      expect(await token1.balanceOf(SPW.address)).to.be.equal(ethers.utils.parseEther("1000000000000"));
      expect(await token2.balanceOf(SPW.address)).to.be.equal(ethers.utils.parseEther("1000000000000"));
      await SPW.connect(user).collectFromStrategy(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16),
        await user.getAddress(),
      );

      expect(await token0.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("0"));
      expect(await token1.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));
      expect(await token2.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));
    });

    it("Should success update strategy by owner", async () => {
      await SPW.connect(user).addStrategy(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
        token0.address,
        token1.address,
        "500",
        "2000",
        "0x0000000000000000000000000000000000000000",
        "3",
      );

      await SPW.connect(user).updateStrategyReceivedToken(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
        token1.address,
      );

      const sInfo = await SPW.getStrategyInfo(ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16));
      const poolAddress = await uniswapV3Factory.getPool(token0.address, token1.address, 500);
      expect(sInfo[0]).to.be.equal(poolAddress);
      expect(sInfo[1]).to.be.equal(2000);
      expect(sInfo[2]).to.be.equal(token1.address);
      expect(sInfo[3]).to.be.equal(3);
    });

    it("Should fail add strategy by others not owner", async () => {
      await expect(
        SPW.connect(deployer).addStrategy(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
          token0.address,
          token1.address,
          "500",
          "2000",
          token0.address,
          "3",
        ),
      ).to.be.revertedWith("SPWOO");
    });

    it("Should fail collect by others not owner", async () => {
      await SPW.connect(user).addStrategy(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
        token0.address,
        token1.address,
        "500",
        "2000",
        "0x0000000000000000000000000000000000000000",
        "3",
      );
      await SPW.connect(user).addStrategy(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16),
        token1.address,
        token2.address,
        "500",
        "2000",
        "0x0000000000000000000000000000000000000000",
        "3",
      );

      await token0.connect(user).transfer(SPW.address, ethers.utils.parseEther("1000000000000"));
      await token1.connect(user).transfer(SPW.address, ethers.utils.parseEther("1000000000000"));
      await token2.connect(user).transfer(SPW.address, ethers.utils.parseEther("1000000000000"));

      await expect(
        SPW.connect(deployer).collectFromToken(
          token0.address,
          ethers.utils.parseEther("1000000000000"),
          await user.getAddress(),
        ),
      ).to.be.revertedWith("SPWOO");

      await expect(SPW.connect(deployer).collectAll(await user.getAddress())).to.be.revertedWith("SPWOO");

      await expect(
        SPW.connect(deployer).collectFromStrategy(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16),
          await user.getAddress(),
        ),
      ).to.be.revertedWith("SPWOO");
    });

    it("Should fail update strategy by others not owner", async () => {
      await SPW.connect(user).addStrategy(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
        token0.address,
        token1.address,
        "500",
        "2000",
        "0x0000000000000000000000000000000000000000",
        "3",
      );

      await expect(
        SPW.connect(deployer).updateStrategyReceivedToken(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
          token1.address,
        ),
      ).to.be.revertedWith("SPWOO");
    });
  });
});
