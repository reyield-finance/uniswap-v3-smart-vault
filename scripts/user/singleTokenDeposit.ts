import { ethers, network, run } from "hardhat";
import { parse as uuidParse } from "uuid";

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

  const strategyId = uuidParse("e10d45dd-8d2b-4482-9eb4-90d40e34c2b9") as number[];
  const token0Addr = "0x7F5c764cBc14f9669B88837ca1490cCa17c31607";
  const token1Addr = "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58";
  const fee = 100n;
  const tickLowerDiff = -1n;
  const tickUpperDiff = 1n;
  const amount = 10n * 10n ** 6n;
  const isToken0In = true;

  const token0 = (await ethers.getContractAt("IERC20", token0Addr)) as IERC20;
  const depositRecipesAddress = "0x848f48d5Ec66B36F01FCC5967e5662d77eFcb144";
  const depositRecipes = (await ethers.getContractAt("DepositRecipes", depositRecipesAddress)) as DepositRecipes;

  // const approveTxn = await token0.approve(depositRecipes.address, amount);
  // await approveTxn.wait(WAIT_BLOCK_CONFIRMATIONS);
  const txn = await depositRecipes.singleTokenDeposit({
    token0: token0Addr,
    token1: token1Addr,
    fee: fee,
    tickLowerDiff: tickLowerDiff,
    tickUpperDiff: tickUpperDiff,
    amountIn: amount,
    isToken0In: isToken0In,
    strategyId: strategyId,
  });

  console.log(`Deposit txn hash: ${txn.hash}...`);
  await txn.wait(WAIT_BLOCK_CONFIRMATIONS);

  console.log(`Deposit txn confirmed!`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
