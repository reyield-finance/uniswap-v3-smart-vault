import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import hre from "hardhat";

import { MockMathHelper } from "../../types";

describe("Test MathHelper", () => {
  //GLOBAL VARIABLE - USE THIS
  let owner: SignerWithAddress;

  //Mock contract MathHelper
  let TestMathHelper: MockMathHelper;

  before(async function () {
    owner = (await ethers.getSigners())[0];
    await hre.network.provider.send("hardhat_reset");

    //deploy the contract
    const TestMathHelperFactory = await ethers.getContractFactory("MockMathHelper");
    TestMathHelper = (await TestMathHelperFactory.deploy()) as MockMathHelper;
    await TestMathHelper.deployed();
  });

  describe("MathHelper.sol", function () {
    it("Should cast int56 to int24", async function () {
      const result = await TestMathHelper.connect(owner).fromInt56ToInt24(-5069);
      expect(result).to.equal(-5069);
    });

    it("should cast uint256 to uint128", async function () {
      const result = await TestMathHelper.connect(owner).fromUint256ToUint128(1506945567784553);
      expect(result).to.equal(1506945567784553);
    });

    it("should overflow uint256 to uint128", async function () {
      await expect(TestMathHelper.connect(owner).fromUint256ToUint128(2n ** 160n)).to.be.revertedWith("MH2");
    });
  });
});
