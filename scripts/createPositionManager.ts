import { ethers, network, run } from "hardhat";

import {
  ClosePosition,
  DepositRecipes,
  IdleLiquidityModule,
  IncreaseLiquidity,
  Mint,
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
} from "../types";

async function main() {
  const positionManagerFactoryAddress = "0x8792037Da56006476a6BF035f607E7dA254ccD7A";
  const positionManagerFactory = (await ethers.getContractAt(
    "PositionManagerFactory",
    positionManagerFactoryAddress,
  )) as PositionManagerFactory;

  const txn = await positionManagerFactory.create();
  console.log(`Create position manager txn hash: ${txn.hash}...`);
  const WAIT_BLOCK_CONFIRMATIONS = 6;
  await txn.wait(WAIT_BLOCK_CONFIRMATIONS);

  console.log(`Create position manager txn confirmed!`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
