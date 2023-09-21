import "@nomiclabs/hardhat-ethers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { MockUniswapHelper } from "../../types";

describe("UniswapHelper.sol", function () {
  //GLOBAL VARIABLE - USE THIS

  let UniswapHelper: MockUniswapHelper;
  const FactoryAddress: string = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
  const NFTManager: string = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

  before(async function () {
    const MockUniswapHelperFactory = await ethers.getContractFactory("MockUniswapHelper");
    UniswapHelper = (await MockUniswapHelperFactory.deploy()) as MockUniswapHelper;
    await UniswapHelper.deployed();
  });

  describe("getPool", function () {
    it("should success get pool", async function () {
      const token0 = "0x4200000000000000000000000000000000000006";
      const token1 = "0x4200000000000000000000000000000000000042";
      const fee = 3000n;
      const pool = await UniswapHelper.getPool(FactoryAddress, token0, token1, fee);
      expect(pool).to.equal("0x68F5C0A2DE713a54991E01858Fd27a3832401849");
    });

    it("should fail if pool not exist", async function () {
      const token0 = "0x7f5c764cbc14f9669b88837ca1490cca17c31607";
      const token1 = "0xb0b195aefa3650a6908f15cdac7d92f8a5791b0b";
      const fee = 10000n;
      await expect(UniswapHelper.getPool(FactoryAddress, token0, token1, fee)).to.be.revertedWith("UHP0");
    });
  });

  describe("getTokens", function () {
    it("should success get tokens", async function () {
      const { token0address, token1address, fee, tickLower, tickUpper } = await UniswapHelper.getTokens(
        373783,
        NFTManager,
      );
      expect(token0address).to.equal("0x4200000000000000000000000000000000000042");
      expect(token1address).to.equal("0x68f180fcCe6836688e9084f035309E29Bf0A2095");
      expect(fee).to.equal(3000);
      expect(tickLower).to.equal(-327360n);
      expect(tickUpper).to.equal(-324000n);
    });

    it("should fail if token not exist", async function () {
      await expect(UniswapHelper.getTokens(10000000000, NFTManager)).to.be.reverted;
    });
  });

  describe("reorderTokens", function () {
    it("should change the order reorder tokens", async function () {
      const _token0 = "0xb0b195aefa3650a6908f15cdac7d92f8a5791b0b";
      const _token1 = "0x7f5c764cbc14f9669b88837ca1490cca17c31607";
      const { token0, token1, isOrderChanged } = await UniswapHelper._reorderTokens(_token0, _token1);
      expect(token0.toLowerCase()).to.equal(_token1.toLowerCase());
      expect(token1.toLowerCase()).to.equal(_token0.toLowerCase());
      expect(isOrderChanged).to.equal(true);
    });

    it("should not change the order reorder tokens", async function () {
      const _token0 = "0x7f5c764cbc14f9669b88837ca1490cca17c31607";
      const _token1 = "0xb0b195aefa3650a6908f15cdac7d92f8a5791b0b";
      const { token0, token1, isOrderChanged } = await UniswapHelper._reorderTokens(_token0, _token1);
      expect(token0.toLowerCase()).to.equal(_token0.toLowerCase());
      expect(token1.toLowerCase()).to.equal(_token1.toLowerCase());
      expect(isOrderChanged).to.equal(false);
    });
  });

  describe("calLiquidityAndAmounts", function () {
    it("should success calculate liquidity and amounts", async function () {
      const token0 = "0x7f5c764cbc14f9669b88837ca1490cca17c31607";
      const token1 = "0xb0b195aefa3650a6908f15cdac7d92f8a5791b0b";
      const fee = 100n;
      const tickLower = 276229n;
      const tickUpper = 276429n;
      const amount0Desired = 20n * 10n ** 6n;
      const amount1Desired = 1n * 10n ** 18n;
      const result = await UniswapHelper.calLiquidityAndAmounts(
        FactoryAddress,
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
      );
      expect(result.amount0).to.lessThanOrEqual(amount0Desired);
      expect(result.amount1).to.lessThanOrEqual(amount1Desired);
    });

    it("should success calculate liquidity and amounts", async function () {
      const token0 = "0x7f5c764cbc14f9669b88837ca1490cca17c31607";
      const token1 = "0xb0b195aefa3650a6908f15cdac7d92f8a5791b0b";
      const fee = 100n;
      const tickLower = 276429n;
      const tickUpper = 276529n;
      const amount0Desired = 20n * 10n ** 6n;
      const amount1Desired = 1n * 10n ** 18n;
      const result = await UniswapHelper.calLiquidityAndAmounts(
        FactoryAddress,
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
      );
      expect(result.amount0).to.lessThanOrEqual(amount0Desired);
      expect(result.amount1).to.equal(0);
    });

    it("should success calculate liquidity and amounts", async function () {
      const token0 = "0x7f5c764cbc14f9669b88837ca1490cca17c31607";
      const token1 = "0xb0b195aefa3650a6908f15cdac7d92f8a5791b0b";
      const fee = 100n;
      const tickLower = 276129n;
      const tickUpper = 276229n;
      const amount0Desired = 20n * 10n ** 6n;
      const amount1Desired = 1n * 10n ** 18n;
      const result = await UniswapHelper.calLiquidityAndAmounts(
        FactoryAddress,
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
      );
      expect(result.amount0).to.equal(0);
      expect(result.amount1).to.lessThanOrEqual(amount1Desired);
    });
  });

  describe("isPoolExist", function () {
    it("should return true when check existent pool", async function () {
      // USDC/BOB
      const token0 = "0x7f5c764cbc14f9669b88837ca1490cca17c31607";
      const token1 = "0xb0b195aefa3650a6908f15cdac7d92f8a5791b0b";
      const feeTiers = [100n, 500n, 3000n, 10000n];
      const result = await UniswapHelper.isPoolExist(FactoryAddress, token0, token1, feeTiers);
      expect(result).to.equal(true);
    });

    it("should return true when check with opposite tokens ordering but existent pool", async function () {
      // USDC/BOB
      const token0 = "0xb0b195aefa3650a6908f15cdac7d92f8a5791b0b";
      const token1 = "0x7f5c764cbc14f9669b88837ca1490cca17c31607";
      const feeTiers = [100n, 500n, 3000n, 10000n];
      const result = await UniswapHelper.isPoolExist(FactoryAddress, token0, token1, feeTiers);
      expect(result).to.equal(true);
    });

    it("should return false when check non-existent pool", async function () {
      // PERP/BOB
      const token0 = "0x9e1028f5f1d5ede59748ffcee5532509976840e0";
      const token1 = "0xb0b195aefa3650a6908f15cdac7d92f8a5791b0b";
      const feeTiers = [100n, 500n, 3000n, 10000n];
      const result = await UniswapHelper.isPoolExist(FactoryAddress, token0, token1, feeTiers);
      expect(result).to.equal(false);
    });
  });

  describe("findDeepestPool", function () {
    it("should return deepest pool address", async function () {
      // USDC/BOB
      {
        const token0 = "0x7f5c764cbc14f9669b88837ca1490cca17c31607";
        const token1 = "0xb0b195aefa3650a6908f15cdac7d92f8a5791b0b";
        const feeTiers = [100n, 500n, 3000n, 10000n];
        const result = await UniswapHelper.findV3DeepestPool(FactoryAddress, token0, token1, feeTiers);
        expect(result.toLowerCase()).to.equal("0x6432037739ccd0201987472604826097b55813e9".toLowerCase());
      }

      // WETH/PERP
      {
        const token0 = "0x4200000000000000000000000000000000000006";
        const token1 = "0x9e1028f5f1d5ede59748ffcee5532509976840e0";
        const feeTiers = [100n, 500n, 3000n, 10000n];
        const result = await UniswapHelper.findV3DeepestPool(FactoryAddress, token0, token1, feeTiers);
        expect(result.toLowerCase()).to.equal("0x535541F1aa08416e69Dc4D610131099FA2Ae7222".toLowerCase());
      }
    });

    it("should return deepest pool address with opposite tokens ordering", async function () {
      // USDC/BOB
      {
        const token0 = "0xb0b195aefa3650a6908f15cdac7d92f8a5791b0b";
        const token1 = "0x7f5c764cbc14f9669b88837ca1490cca17c31607";
        const feeTiers = [100n, 500n, 3000n, 10000n];
        const result = await UniswapHelper.findV3DeepestPool(FactoryAddress, token0, token1, feeTiers);
        expect(result.toLowerCase()).to.equal("0x6432037739ccd0201987472604826097b55813e9".toLowerCase());
      }

      // WETH/PERP
      {
        const token0 = "0x9e1028f5f1d5ede59748ffcee5532509976840e0";
        const token1 = "0x4200000000000000000000000000000000000006";
        const feeTiers = [100n, 500n, 3000n, 10000n];
        const result = await UniswapHelper.findV3DeepestPool(FactoryAddress, token0, token1, feeTiers);
        expect(result.toLowerCase()).to.equal("0x535541F1aa08416e69Dc4D610131099FA2Ae7222".toLowerCase());
      }
    });

    it("should fail when find the non-existent pool", async function () {
      // PERP/BOB
      const token0 = "0x9e1028f5f1d5ede59748ffcee5532509976840e0";
      const token1 = "0xb0b195aefa3650a6908f15cdac7d92f8a5791b0b";
      const feeTiers = [100n, 500n, 3000n, 10000n];
      await expect(UniswapHelper.findV3DeepestPool(FactoryAddress, token0, token1, feeTiers)).to.be.revertedWith(
        "UHDP0",
      );
    });
  });

  describe("adjustDepositTick", function () {
    it("should success to adjust tick", async function () {
      {
        const currentTick = 276229;
        const fee = 100n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(currentTick);
      }
      {
        const currentTick = -276229;
        const fee = 100n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(currentTick);
      }
      {
        const currentTick = 0;
        const fee = 500n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(currentTick);
      }

      {
        const currentTick = 15;
        const fee = 500n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(20);
      }
      {
        const currentTick = 14;
        const fee = 500n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(10);
      }

      {
        const currentTick = -1;
        const fee = 500n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(0);
      }

      {
        const currentTick = -6;
        const fee = 500n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(-10);
      }

      {
        const currentTick = -5;
        const fee = 500n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(-10);
      }

      {
        const currentTick = -4;
        const fee = 500n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(0);
      }

      {
        const currentTick = -6;
        const fee = 3000n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(0);
      }

      {
        const currentTick = -30;
        const fee = 3000n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(-60);
      }

      {
        const currentTick = 100;
        const fee = 3000n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(120);
      }

      {
        const currentTick = 89;
        const fee = 3000n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(60);
      }
      {
        const currentTick = 120;
        const fee = 3000n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(120);
      }
      {
        const currentTick = -60;
        const fee = 3000n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(-60);
      }

      {
        const currentTick = 89;
        const fee = 10000n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(0);
      }
      {
        const currentTick = 100;
        const fee = 10000n;
        const adjustedTick = await UniswapHelper._adjustDepositTick(FactoryAddress, currentTick, fee);
        expect(adjustedTick).to.equal(200);
      }
    });
  });
});
