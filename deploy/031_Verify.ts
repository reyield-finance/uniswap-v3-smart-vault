import { ethers } from "hardhat";
import { run } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getSelectors } from "../test/shared/fixtures";
import {
  ClosePosition,
  DepositRecipes,
  GovernanceRecipes,
  IdleLiquidityModule,
  IncreaseLiquidity,
  IncreaseLiquidityRecipes,
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
import { Config } from "./000_Config";

const Verify: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // 1. add modules, recipes and keepers on the registry
  // 2. set timelock as registry governance
  // 3. change governance from deployer on PM Factory
  const { deployments, getChainId, getNamedAccounts } = hre;
  const chainId = await getChainId();

  // const TimelockD = await deployments.get("Timelock");
  const RegistryD = await deployments.get("Registry");
  const RegistryAddressHolderD = await deployments.get("RegistryAddressHolder");
  const DiamondCutFacetD = await deployments.get("DiamondCutFacet");
  const UniswapAddressHolderD = await deployments.get("UniswapAddressHolder");

  // verify
  const maxTwapDeviation = 300;
  const twapDuration = 3;
  const { governance, serviceFeeRecipient, official, keeper } = await getNamedAccounts();
  const usdcAddress = Config[chainId].usdcAddress;
  const wethAddress = Config[chainId].wethAddress;

  await run("verify:verify", {
    address: (await deployments.get("Registry")).address,
    constructorArguments: [governance, serviceFeeRecipient, maxTwapDeviation, twapDuration, usdcAddress, wethAddress],
  });

  await run("verify:verify", {
    address: (await deployments.get("DiamondCutFacet")).address,
    constructorArguments: [],
  });

  await run("verify:verify", {
    address: (await deployments.get("RegistryAddressHolder")).address,
    constructorArguments: [RegistryD.address],
  });

  await run("verify:verify", {
    address: (await deployments.get("UniswapAddressHolder")).address,
    constructorArguments: [
      RegistryAddressHolderD.address,
      Config[chainId].nonfungiblePositionManager, //nonfungiblePositionManager address
      Config[chainId].uniswapV3Factory, //uniswapv3Factory address
      Config[chainId].swapRouter, //swapRouter address
    ],
  });

  await run("verify:verify", {
    address: (await deployments.get("PositionManagerFactory")).address,
    constructorArguments: [RegistryAddressHolderD.address, UniswapAddressHolderD.address, DiamondCutFacetD.address],
  });

  await run("verify:verify", {
    address: (await deployments.get("StrategyProviderWalletFactory")).address,
    constructorArguments: [RegistryAddressHolderD.address, UniswapAddressHolderD.address],
  });

  await run("verify:verify", {
    address: (await deployments.get("ClosePosition")).address,
    constructorArguments: [],
  });

  await run("verify:verify", {
    address: (await deployments.get("IncreaseLiquidity")).address,
    constructorArguments: [],
  });

  await run("verify:verify", {
    address: (await deployments.get("Mint")).address,
    constructorArguments: [],
  });

  await run("verify:verify", {
    address: (await deployments.get("RepayRebalanceFee")).address,
    constructorArguments: [],
  });
  await run("verify:verify", {
    address: (await deployments.get("ReturnProfit")).address,
    constructorArguments: [],
  });
  await run("verify:verify", {
    address: (await deployments.get("ShareProfit")).address,
    constructorArguments: [],
  });
  await run("verify:verify", {
    address: (await deployments.get("SingleTokenIncreaseLiquidity")).address,
    constructorArguments: [],
  });
  await run("verify:verify", {
    address: (await deployments.get("SwapToPositionRatio")).address,
    constructorArguments: [],
  });
  await run("verify:verify", {
    address: (await deployments.get("ZapIn")).address,
    constructorArguments: [],
  });
  await run("verify:verify", {
    address: (await deployments.get("ClosePositionOneShot")).address,
    constructorArguments: [],
  });
  await run("verify:verify", {
    address: (await deployments.get("WithdrawNativeToken")).address,
    constructorArguments: [],
  });
  await run("verify:verify", {
    address: (await deployments.get("IdleLiquidityModule")).address,
    constructorArguments: [RegistryAddressHolderD.address, UniswapAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("IdleLiquidityModuleV2")).address,
    constructorArguments: [RegistryAddressHolderD.address, UniswapAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("DepositRecipes")).address,
    constructorArguments: [RegistryAddressHolderD.address, UniswapAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("IncreaseLiquidityRecipes")).address,
    constructorArguments: [RegistryAddressHolderD.address, UniswapAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("WithdrawRecipes")).address,
    constructorArguments: [RegistryAddressHolderD.address, UniswapAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("GovernanceRecipes")).address,
    constructorArguments: [RegistryAddressHolderD.address, UniswapAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("RefundGasExpenseRecipes")).address,
    constructorArguments: [RegistryAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("PositionHelper")).address,
    constructorArguments: [RegistryAddressHolderD.address, UniswapAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("UniswapCalculator")).address,
    constructorArguments: [RegistryAddressHolderD.address, UniswapAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("ERC20Extended")).address,
    constructorArguments: [],
  });
  await run("verify:verify", {
    address: (await deployments.get("Timelock")).address,
    constructorArguments: [governance, 21600],
  });
};

export default Verify;
Verify.tags = ["Verify"];
Verify.dependencies = [
  // "Timelock",
  // "Registry",
  // "RegistryAddressHolder",
  // "DiamondCutFacet",
  // "UniswapAddressHolder",
  // "PositionManagerFactory",
  // "StrategyProviderWalletFactory",
  // "IdleLiquidityModule",
  // "DepositRecipes",
  // "IncreaseLiquidityRecipes",
  // "WithdrawRecipes",
  // "GovernanceRecipes",
  // "ClosePosition",
  // "IncreaseLiquidity",
  // "Mint",
  // "RepayRebalanceFee",
  // "ReturnProfit",
  // "ShareProfit",
  // "SingleTokenIncreaseLiquidity",
  // "SwapToPositionRatio",
  // "ZapIn",
  // "PositionHelper",
  // "UniswapCalculator",
  // "ERC20Extended",
];
