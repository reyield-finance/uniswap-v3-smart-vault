import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract } from "ethers";
import { ethers } from "hardhat";

import {
  INonfungiblePositionManager,
  ISwapRouter,
  MockToken,
  Registry,
  RegistryAddressHolder,
  UniswapAddressHolder,
} from "../../types";
import {
  RegistryAddressHolderFixture,
  RegistryFixture,
  deployContract,
  deployUniswapContracts,
  tokensFixture,
} from "../shared/fixtures";

describe("UniswapAddressHolder.sol", function () {
  //GLOBAL VARIABLE - USE THIS

  let deployer: SignerWithAddress;
  let user: SignerWithAddress;

  let registry: Registry;
  let registryAddressHolder: RegistryAddressHolder;
  let uniswapAddressHolder: UniswapAddressHolder;

  let tokenWETH: MockToken, tokenUSDC: MockToken;

  let uniswapV3Factory: Contract; // the factory that will deploy all pools
  let nonFungiblePositionManager: INonfungiblePositionManager; // NonFungiblePositionManager contract by UniswapV3
  let swapRouter: ISwapRouter;

  beforeEach(async function () {
    //deploy our contracts
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];

    tokenWETH = (await tokensFixture("WETH", 18)).tokenFixture;
    tokenUSDC = (await tokensFixture("USDC", 6)).tokenFixture;

    //deploy uniswap contracts needed
    [uniswapV3Factory, nonFungiblePositionManager, swapRouter] = await deployUniswapContracts(tokenWETH);

    //deploy the registry
    registry = (
      await RegistryFixture(
        await deployer.getAddress(),
        await deployer.getAddress(),
        500,
        0,
        tokenUSDC.address,
        tokenWETH.address,
      )
    ).registryFixture;
    registryAddressHolder = (await RegistryAddressHolderFixture(registry.address)).registryAddressHolderFixture;

    uniswapAddressHolder = (await deployContract("UniswapAddressHolder", [
      registryAddressHolder.address,
      nonFungiblePositionManager.address,
      uniswapV3Factory.address,
      swapRouter.address,
    ])) as UniswapAddressHolder;
  });

  describe("UniswapAddressHolder.sol", function () {
    it("should success set address from governance", async function () {
      expect(await uniswapAddressHolder.uniswapV3FactoryAddress()).to.be.equal(uniswapV3Factory.address);
      await uniswapAddressHolder.connect(deployer).setFactoryAddress(swapRouter.address);
      expect(await uniswapAddressHolder.uniswapV3FactoryAddress()).to.be.equal(swapRouter.address);

      expect(await uniswapAddressHolder.nonfungiblePositionManagerAddress()).to.be.equal(
        nonFungiblePositionManager.address,
      );
      await uniswapAddressHolder.connect(deployer).setNonFungibleAddress(swapRouter.address);
      expect(await uniswapAddressHolder.nonfungiblePositionManagerAddress()).to.be.equal(swapRouter.address);

      expect(await uniswapAddressHolder.swapRouterAddress()).to.be.equal(swapRouter.address);
      await uniswapAddressHolder.connect(deployer).setSwapRouterAddress(uniswapV3Factory.address);
      expect(await uniswapAddressHolder.swapRouterAddress()).to.be.equal(uniswapV3Factory.address);
    });

    it("should fail set address from non-governance", async function () {
      await expect(uniswapAddressHolder.connect(user).setFactoryAddress(swapRouter.address)).to.be.revertedWith(
        "UAHOG",
      );

      await expect(uniswapAddressHolder.connect(user).setNonFungibleAddress(swapRouter.address)).to.be.revertedWith(
        "UAHOG",
      );

      await expect(
        uniswapAddressHolder.connect(user).setSwapRouterAddress(uniswapV3Factory.address),
      ).to.be.revertedWith("UAHOG");
    });
  });
});
