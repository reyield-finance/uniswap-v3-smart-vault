import { reset } from "@nomicfoundation/hardhat-network-helpers";
import "@nomiclabs/hardhat-ethers";
import { expect } from "chai";
import { ethers } from "hardhat";
import bigDecimal from "js-big-decimal";

import { MockSwapHelper } from "../../types";

describe("SwapHelper.sol", function () {
  //GLOBAL VARIABLE - USE THIS

  let SwapHelper: MockSwapHelper;

  before(async function () {
    // NOTE: block gas limit may not enough so we need to reset
    await reset(process.env.ALCHEMY_OPTIMISM_MAINNET, 107735214);
    const MockSwapHelperFactory = await ethers.getContractFactory("MockSwapHelper");
    SwapHelper = (await MockSwapHelperFactory.deploy()) as MockSwapHelper;
    await SwapHelper.deployed();
  });

  async function swapTo(
    fromDecimals: bigint,
    toDecimals: bigint,
    amount: bigint,
    price: string,
    isFromIsQuote: boolean,
  ): Promise<string> {
    const dAmount = bigDecimal.divide(amount, 10n ** fromDecimals, 100);
    if (isFromIsQuote) {
      return bigDecimal.multiply(bigDecimal.divide(dAmount, price, 100), 10n ** toDecimals);
    } else {
      return bigDecimal.multiply(bigDecimal.multiply(dAmount, price), 10n ** toDecimals);
    }
  }

  async function getPriceFromTick(token0Decimals: bigint, token1Decimals: bigint, tick: bigint): Promise<string> {
    return bigDecimal.multiply(
      (10001 / 10000) ** Number(tick),
      bigDecimal.divide(10n ** token0Decimals, 10n ** token1Decimals, 100),
    );
  }

  async function getPriceFromSqrtPriceX96(
    token0Decimals: bigint,
    token1Decimals: bigint,
    sqrtPriceX96: bigint,
  ): Promise<string> {
    const tempPrice = bigDecimal.divide(
      bigDecimal.multiply(sqrtPriceX96, sqrtPriceX96),
      bigDecimal.multiply(2n ** 96n, 2n ** 96n),
      100,
    );
    return bigDecimal.multiply(tempPrice, bigDecimal.divide(10n ** token0Decimals, 10n ** token1Decimals, 100));
  }

  describe("calcAmountToSwap", function () {
    it("should swap all to one token if poolTick is under tickLower", async function () {
      //range is over the pool tick => after swap, all my position should be in token0
      const sqrtRatioX96 = "84436263667623614766280323984";
      const tickLower = 1275;
      const tickUpper = 2000;
      const sqrtPriceX96 = "84436263667623614766280323984";
      const amount0In = "0x" + (1e5).toString(16);
      const amount1In = "0x" + (5e5).toString(16);
      const [amountToSwap, token0In] = await SwapHelper.calcAmountToSwap(
        sqrtRatioX96,
        tickLower,
        tickUpper,
        sqrtPriceX96,
        amount0In,
        amount1In,
      );
      expect(amountToSwap).to.equal(amount1In);
      expect(token0In).to.equal(false);
    });

    it("should swap all to one token if poolTick is over tickUpper", async function () {
      //range is under the pool tick => after swap, all my position should be in token1
      const sqrtRatioX96 = "84436263667623614766280323984";
      const tickLower = 1000;
      const tickUpper = 1270;
      const sqrtPriceX96 = "84436263667623614766280323984";
      const amount0In = "0x" + (1e5).toString(16);
      const amount1In = "0x" + (5e5).toString(16);
      const [amountToSwap, token0In] = await SwapHelper.calcAmountToSwap(
        sqrtRatioX96,
        tickLower,
        tickUpper,
        sqrtPriceX96,
        amount0In,
        amount1In,
      );
      expect(amountToSwap).to.equal(amount0In);
      expect(token0In).to.equal(true);
    });

    it("should calculate 0.05% USDC/WETH amount under estimation missing 0.1% tolerance", async function () {
      const sqrtRatioX96 = 1876605575462415723938045865344821n;
      const tickLower = 201462n - 10n;
      const tickUpper = 201462n + 10n;
      const sqrtPriceX96 = 1876605575462415723938045865344821n;
      const amount0In = 10000n * 10n ** 6n;
      const amount1In = 2n * 10n ** 18n;
      const token0Decimal = 6n;
      const token1Decimal = 18n;
      const [amountToSwap, token0In] = await SwapHelper.calcAmountToSwap(
        sqrtRatioX96,
        tickLower,
        tickUpper,
        sqrtPriceX96,
        amount0In,
        amount1In,
      );
      const currentPrice = await getPriceFromSqrtPriceX96(token0Decimal, token1Decimal, sqrtPriceX96);
      const tickLowerPrice = await getPriceFromTick(token0Decimal, token1Decimal, tickLower);
      const tickUpperPrice = await getPriceFromTick(token0Decimal, token1Decimal, tickUpper);
      const ratio = bigDecimal.divide(
        bigDecimal.subtract(currentPrice, tickLowerPrice),
        bigDecimal.subtract(tickUpperPrice, currentPrice),
        100,
      );

      if (token0In) {
        const token0Amount = amount0In - amountToSwap.toBigInt();
        const token1Amount = bigDecimal.add(
          await swapTo(token1Decimal, token0Decimal, amount1In, currentPrice, true),
          amountToSwap.toBigInt(),
        );
        expect(
          Number(
            bigDecimal.divide(
              bigDecimal.abs(bigDecimal.subtract(ratio, bigDecimal.divide(token1Amount, token0Amount, 100))),
              ratio,
              100,
            ),
          ),
        ).to.be.closeTo(0, 0.001);
      } else {
        const token1Amount = amount1In - amountToSwap.toBigInt();

        const token0Amount = bigDecimal.add(
          await swapTo(token0Decimal, token1Decimal, amount0In, currentPrice, false),
          amountToSwap.toBigInt(),
        );
        expect(
          Number(
            bigDecimal.divide(
              bigDecimal.abs(bigDecimal.subtract(ratio, bigDecimal.divide(token1Amount, token0Amount, 100))),
              ratio,
              100,
            ),
          ),
        ).to.be.closeTo(0, 0.001);
      }
    });

    it("should calculate 0.01% wstETH/WETH amount under estimation missing 0.1% tolerance", async function () {
      const sqrtRatioX96 = 84442141573254632724731656119n;
      const tickLower = 1274n - 10n;
      const tickUpper = 1274n + 10n;
      const sqrtPriceX96 = 84442141573254632724731656119n;
      const amount0In = 15n * 10n ** 18n;
      const amount1In = 2n * 10n ** 18n;
      const token0Decimal = 18n;
      const token1Decimal = 18n;
      const [amountToSwap, token0In] = await SwapHelper.calcAmountToSwap(
        sqrtRatioX96,
        tickLower,
        tickUpper,
        sqrtPriceX96,
        amount0In,
        amount1In,
      );
      const currentPrice = await getPriceFromSqrtPriceX96(token0Decimal, token1Decimal, sqrtPriceX96);
      const tickLowerPrice = await getPriceFromTick(token0Decimal, token1Decimal, tickLower);
      const tickUpperPrice = await getPriceFromTick(token0Decimal, token1Decimal, tickUpper);
      const ratio = bigDecimal.divide(
        bigDecimal.subtract(currentPrice, tickLowerPrice),
        bigDecimal.subtract(tickUpperPrice, currentPrice),
        100,
      );

      if (token0In) {
        const token0Amount = amount0In - amountToSwap.toBigInt();
        const token1Amount = bigDecimal.add(
          await swapTo(token1Decimal, token0Decimal, amount1In, currentPrice, true),
          amountToSwap.toBigInt(),
        );
        expect(
          Number(
            bigDecimal.divide(
              bigDecimal.abs(bigDecimal.subtract(ratio, bigDecimal.divide(token1Amount, token0Amount, 100))),
              ratio,
              100,
            ),
          ),
        ).to.be.closeTo(0, 0.001);
      } else {
        const token1Amount = amount1In - amountToSwap.toBigInt();

        const token0Amount = bigDecimal.add(
          await swapTo(token0Decimal, token1Decimal, amount0In, currentPrice, false),
          amountToSwap.toBigInt(),
        );
        expect(
          Number(
            bigDecimal.divide(
              bigDecimal.abs(bigDecimal.subtract(ratio, bigDecimal.divide(token1Amount, token0Amount, 100))),
              ratio,
              100,
            ),
          ),
        ).to.be.closeTo(0, 0.001);
      }
    });

    it("should calculate 0.01% USDC/sUSD amount under estimation missing 0.1% tolerance", async function () {
      const sqrtRatioX96 = 79321984609851899188373180902538573n;
      const tickLower = 276347n - 10n;
      const tickUpper = 276347n + 10n;
      const sqrtPriceX96 = 79321984609851899188373180902538573n;
      const amount0In = 15n * 10n ** 6n;
      const amount1In = 2n * 10n ** 6n;
      const token0Decimal = 6n;
      const token1Decimal = 6n;
      const [amountToSwap, token0In] = await SwapHelper.calcAmountToSwap(
        sqrtRatioX96,
        tickLower,
        tickUpper,
        sqrtPriceX96,
        amount0In,
        amount1In,
      );
      const currentPrice = await getPriceFromSqrtPriceX96(token0Decimal, token1Decimal, sqrtPriceX96);
      const tickLowerPrice = await getPriceFromTick(token0Decimal, token1Decimal, tickLower);
      const tickUpperPrice = await getPriceFromTick(token0Decimal, token1Decimal, tickUpper);
      const ratio = bigDecimal.divide(
        bigDecimal.subtract(currentPrice, tickLowerPrice),
        bigDecimal.subtract(tickUpperPrice, currentPrice),
        100,
      );

      if (token0In) {
        const token0Amount = amount0In - amountToSwap.toBigInt();
        const token1Amount = bigDecimal.add(
          await swapTo(token1Decimal, token0Decimal, amount1In, currentPrice, true),
          amountToSwap.toBigInt(),
        );
        expect(
          Number(
            bigDecimal.divide(
              bigDecimal.abs(bigDecimal.subtract(ratio, bigDecimal.divide(token1Amount, token0Amount, 100))),
              ratio,
              100,
            ),
          ),
        ).to.be.closeTo(0, 0.001);
      } else {
        const token1Amount = amount1In - amountToSwap.toBigInt();

        const token0Amount = bigDecimal.add(
          await swapTo(token0Decimal, token1Decimal, amount0In, currentPrice, false),
          amountToSwap.toBigInt(),
        );
        expect(
          Number(
            bigDecimal.divide(
              bigDecimal.abs(bigDecimal.subtract(ratio, bigDecimal.divide(token1Amount, token0Amount, 100))),
              ratio,
              100,
            ),
          ),
        ).to.be.closeTo(0, 0.001);
      }
    });

    it("should work if zero amounts are passed", async function () {
      const sqrtRatioX96 = 84442141573254632724731656119n;
      const tickLower = 1274n - 10n;
      const tickUpper = 1274n + 10n;
      const sqrtPriceX96 = 84442141573254632724731656119n;
      const amount0In = 0n;
      const amount1In = 2n * 10n ** 18n;
      const token0Decimal = 18n;
      const token1Decimal = 18n;
      const [amountToSwap, token0In] = await SwapHelper.calcAmountToSwap(
        sqrtRatioX96,
        tickLower,
        tickUpper,
        sqrtPriceX96,
        amount0In,
        amount1In,
      );
      const currentPrice = await getPriceFromSqrtPriceX96(token0Decimal, token1Decimal, sqrtPriceX96);
      const tickLowerPrice = await getPriceFromTick(token0Decimal, token1Decimal, tickLower);
      const tickUpperPrice = await getPriceFromTick(token0Decimal, token1Decimal, tickUpper);
      const ratio = bigDecimal.divide(
        bigDecimal.subtract(currentPrice, tickLowerPrice),
        bigDecimal.subtract(tickUpperPrice, currentPrice),
        100,
      );

      if (token0In) {
        const token0Amount = amount0In - amountToSwap.toBigInt();
        const token1Amount = bigDecimal.add(
          await swapTo(token1Decimal, token0Decimal, amount1In, currentPrice, true),
          amountToSwap.toBigInt(),
        );
        expect(
          Number(
            bigDecimal.divide(
              bigDecimal.abs(bigDecimal.subtract(ratio, bigDecimal.divide(token1Amount, token0Amount, 100))),
              ratio,
              100,
            ),
          ),
        ).to.be.closeTo(0, 0.001);
      } else {
        const token1Amount = amount1In - amountToSwap.toBigInt();

        const token0Amount = bigDecimal.add(
          await swapTo(token0Decimal, token1Decimal, amount0In, currentPrice, false),
          amountToSwap.toBigInt(),
        );
        expect(
          Number(
            bigDecimal.divide(
              bigDecimal.abs(bigDecimal.subtract(ratio, bigDecimal.divide(token1Amount, token0Amount, 100))),
              ratio,
              100,
            ),
          ),
        ).to.be.closeTo(0, 0.001);
      }
    });

    it("should revert if both amount are zero", async function () {
      const sqrtRatioX96 = 84436263753236640469995622965n;
      const tickLower = 1273n - 50n;
      const tickUpper = 1273n + 50n;
      const sqrtPriceX96 = 84436263753236640469995622965n;
      const amount0In = 0n;
      const amount1In = 0n;
      await expect(SwapHelper.calcAmountToSwap(sqrtRatioX96, tickLower, tickUpper, sqrtPriceX96, amount0In, amount1In))
        .to.be.reverted;
    });
  });

  describe("getQuoteFromSqrtRatioX96", function () {
    it("should calculate price correctly when token0Decimals = 8, token1Decimals = 18", async function () {
      const sqrtPriceX96 = 31352810733785790057514784322224029n;
      const token0Decimals = 8n;
      const token1Decimals = 18n;
      const token0Address = "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6";
      const token1Address = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619";
      const token0AsBasePrice = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96,
        10n ** 8n,
        token0Address,
        token1Address,
      );
      const token1AsBasePrice = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96,
        10n ** 18n,
        token1Address,
        token0Address,
      );
      const expectedPrice = bigDecimal.floor(
        bigDecimal.multiply(
          await getPriceFromSqrtPriceX96(token0Decimals, token1Decimals, sqrtPriceX96),
          10n ** token1Decimals,
        ),
      );
      expect(token0AsBasePrice.toString()).to.equal(expectedPrice.toString());

      const expectedPrice2 = bigDecimal.floor(
        bigDecimal.divide(10n ** (token0Decimals + token1Decimals), expectedPrice, 100),
      );
      expect(
        Number(bigDecimal.divide(bigDecimal.subtract(expectedPrice2, token1AsBasePrice), expectedPrice2)),
      ).to.be.closeTo(0, 0.00001);
    });

    it("should calculate price correctly when token0Decimals = 18, token1Decimals = 18", async function () {
      const sqrtPriceX96 = 1469857447998424218629100979n;
      const token0Decimals = 18n;
      const token1Decimals = 18n;
      const token0Address = "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270";
      const token1Address = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619";
      const token0AsBasePrice = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96,
        10n ** 18n,
        token0Address,
        token1Address,
      );
      const token1AsBasePrice = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96,
        10n ** 18n,
        token1Address,
        token0Address,
      );
      const expectedPrice = bigDecimal.floor(
        bigDecimal.multiply(
          await getPriceFromSqrtPriceX96(token0Decimals, token1Decimals, sqrtPriceX96),
          10n ** token1Decimals,
        ),
      );
      expect(token0AsBasePrice.toString()).to.equal(expectedPrice.toString());

      const expectedPrice2 = bigDecimal.floor(
        bigDecimal.divide(10n ** (token0Decimals + token1Decimals), expectedPrice, 100),
      );
      expect(
        Number(bigDecimal.divide(bigDecimal.subtract(expectedPrice2, token1AsBasePrice), expectedPrice2)),
      ).to.be.closeTo(0, 0.00001);
    });

    it("should calculate price correctly when token0Decimals = 18, token1Decimals = 6", async function () {
      const sqrtPriceX96 = 59868658071139987563756n;
      const token0Decimals = 18n;
      const token1Decimals = 6n;
      const token0Address = "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270";
      const token1Address = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";
      const token0AsBasePrice = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96,
        10n ** 18n,
        token0Address,
        token1Address,
      );
      const token1AsBasePrice = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96,
        10n ** 6n,
        token1Address,
        token0Address,
      );
      const expectedPrice = bigDecimal.floor(
        bigDecimal.multiply(
          await getPriceFromSqrtPriceX96(token0Decimals, token1Decimals, sqrtPriceX96),
          10n ** token1Decimals,
        ),
      );
      expect(token0AsBasePrice.toString()).to.equal(expectedPrice.toString());

      const expectedPrice2 = bigDecimal.floor(
        bigDecimal.divide(10n ** (token0Decimals + token1Decimals), expectedPrice, 100),
      );
      expect(
        Number(bigDecimal.divide(bigDecimal.subtract(expectedPrice2, token1AsBasePrice), expectedPrice2)),
      ).to.be.closeTo(0, 0.00001);
    });

    it("should calculate price correctly when token0Decimals = 6, token1Decimals = 6", async function () {
      const sqrtPriceX96 = 79235964258952077074994560300n;
      const token0Decimals = 6n;
      const token1Decimals = 6n;
      const token0Address = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
      const token1Address = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";
      const token0AsBasePrice = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96,
        10n ** 6n,
        token0Address,
        token1Address,
      );
      const token1AsBasePrice = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96,
        10n ** 6n,
        token1Address,
        token0Address,
      );
      const expectedPrice = bigDecimal.floor(
        bigDecimal.multiply(
          await getPriceFromSqrtPriceX96(token0Decimals, token1Decimals, sqrtPriceX96),
          10n ** token1Decimals,
        ),
      );
      expect(token0AsBasePrice.toString()).to.equal(expectedPrice.toString());

      const expectedPrice2 = bigDecimal.floor(
        bigDecimal.divide(10n ** (token0Decimals + token1Decimals), expectedPrice, 100),
      );
      expect(
        Number(bigDecimal.divide(bigDecimal.subtract(expectedPrice2, token1AsBasePrice), expectedPrice2)),
      ).to.be.closeTo(0, 0.00001);
    });

    it("should calculate price correctly when token0Decimals = 8, token1Decimals = 6", async function () {
      const sqrtPriceX96 = 1279919890879133850417411365891n;
      const token0Decimals = 8n;
      const token1Decimals = 6n;
      const token0Address = "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6";
      const token1Address = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
      const token0AsBasePrice = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96,
        10n ** 8n,
        token0Address,
        token1Address,
      );
      const token1AsBasePrice = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96,
        10n ** 6n,
        token1Address,
        token0Address,
      );
      const expectedPrice = bigDecimal.floor(
        bigDecimal.multiply(
          await getPriceFromSqrtPriceX96(token0Decimals, token1Decimals, sqrtPriceX96),
          10n ** token1Decimals,
        ),
      );
      expect(token0AsBasePrice.toString()).to.equal(expectedPrice.toString());

      const expectedPrice2 = bigDecimal.floor(
        bigDecimal.divide(10n ** (token0Decimals + token1Decimals), expectedPrice, 100),
      );
      expect(
        Number(bigDecimal.divide(bigDecimal.subtract(expectedPrice2, token1AsBasePrice), expectedPrice2)),
      ).to.be.closeTo(0, 0.00001);
    });
  });

  describe("distributeTargetAmount", function () {
    it("should distributed correctly when token0Decimals = 8, token1Decimals = 18", async function () {
      const sqrtPriceX96Token0 = 1279919890879133850417411365891n;
      const sqrtPriceX96Token1 = 1939091184091390492444461233265247n;
      const token0Decimals = 8n;
      const token1Decimals = 18n;
      const token0Address = "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6";
      const token1Address = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619";
      const usdValueAddress = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";

      const token0AsBasePrice = await SwapHelper.getPrice(
        sqrtPriceX96Token0,
        token0Address,
        usdValueAddress,
        token0Decimals,
      );
      const token1AsBasePrice = await SwapHelper.getPrice(
        sqrtPriceX96Token1,
        token1Address,
        usdValueAddress,
        token1Decimals,
      );

      const amount0 = 1n * 10n ** 8n;
      const amount1 = 3n * 10n ** 18n;
      const targetAmount = 15000n * 10n ** 6n;
      const amountsDistributed = await SwapHelper.distributeTargetAmount(
        token0Decimals,
        token1Decimals,
        amount0,
        amount1,
        token0AsBasePrice,
        token1AsBasePrice,
        targetAmount,
      );

      const token0UsdValue = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96Token0,
        amountsDistributed.amount0Distributed,
        token0Address,
        usdValueAddress,
      );
      const token1UsdValue = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96Token1,
        amountsDistributed.amount1Distributed,
        token1Address,
        usdValueAddress,
      );

      expect(
        Number(
          bigDecimal.divide(
            bigDecimal.subtract(targetAmount.toString(), token0UsdValue.add(token1UsdValue).toString()),
            targetAmount.toString(),
          ),
        ),
      ).to.be.closeTo(0, 0.00001);
    });

    it("should distributed correctly when token0Decimals = 18, token1Decimals = 18", async function () {
      const sqrtPriceX96Token0 = 60116733694466585576760n;
      const sqrtPriceX96Token1 = 1939091184091390492444461233265247n;
      const token0Decimals = 18n;
      const token1Decimals = 18n;
      const token0Address = "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270";
      const token1Address = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619";
      const usdValueAddress = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";

      const token0AsBasePrice = await SwapHelper.getPrice(
        sqrtPriceX96Token0,
        token0Address,
        usdValueAddress,
        token0Decimals,
      );
      const token1AsBasePrice = await SwapHelper.getPrice(
        sqrtPriceX96Token1,
        token1Address,
        usdValueAddress,
        token1Decimals,
      );

      const amount0 = 0n * 10n ** 18n;
      const amount1 = 3n * 10n ** 18n;
      const targetAmount = 1000n * 10n ** 6n;
      const amountsDistributed = await SwapHelper.distributeTargetAmount(
        token0Decimals,
        token1Decimals,
        amount0,
        amount1,
        token0AsBasePrice,
        token1AsBasePrice,
        targetAmount,
      );

      const token0UsdValue = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96Token0,
        amountsDistributed.amount0Distributed,
        token0Address,
        usdValueAddress,
      );
      const token1UsdValue = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96Token1,
        amountsDistributed.amount1Distributed,
        token1Address,
        usdValueAddress,
      );

      expect(
        Number(
          bigDecimal.divide(
            bigDecimal.subtract(targetAmount.toString(), token0UsdValue.add(token1UsdValue).toString()),
            targetAmount.toString(),
          ),
        ),
      ).to.be.closeTo(0, 0.00001);
    });

    it("should distributed correctly when token0Decimals = 18, token1Decimals = 6", async function () {
      const sqrtPriceX96Token0 = 60116733694466585576760n;
      const sqrtPriceX96Token1 = 79235964258952077074994560300n;
      const token0Decimals = 18n;
      const token1Decimals = 6n;
      const token0Address = "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270";
      const token1Address = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";
      const usdValueAddress = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";

      const token0AsBasePrice = await SwapHelper.getPrice(
        sqrtPriceX96Token0,
        token0Address,
        usdValueAddress,
        token0Decimals,
      );
      const token1AsBasePrice = await SwapHelper.getPrice(
        sqrtPriceX96Token1,
        token1Address,
        usdValueAddress,
        token1Decimals,
      );

      const amount0 = 30n * 10n ** 18n;
      const amount1 = 1n * 10n ** 6n;
      const targetAmount = 1n * 10n ** 6n;
      const amountsDistributed = await SwapHelper.distributeTargetAmount(
        token0Decimals,
        token1Decimals,
        amount0,
        amount1,
        token0AsBasePrice,
        token1AsBasePrice,
        targetAmount,
      );

      const token0UsdValue = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96Token0,
        amountsDistributed.amount0Distributed,
        token0Address,
        usdValueAddress,
      );
      const token1UsdValue = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96Token1,
        amountsDistributed.amount1Distributed,
        token1Address,
        usdValueAddress,
      );

      expect(
        Number(
          bigDecimal.divide(
            bigDecimal.subtract(targetAmount.toString(), token0UsdValue.add(token1UsdValue).toString()),
            targetAmount.toString(),
          ),
        ),
      ).to.be.closeTo(0, 0.00001);
    });

    it("should distributed correctly when token0Decimals = 6, token1Decimals = 6", async function () {
      const sqrtPriceX96Token0 = 79235964258952077074994560300n;
      const sqrtPriceX96Token1 = 79235964258952077074994560300n;
      const token0Decimals = 6n;
      const token1Decimals = 6n;
      const token0Address = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
      const token1Address = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";
      const usdValueAddress = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";

      const token0AsBasePrice = await SwapHelper.getPrice(
        sqrtPriceX96Token0,
        token0Address,
        usdValueAddress,
        token0Decimals,
      );
      const token1AsBasePrice = await SwapHelper.getPrice(
        sqrtPriceX96Token1,
        token1Address,
        usdValueAddress,
        token1Decimals,
      );

      const amount0 = 987n * 10n ** 6n;
      const amount1 = 1300n * 10n ** 6n;
      const targetAmount = 2000n * 10n ** 6n;
      const amountsDistributed = await SwapHelper.distributeTargetAmount(
        token0Decimals,
        token1Decimals,
        amount0,
        amount1,
        token0AsBasePrice,
        token1AsBasePrice,
        targetAmount,
      );

      const token0UsdValue = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96Token0,
        amountsDistributed.amount0Distributed,
        token0Address,
        usdValueAddress,
      );
      const token1UsdValue = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96Token1,
        amountsDistributed.amount1Distributed,
        token1Address,
        usdValueAddress,
      );

      expect(
        Number(
          bigDecimal.divide(
            bigDecimal.subtract(targetAmount.toString(), token0UsdValue.add(token1UsdValue).toString()),
            targetAmount.toString(),
          ),
        ),
      ).to.be.closeTo(0, 0.0002);
    });

    it("should distributed correctly when token0Decimals = 8, token1Decimals = 6", async function () {
      const sqrtPriceX96Token0 = 1279919890879133850417411365891n;
      const sqrtPriceX96Token1 = 79235964258952077074994560300n;
      const token0Decimals = 8n;
      const token1Decimals = 6n;
      const token0Address = "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6";
      const token1Address = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
      const usdValueAddress = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";

      const token0AsBasePrice = await SwapHelper.getPrice(
        sqrtPriceX96Token0,
        token0Address,
        usdValueAddress,
        token0Decimals,
      );
      const token1AsBasePrice = await SwapHelper.getPrice(
        sqrtPriceX96Token1,
        token1Address,
        usdValueAddress,
        token1Decimals,
      );

      const amount0 = 1n * 10n ** 8n;
      const amount1 = 0n * 10n ** 6n;
      const targetAmount = 2000n * 10n ** 6n;
      const amountsDistributed = await SwapHelper.distributeTargetAmount(
        token0Decimals,
        token1Decimals,
        amount0,
        amount1,
        token0AsBasePrice,
        token1AsBasePrice,
        targetAmount,
      );

      const token0UsdValue = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96Token0,
        amountsDistributed.amount0Distributed,
        token0Address,
        usdValueAddress,
      );
      const token1UsdValue = await SwapHelper.getQuoteFromSqrtRatioX96(
        sqrtPriceX96Token1,
        amountsDistributed.amount1Distributed,
        token1Address,
        usdValueAddress,
      );

      expect(
        Number(
          bigDecimal.divide(
            bigDecimal.subtract(targetAmount.toString(), token0UsdValue.add(token1UsdValue).toString()),
            targetAmount.toString(),
          ),
        ),
      ).to.be.closeTo(0, 0.00001);
    });
  });
});
