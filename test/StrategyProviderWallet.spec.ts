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
  RegistryAddressHolder,
  StrategyProviderWallet,
  StrategyProviderWalletFactory,
  SwapToPositionRatio,
  UniswapAddressHolder,
} from "../types";
import {
  RegistryAddressHolderFixture,
  RegistryFixture,
  deployContract,
  deployUniswapContracts,
  getSelectors,
  poolFixture,
  tokensFixture,
  zeroAddress,
} from "./shared/fixtures";

describe("StrategyProviderWallet.sol", function () {
  let deployer: Signer;
  let user: Signer;
  let serviceFeeRecipient: Signer;
  let usdValueTokenAddress: MockToken;
  let weth: MockToken;
  let Registry: Registry;
  let registryAddressHolder: RegistryAddressHolder;
  let token0: MockToken;
  let token1: MockToken;
  let token2: MockToken;
  let token3: MockToken;
  let PMF: PositionManagerFactory;
  let SPWF: StrategyProviderWalletFactory;
  let SPW: StrategyProviderWallet;
  let DCF: DiamondCutFacet;
  let UAH: UniswapAddressHolder;
  let mintAction: Mint;
  let swapToPositionRatioAction: SwapToPositionRatio;
  let uniswapV3Factory: IUniswapV3Factory;
  let poolToken0Token1: IUniswapV3Pool,
    poolToken0Token2: IUniswapV3Pool,
    poolToken1Token2: IUniswapV3Pool,
    poolToken1Token3: IUniswapV3Pool,
    poolToken0UsdValue: IUniswapV3Pool,
    poolToken1UsdValue: IUniswapV3Pool,
    poolToken2UsdValue: IUniswapV3Pool;

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
    registryAddressHolder = (await RegistryAddressHolderFixture(Registry.address)).registryAddressHolderFixture;

    token0 = (await tokensFixture("ETH", 18)).tokenFixture;
    token1 = (await tokensFixture("USDC", 6)).tokenFixture;
    token2 = (await tokensFixture("USDT", 6)).tokenFixture;
    token3 = (await tokensFixture("DAI", 18)).tokenFixture;

    //deploy factory, used for pools
    const [uniswapFactory, nonFungiblePositionManager, swapRouter] = await deployUniswapContracts(token0);
    UAH = (await deployContract("UniswapAddressHolder", [
      registryAddressHolder.address,
      nonFungiblePositionManager.address,
      uniswapFactory.address,
      swapRouter.address,
    ])) as UniswapAddressHolder;
    uniswapV3Factory = uniswapFactory as IUniswapV3Factory;

    await token0.mint(await user.getAddress(), ethers.utils.parseEther("1000000000000"));
    await token1.mint(await user.getAddress(), ethers.utils.parseEther("1000000000000"));
    await token2.mint(await user.getAddress(), ethers.utils.parseEther("1000000000000"));
    await token3.mint(await user.getAddress(), ethers.utils.parseEther("1000000000000"));

    poolToken0Token1 = (await poolFixture(token0, token1, 500, uniswapV3Factory, 0)).pool;
    poolToken0Token2 = (await poolFixture(token0, token2, 500, uniswapV3Factory, 0)).pool;
    poolToken1Token2 = (await poolFixture(token1, token2, 500, uniswapV3Factory, 0)).pool;
    poolToken1Token3 = (await poolFixture(token1, token3, 500, uniswapV3Factory, 0)).pool;
    poolToken0UsdValue = (await poolFixture(token0, usdValueTokenAddress, 500, uniswapV3Factory, 0)).pool;
    poolToken1UsdValue = (await poolFixture(token1, usdValueTokenAddress, 500, uniswapV3Factory, 0)).pool;
    poolToken2UsdValue = (await poolFixture(token2, usdValueTokenAddress, 500, uniswapV3Factory, 0)).pool;

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
    PMF = (await positionManagerFactory.deploy(
      registryAddressHolder.address,
      UAH.address,
      DCF.address,
    )) as PositionManagerFactory;
    await PMF.deployed();
    const strategyProviderWalletFactory = await ethers.getContractFactory("StrategyProviderWalletFactory");
    SPWF = (await strategyProviderWalletFactory.deploy(
      registryAddressHolder.address,
      UAH.address,
    )) as StrategyProviderWalletFactory;
    await SPWF.deployed();

    await SPWF.connect(deployer).addCreatorWhitelist(PMF.address);

    await createStrategyProviderWallet();
  });

  describe("StrategyProviderWalletFactory - create", function () {
    it("Should all set the variables in constructor", async () => {
      expect(await SPW.registryAddressHolder()).to.be.equal(registryAddressHolder.address);
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
        0,
        "3",
      );
      const sInfo = await SPW.getStrategyInfo(ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16));
      const poolAddress = await uniswapV3Factory.getPool(token0.address, token1.address, 500);
      expect(sInfo[0]).to.be.equal(poolAddress);
      expect(sInfo[1]).to.be.equal(2000);
      expect(sInfo[2]).to.be.equal(0);
      expect(sInfo[3]).to.be.equal(3);

      const { wallets } = await SPWF.getStrategyProviderWallets(0, 30);
      expect(wallets.length).to.be.equal(1);
      expect(wallets[0]).to.be.equal(SPW.address);
    });

    it("Should success add strategy by official account with arbitrary performanceFeeRatio", async () => {
      await Registry.setOfficialAccount(await user.getAddress());
      await SPW.connect(user).addStrategy(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
        token0.address,
        token1.address,
        "500",
        "10000",
        0,
        "3",
      );
    });

    it("Should fail add strategy by non-official account with arbitrary performanceFeeRatio", async () => {
      await expect(
        SPW.connect(user).addStrategy(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
          token0.address,
          token1.address,
          "500",
          "10000",
          0,
          "3",
        ),
      ).to.be.revertedWith("SPWPFR");
    });

    it("Should fail add strategy with invalid received token type", async () => {
      await expect(
        SPW.connect(user).addStrategy(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
          token0.address,
          token1.address,
          "500",
          "2000",
          3,
          "3",
        ),
      ).to.be.revertedWithoutReason;
    });

    it("Should fail add strategy with invalid input", async () => {
      await SPW.connect(user).addStrategy(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
        token0.address,
        token1.address,
        "500",
        "2000",
        2,
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
          0,
          "3",
        ),
      ).to.be.revertedWith("SPWSE");

      await expect(
        SPW.connect(user).addStrategy(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16),
          token2.address,
          weth.address,
          "500",
          "2000",
          0,
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
          2,
          "3",
        ),
      ).to.be.revertedWith("SPWAP0");
      await expect(
        SPW.connect(user).addStrategy(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16),
          token0.address,
          token1.address,
          "500",
          "8000",
          2,
          "3",
        ),
      ).to.be.revertedWith("SPWPFR");
      await expect(
        SPW.connect(user).addStrategy(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16),
          token0.address,
          token1.address,
          "500",
          "2000",
          2,
          "0",
        ),
      ).to.be.revertedWith("SPWLA");

      await expect(
        SPW.connect(user).addStrategy(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(5), 16),
          token1.address,
          token3.address,
          "500",
          "2000",
          0,
          "3",
        ),
      ).to.be.revertedWith("SPWCPV");
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
        2,
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
        2,
        "3",
      );

      await SPW.connect(user).collectAll(await user.getAddress());
      expect(await token0.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));
      expect(await token1.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));
      expect(await token2.balanceOf(await user.getAddress())).to.be.equal(ethers.utils.parseEther("1000000000000"));

      const { tokens } = await SPW.connect(user).getReceivedTokens(0, 3);
      expect(tokens.length).to.be.equal(3);

      expect(tokens).to.include(token0.address);
      expect(tokens).to.include(token1.address);
      expect(tokens).to.include(token2.address);

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
        2,
        "3",
      );

      await SPW.connect(user).updateStrategyReceivedTokenType(ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16), 1);

      const sInfo = await SPW.getStrategyInfo(ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16));
      const poolAddress = await uniswapV3Factory.getPool(token0.address, token1.address, 500);
      expect(sInfo[0]).to.be.equal(poolAddress);
      expect(sInfo[1]).to.be.equal(2000);
      expect(sInfo[2]).to.be.equal(1);
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
          0,
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
        2,
        "3",
      );
      await SPW.connect(user).addStrategy(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16),
        token1.address,
        token2.address,
        "500",
        "2000",
        2,
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
        2,
        "3",
      );

      await expect(
        SPW.connect(deployer).updateStrategyReceivedTokenType(ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16), 1),
      ).to.be.revertedWith("SPWOO");
    });

    it("Should fail update strategy with invalid receivedTokenType", async () => {
      await SPW.connect(user).addStrategy(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16),
        token0.address,
        token1.address,
        "500",
        "2000",
        2,
        "3",
      );

      await expect(
        SPW.connect(user).updateStrategyReceivedTokenType(ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16), 3),
      ).to.be.revertedWithoutReason;
    });
  });
});
