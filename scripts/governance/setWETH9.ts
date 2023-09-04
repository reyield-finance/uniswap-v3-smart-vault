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

  const registry = (await ethers.getContractAt("Registry", "0x2833242BAC2E2a196d240ADe39ff6D2b912D9edb")) as Registry;

  const txn = await registry.setWETH9("0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270");
  console.log(`setWETH9 txn hash: ${txn.hash}...`);
  await txn.wait(WAIT_BLOCK_CONFIRMATIONS);

  console.log(`setWETH9 txn confirmed!`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
