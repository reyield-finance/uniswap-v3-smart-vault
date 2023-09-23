import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import hre from "hardhat";

import { MockArrayHelper } from "../../types";

describe("Test ArrayHelper", () => {
  //GLOBAL VARIABLE - USE THIS
  let owner: SignerWithAddress;

  //Mock contract MathHelper
  let TestArrayHelper: MockArrayHelper;

  before(async function () {
    owner = (await ethers.getSigners())[0];
    await hre.network.provider.send("hardhat_reset");

    //deploy the contract
    const TestArrayHelperFactory = await ethers.getContractFactory("MockArrayHelper");
    TestArrayHelper = (await TestArrayHelperFactory.deploy()) as MockArrayHelper;
    await TestArrayHelper.deployed();
  });

  describe("ArrayHelper.sol", function () {
    it("Should success sliceUint256", async function () {
      const arr = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n];
      const result = await TestArrayHelper.sliceUint256(arr, 0n, 5n);
      expect(result[0].length).to.equal(5n);
      expect(result[0][0]).to.equal(1n);
      expect(result[0][1]).to.equal(2n);
      expect(result[0][2]).to.equal(3n);
      expect(result[0][3]).to.equal(4n);
      expect(result[0][4]).to.equal(5n);
      expect(result[1]).to.equal(5n);

      const result2 = await TestArrayHelper.sliceUint256(arr, result[1], 12n);
      expect(result2[0].length).to.equal(4n);
      expect(result2[0][0]).to.equal(6n);
      expect(result2[0][1]).to.equal(7n);
      expect(result2[0][2]).to.equal(8n);
      expect(result2[0][3]).to.equal(9n);
      expect(result2[1]).to.equal(9n);
    });

    it("Should success sliceAddress", async function () {
      const arr = [
        "0x8d521dCae9C1f7353a96D1510B3B4F9f83413bC9",
        "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        "0x6BF114C5C8Fb89D1F2553e0F7756E23142bF9960",
        "0xDaC8A8E6DBf8c690ec6815e0fF03491B2770255D",
      ];
      const result = await TestArrayHelper.sliceAddress(arr, 1n, 3n);
      expect(result[0].length).to.equal(3n);
      expect(result[0][0]).to.equal("0x1F98431c8aD98523631AE4a59f267346ea31F984");
      expect(result[0][1]).to.equal("0x6BF114C5C8Fb89D1F2553e0F7756E23142bF9960");
      expect(result[0][2]).to.equal("0xDaC8A8E6DBf8c690ec6815e0fF03491B2770255D");
      expect(result[1]).to.equal(4n);
    });
  });
});
