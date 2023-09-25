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
  ISwapToPositionRatio,
  MockToken,
  MockWETH9,
  PositionManager,
  PositionManagerFactory,
  Registry,
  RegistryAddressHolder,
  StrategyProviderWalletFactory,
} from "../../types";
import { token } from "../../types/@openzeppelin/contracts";
import {
  RegistryAddressHolderFixture,
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

describe("SwapToPositionRatio.sol", function () {
  //GLOBAL VARIABLE - USE THIS

  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let user2: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let serviceFeeRecipient: SignerWithAddress;
  let strategyProvider: SignerWithAddress;
  let registry: Registry;
  let registryAddressHolder: RegistryAddressHolder;

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
      ["SwapToPositionRatio"],
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
      [tokenWETH, tokenUSDC, tokenUSDT, tokenOP],
    );
    //approval nfts
    await nonFungiblePositionManager.setApprovalForAll(positionManager.address, true);
  });

  describe("SwapToPositionRatioAction - swapToPositionRatio", function () {
    it("should swap to position ratio on OP/USDT pair", async function () {
      // give pool some liquidity
      const txMint = await nonFungiblePositionManager.connect(liquidityProvider).mint(
        {
          token0: tokenOP.address < tokenUSDT.address ? tokenOP.address : tokenUSDT.address,
          token1: tokenUSDT.address > tokenOP.address ? tokenUSDT.address : tokenOP.address,
          fee: 500,
          tickLower: 0 - 20,
          tickUpper: 0 + 20,
          amount0Desired: 10000n * 10n ** 18n,
          amount1Desired: 10000n * 10n ** 18n,
          amount0Min: 0,
          amount1Min: 0,
          recipient: liquidityProvider.address,
          deadline: Date.now() + 1000,
        },
        { gasLimit: 670000 },
      );

      await txMint.wait();
      const swapRatio = (await ethers.getContractAt(
        "ISwapToPositionRatio",
        positionManager.address,
      )) as ISwapToPositionRatio;
      const token0 = tokenOP.address < tokenUSDT.address ? tokenOP : tokenUSDT;
      const token1 = tokenOP.address < tokenUSDT.address ? tokenUSDT : tokenOP;
      const amount0In: BigNumber = BigNumber.from(10n * 10n ** 18n);
      const amount1In: BigNumber = BigNumber.from(10n * 10n ** 6n);
      const tickLower = 0n - 100n;
      const tickUpper = 0n + 100n;

      await token0.connect(user).transfer(positionManager.address, amount0In);
      await token1.connect(user).transfer(positionManager.address, amount1In);
      const txSwapRatio = await swapRatio.connect(user).swapToPositionRatio({
        token0Address: token0.address,
        token1Address: token1.address,
        fee: 500,
        amount0In: amount0In,
        amount1In: amount1In,
        tickLower: tickLower,
        tickUpper: tickUpper,
      });
      const receipt = await txSwapRatio.wait();
      const events: any = receipt.events;
      const amount0InLog = events[events.length - 1].args.amount0In;
      const amount1InLog = events[events.length - 1].args.amount1In;
      const amount0Out = events[events.length - 1].args.amount0Out;
      const amount1Out = events[events.length - 1].args.amount1Out;

      expect(amount0InLog).to.be.equal(amount0In);
      expect(amount1InLog).to.be.equal(amount1In);
      let token1SwappedFromToken0: BigNumber = BigNumber.from(0);

      let swappedToken0: BigNumber = BigNumber.from(0);
      let count = 0;
      for (let i = 0; i < events.length; i++) {
        if (events[i].address === poolOPUSDT.address) {
          count++;

          const eventData = parseEventData(events[i].data);

          token1SwappedFromToken0 = token1SwappedFromToken0.add(
            BigNumber.from(0n - hexToInt256(hexToBn(eventData[1]))),
          );
          swappedToken0 = BigNumber.from(hexToInt256(hexToBn(eventData[0])));
          break;
        }
      }
      expect(count).to.be.equal(1);

      expect(token1SwappedFromToken0.add(amount1In)).to.be.equal(amount1Out);
      expect(amount0In.sub(swappedToken0)).to.be.equal(amount0Out);
    });
  });
});
