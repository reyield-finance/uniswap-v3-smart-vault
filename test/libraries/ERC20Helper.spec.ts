import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { MockERC20Helper, MockToken } from "../../types";
import { mintSTDAmount, tokensFixture } from "../shared/fixtures";

describe("ERC20Helper", () => {
  let owner: SignerWithAddress;
  let spender: SignerWithAddress;

  //all the token used globally
  let WETH: MockToken;

  //Mock contract ERC20Helper
  let TestERC20Helper: MockERC20Helper;

  before(async function () {
    owner = (await ethers.getSigners())[0] as SignerWithAddress;
    spender = (await ethers.getSigners())[1] as SignerWithAddress;

    //deploy the token
    WETH = (await tokensFixture("WETH", 18)).tokenFixture;

    //deploy the contract
    const TestERC20HelperFactory = await ethers.getContractFactory("MockERC20Helper");
    TestERC20Helper = (await TestERC20HelperFactory.deploy()) as MockERC20Helper;
    await TestERC20Helper.deployed();
  });

  describe("TestERC20Helper - approveToken", function () {
    it("approves spender to be the spender of owner's tokens", async function () {
      const tokenToApproveAmount = "100000000000000";
      await TestERC20Helper.connect(spender).approveToken(
        WETH.address,
        owner.address,
        ethers.utils.parseEther(tokenToApproveAmount),
      );
      const allowance = await WETH.connect(spender).allowance(TestERC20Helper.address, owner.address);
      expect(allowance.toString()).to.equal(ethers.utils.parseEther(tokenToApproveAmount));
    });

    it("approves spender to be the spender of owners tokens with -1 amount", async function () {
      const tokenToApproveAmount = "-1";
      let errorMessage;
      try {
        await TestERC20Helper.connect(spender).approveToken(
          WETH.address,
          owner.address,
          ethers.utils.parseEther(tokenToApproveAmount),
        );
      } catch (e: any) {
        errorMessage = e.reason;
      }

      expect(errorMessage).to.equal("value out-of-bounds");
    });
  });

  describe("TestERC20Helper - getBalance", function () {
    it("gets balance of owner's token", async function () {
      await mintSTDAmount(WETH);
      const balance = await TestERC20Helper.getBalance(WETH.address, owner.address);
      expect(balance.toString()).to.equal((await WETH.balanceOf(owner.address)).toString());
    });
    it("Should fail to get balance of random's address", async function () {
      let errorMessage;
      try {
        await TestERC20Helper.getBalance(WETH.address, "0x0");
      } catch (e: any) {
        errorMessage = e.reason;
      }

      expect(errorMessage).to.equal("invalid address");
    });
  });

  describe("TestERC20Helper - getAllowance", function () {
    it("gets allowance of owner's token", async function () {
      await mintSTDAmount(WETH);
      await WETH.connect(owner).approve(TestERC20Helper.address, ethers.utils.parseEther("100000000000000"));
      const allowance = await TestERC20Helper.getAllowance(WETH.address, owner.address, spender.address);
      expect(allowance.toString()).to.equal((await WETH.allowance(owner.address, spender.address)).toString());
    });

    it("gets allowance of owner's token with approve amount equal 0", async function () {
      await mintSTDAmount(WETH);
      await WETH.connect(owner).approve(TestERC20Helper.address, ethers.utils.parseEther("0"));
      const allowance = await TestERC20Helper.getAllowance(WETH.address, owner.address, spender.address);
      expect(allowance.toString()).to.equal((await WETH.allowance(owner.address, spender.address)).toString());
    });
  });

  describe("TestERC20Helper - withdrawTokens", function () {
    it("withdraws tokens from owner to ", async function () {
      await mintSTDAmount(WETH);
      await WETH.connect(owner).approve(TestERC20Helper.address, ethers.utils.parseEther("100000000000000"));
      await WETH.connect(owner).transfer(TestERC20Helper.address, "100000000000000");

      const ownerBalanceBefore = await WETH.balanceOf(owner.address);

      await TestERC20Helper.connect(owner).approve(WETH.address, owner.address);

      await TestERC20Helper.connect(owner).withdrawTokens(WETH.address, owner.address, "1");
      const ownerBalanceAfter = await WETH.balanceOf(owner.address);

      expect(ownerBalanceAfter.toString()).to.be.equal(ownerBalanceBefore.add("1").toString());
    });
  });
});
