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
  StrategyProviderWallet,
  StrategyProviderWalletFactory,
  SwapToPositionRatio, // Timelock,
  WithdrawRecipes,
  ZapIn,
} from "../../types";

async function main() {
  const WAIT_BLOCK_CONFIRMATIONS = 6;

  const strategyProviderWalletFactoryAddress = "0xd724C184400829BF0fcDa675e615F5915BA03CAb";
  const strategyProviderWalletFactory = (await ethers.getContractAt(
    "StrategyProviderWalletFactory",
    strategyProviderWalletFactoryAddress,
  )) as StrategyProviderWalletFactory;

  const strategyProviderWalletAddress = await strategyProviderWalletFactory.providerToWallet(
    "0x565d490806A6D8eF532f4d29eC00EF6aAC71A17A",
  );
  const strategyProviderWallet = (await ethers.getContractAt(
    "StrategyProviderWallet",
    strategyProviderWalletAddress,
  )) as StrategyProviderWallet;

  const strategyId = ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 16);
  const token0 = "0x7F5c764cBc14f9669B88837ca1490cCa17c31607";
  const token1 = "0x8c6f28f2F1A3C87F0f938b96d27520d9751ec8d9";
  const fee = 100;
  const performanceFeeRatio = 000;
  const receivedToken = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
  const licenseAmount = 1;

  const txn = await strategyProviderWallet.addStrategy(
    strategyId,
    token0,
    token1,
    fee,
    performanceFeeRatio,
    receivedToken,
    licenseAmount,
  );
  console.log(`Deposit txn hash: ${txn.hash}...`);
  await txn.wait(WAIT_BLOCK_CONFIRMATIONS);

  console.log(`add strategy txn confirmed!`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
