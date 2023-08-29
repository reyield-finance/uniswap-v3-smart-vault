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
  IReturnProfit,
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

describe("ReturnProfit.sol", function () {
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
      ["ReturnProfit"],
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

  describe("ReturnProfitAction - returnProfit", function () {
    it("should received all token0 profit to user for OP/USDT pair", async function () {
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

      const returnProfit = (await ethers.getContractAt("IReturnProfit", positionManager.address)) as IReturnProfit;
      let amount0Desired: bigint = 3n * 10n ** 18n;
      let amount1Desired: bigint = 100n * 10n ** 6n;

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenOP, tokenUSDT);
      [amount0Desired, amount1Desired] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      const token0BalanceBefore = await token0.balanceOf(user.address);
      const token1BalanceBefore = await token1.balanceOf(user.address);

      await token0.connect(user).transfer(positionManager.address, amount0Desired);
      await token1.connect(user).transfer(positionManager.address, amount1Desired);

      const txReturn = await returnProfit.connect(user).returnProfit({
        token0: token0.address,
        token1: token1.address,
        returnedToken: token0.address,
        amount0: amount0Desired,
        amount1: amount1Desired,
      });

      const receipt = await txReturn.wait();
      const events: any = receipt.events;
      const amount0Returned = events[events.length - 1].args.returnedAmount0;
      const amount1Returned = events[events.length - 1].args.returnedAmount1;
      expect(amount1Returned).to.be.equal(0);
      let token0SwappedFromToken1: bigint = 0n;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolOPUSDT.address) {
          const eventData = parseEventData(events[i].data);
          token0SwappedFromToken1 += 0n - hexToInt256(hexToBn(eventData[0]));
          expect(amount1Desired).to.be.equal(BigNumber.from(hexToInt256(hexToBn(eventData[1]))));
        }
      }

      expect(amount0Returned).to.be.equal(BigNumber.from(token0SwappedFromToken1).add(amount0Desired));

      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);
      expect(await token0.balanceOf(user.address)).to.equal(token0BalanceBefore.add(token0SwappedFromToken1));
      expect(await token1.balanceOf(user.address)).to.equal(token1BalanceBefore.sub(amount1Desired));
    });

    it("should received all token1 profit to user for OP/USDT pair", async function () {
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

      const returnProfit = (await ethers.getContractAt("IReturnProfit", positionManager.address)) as IReturnProfit;
      let amount0Desired: bigint = 3n * 10n ** 18n;
      let amount1Desired: bigint = 100n * 10n ** 6n;

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenOP, tokenUSDT);
      [amount0Desired, amount1Desired] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      const token0BalanceBefore = await token0.balanceOf(user.address);
      const token1BalanceBefore = await token1.balanceOf(user.address);

      await token0.connect(user).transfer(positionManager.address, amount0Desired);
      await token1.connect(user).transfer(positionManager.address, amount1Desired);

      const txReturn = await returnProfit.connect(user).returnProfit({
        token0: token0.address,
        token1: token1.address,
        returnedToken: token1.address,
        amount0: amount0Desired,
        amount1: amount1Desired,
      });

      const receipt = await txReturn.wait();
      const events: any = receipt.events;
      const amount0Returned = events[events.length - 1].args.returnedAmount0;
      const amount1Returned = events[events.length - 1].args.returnedAmount1;
      expect(amount0Returned).to.be.equal(0);
      let token1SwappedFromToken0: bigint = 0n;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolOPUSDT.address) {
          const eventData = parseEventData(events[i].data);
          token1SwappedFromToken0 += 0n - hexToInt256(hexToBn(eventData[1]));
          expect(amount0Desired).to.be.equal(BigNumber.from(hexToInt256(hexToBn(eventData[0]))));
        }
      }

      expect(amount1Returned).to.be.equal(BigNumber.from(token1SwappedFromToken0).add(amount1Desired));

      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);
      expect(await token0.balanceOf(user.address)).to.equal(token0BalanceBefore.sub(amount0Desired));
      expect(await token1.balanceOf(user.address)).to.equal(token1BalanceBefore.add(token1SwappedFromToken0));
    });

    it("should received token0 & token1 profit to user for OP/USDT pair", async function () {
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

      const returnProfit = (await ethers.getContractAt("IReturnProfit", positionManager.address)) as IReturnProfit;
      let amount0Desired: bigint = 3n * 10n ** 18n;
      let amount1Desired: bigint = 100n * 10n ** 6n;

      const [token0, token1, isOrderChanged] = getToken0Token1(tokenOP, tokenUSDT);
      [amount0Desired, amount1Desired] = isOrderChanged
        ? [amount1Desired, amount0Desired]
        : [amount0Desired, amount1Desired];

      const token0BalanceBefore = await token0.balanceOf(user.address);
      const token1BalanceBefore = await token1.balanceOf(user.address);

      await token0.connect(user).transfer(positionManager.address, amount0Desired);
      await token1.connect(user).transfer(positionManager.address, amount1Desired);

      const txReturn = await returnProfit.connect(user).returnProfit({
        token0: token0.address,
        token1: token1.address,
        returnedToken: "0x0000000000000000000000000000000000000000",
        amount0: amount0Desired,
        amount1: amount1Desired,
      });

      const receipt = await txReturn.wait();
      const events: any = receipt.events;
      const amount0Returned = events[events.length - 1].args.returnedAmount0;
      const amount1Returned = events[events.length - 1].args.returnedAmount1;

      expect(amount0Returned).to.be.equal(BigNumber.from(amount0Desired));
      expect(amount1Returned).to.be.equal(BigNumber.from(amount1Desired));
      expect(await token0.balanceOf(positionManager.address)).to.equal(0);
      expect(await token1.balanceOf(positionManager.address)).to.equal(0);
      expect(await token0.balanceOf(user.address)).to.equal(token0BalanceBefore);
      expect(await token1.balanceOf(user.address)).to.equal(token1BalanceBefore);
    });
  });
});
