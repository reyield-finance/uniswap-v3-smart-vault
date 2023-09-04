import { ethers, network, run } from "hardhat";

import { Config } from "../../deploy/000_Config";
import {
  ClosePosition,
  DepositRecipes,
  IERC20,
  IUniswapV3Factory,
  IUniswapV3Pool,
  IWETH9,
  IdleLiquidityModule,
  IncreaseLiquidity,
  Mint,
  MockToken,
  PositionManagerFactory,
  Registry,
  RepayRebalanceFee,
  ReturnProfit,
  ShareProfit,
  SingleTokenIncreaseLiquidity,
  StrategyProviderWalletFactory,
  SwapToPositionRatio, // Timelock,
  WithdrawRecipes,
  ZapIn,
} from "../../types";

async function main() {
  const WAIT_BLOCK_CONFIRMATIONS = 6;

  const tokenUSDT = (await ethers.getContractAt("IERC20", "0xc2132d05d31c914a87c6611c10748aeb04b58e8f")) as IERC20;

  const depositRecipesAddress = "0x848f48d5Ec66B36F01FCC5967e5662d77eFcb144";
  const depositRecipes = (await ethers.getContractAt("DepositRecipes", depositRecipesAddress)) as DepositRecipes;

  await tokenUSDT.approve(depositRecipes.address, 30n * 10n ** 18n);

  const txn = await depositRecipes.singleTokenDeposit({
    token0: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
    token1: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
    fee: 500,
    tickLowerDiff: "-10",
    tickUpperDiff: "10",
    amountIn: 10n * 10n ** 6n,
    isToken0In: true,
    strategyId: ethers.utils.hexZeroPad(ethers.utils.hexlify(2), 16),
  });
  console.log(`Deposit txn hash: ${txn.hash}...`);
  await txn.wait(WAIT_BLOCK_CONFIRMATIONS);

  console.log(`Deposit txn confirmed!`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
