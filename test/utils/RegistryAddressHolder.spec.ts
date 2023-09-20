import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { MockToken, Registry, RegistryAddressHolder } from "../../types";
import { RegistryAddressHolderFixture, RegistryFixture, tokensFixture, zeroAddress } from "../shared/fixtures";

describe("RegistryAddressHolder.sol", function () {
  //GLOBAL VARIABLE - USE THIS

  let deployer: SignerWithAddress;
  let user: SignerWithAddress;

  let registry: Registry;
  let registry2: Registry;
  let registryAddressHolder: RegistryAddressHolder;

  let tokenWETH: MockToken, tokenUSDC: MockToken;

  beforeEach(async function () {
    //deploy our contracts
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];

    tokenWETH = (await tokensFixture("WETH", 18)).tokenFixture;
    tokenUSDC = (await tokensFixture("USDC", 6)).tokenFixture;

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

    //deploy the registry2
    registry2 = (
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
  });

  describe("RegistryAddressHolder.sol", function () {
    it("should success set address from governance", async function () {
      expect(await registryAddressHolder.registry()).to.be.equal(registry.address);
      registry.supportsInterface;
      await registryAddressHolder.connect(deployer).setRegistryAddress(registry2.address);
      expect(await registryAddressHolder.registry()).to.be.equal(registry2.address);
    });

    it("should fail set address with non-registry interface block by erc156 checker", async function () {
      await expect(registryAddressHolder.connect(deployer).setRegistryAddress(user.address)).to.be.revertedWith(
        "RAHERC165",
      );
      await expect(registryAddressHolder.connect(deployer).setRegistryAddress(zeroAddress)).to.be.revertedWith(
        "RAHERC165",
      );
    });

    it("should fail set address from non-governance", async function () {
      await expect(registryAddressHolder.connect(user).setRegistryAddress(registry2.address)).to.be.revertedWith(
        "RAHOG",
      );
    });
  });
});
