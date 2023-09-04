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

  const token0 = (await ethers.getContractAt("IERC20", "0x2791bca1f2de4661ed88a30c99a7a9449aa84174")) as IERC20;
  const token1 = (await ethers.getContractAt("IERC20", "0xc2132d05d31c914a87c6611c10748aeb04b58e8f")) as IERC20;

  const depositRecipesAddress = "0x848f48d5Ec66B36F01FCC5967e5662d77eFcb144";
  const depositRecipes = (await ethers.getContractAt("DepositRecipes", depositRecipesAddress)) as DepositRecipes;

  await token0.approve(depositRecipes.address, 10n * 10n ** 6n);
  await token1.approve(depositRecipes.address, 10n * 10n ** 6n);

  const fee = 100;
  const tickLowerDiff = "-1";
  const tickUpperDiff = "1";
  const amount0Desired = 10n * 10n ** 6n;
  const amount1Desired = 10n * 10n ** 6n;
  const strategyId = ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16);
  const strategyProvider = "0xcafCE5363A2dEC41e0597B6B3c6c1A11ab219698";

  const txn = await depositRecipes.depositListedStrategy({
    token0: token0.address,
    token1: token1.address,
    fee: fee,
    tickLowerDiff: tickLowerDiff,
    tickUpperDiff: tickUpperDiff,
    amount0Desired: amount0Desired,
    amount1Desired: amount1Desired,
    strategyId: strategyId,
    strategyProvider: strategyProvider,
  });
  console.log(`Deposit txn hash: ${txn.hash}...`);
  await txn.wait(WAIT_BLOCK_CONFIRMATIONS);

  console.log(`Deposit txn confirmed!`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
