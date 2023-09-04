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

  const idleLiquidityModuleAddress = "0x69166cD2f42D682F284565426C60a42AC53F7bAC";
  const idleLiquidityModule = (await ethers.getContractAt(
    "IdleLiquidityModule",
    idleLiquidityModuleAddress,
  )) as IdleLiquidityModule;

  const userAddress = "0x565d490806A6D8eF532f4d29eC00EF6aAC71A17A";
  const feeReceiver = "0x565d490806A6D8eF532f4d29eC00EF6aAC71A17A";
  const positionId = 3;
  const estimatedGasFee = 1;
  const isForced = true;

  const gas = await idleLiquidityModule.estimateGas.rebalance({
    userAddress: userAddress,
    feeReceiver: feeReceiver,
    positionId: positionId,
    estimatedGasFee: estimatedGasFee,
    isForced: isForced,
  });

  const gasPrice = await ethers.provider.getGasPrice();

  console.log(`gas: ${gas.toString()}`);
  console.log(`gasPrice: ${gasPrice.toString()}`);
  console.log(`gasFee: ${gas.mul(gasPrice).toString()}`);

  const txn = await idleLiquidityModule.rebalance({
    userAddress: userAddress,
    feeReceiver: feeReceiver,
    positionId: positionId,
    estimatedGasFee: gas.mul(gasPrice),
    isForced: isForced,
  });

  console.log(`txn hash: ${txn.hash}...`);
  await txn.wait(WAIT_BLOCK_CONFIRMATIONS);

  console.log(`rebalance txn confirmed!`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
