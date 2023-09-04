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

  const withdrawRecipesAddress = "0xa92ac3e46442b32F02848D26bcB0Cc4426D2f568";
  const withdrawRecipes = (await ethers.getContractAt("WithdrawRecipes", withdrawRecipesAddress)) as WithdrawRecipes;
  const positionId = 1;
  const isReturnedToken0 = true;
  const txn = await withdrawRecipes.singleTokenWithdraw(positionId, isReturnedToken0);
  console.log(`Withdraw txn hash: ${txn.hash}...`);
  await txn.wait(WAIT_BLOCK_CONFIRMATIONS);

  console.log(`Withdraw txn confirmed!`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
