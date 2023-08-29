import { ethers } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getSelectors } from "../test/shared/fixtures";
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
import { Config } from "./000_Config";

const PostDeployScript: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // 1. add modules, recipes and keepers on the registry
  // 2. set timelock as registry governance
  // 3. change governance from deployer on PM Factory
  const { deployments, getChainId } = hre;
  const chainId = await getChainId();

  // const TimelockD = await deployments.get("Timelock");
  const RegistryD = await deployments.get("Registry");
  const PositionManagerFactoryD = await deployments.get("PositionManagerFactory");
  const StrategyProviderWalletFactoryD = await deployments.get("StrategyProviderWalletFactory");
  const IdleLiquidityModuleD = await deployments.get("IdleLiquidityModule");
  const DepositRecipesD = await deployments.get("DepositRecipes");
  const WithdrawRecipesD = await deployments.get("WithdrawRecipes");
  const ClosePositionD = await deployments.get("ClosePosition");
  const IncreaseLiquidityD = await deployments.get("IncreaseLiquidity");
  const MintD = await deployments.get("Mint");
  const RepayRebalanceFeeD = await deployments.get("RepayRebalanceFee");
  const ReturnProfitD = await deployments.get("ReturnProfit");
  const ShareProfitD = await deployments.get("ShareProfit");
  const SingleTokenIncreaseLiquidityD = await deployments.get("SingleTokenIncreaseLiquidity");
  const SwapToPositionRatioD = await deployments.get("SwapToPositionRatio");
  const ZapInD = await deployments.get("ZapIn");

  const Registry = (await ethers.getContractAt("Registry", RegistryD.address)) as Registry;

  // ******************** Set positionManagerFactory & strategyProviderWalletFactory to registry ********************
  await Registry.setPositionManagerFactory(PositionManagerFactoryD.address, {
    gasPrice: Config[chainId].gasPrice,
    gasLimit: Config[chainId].gasLimit,
  });
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Set PositionManagerFactory to Registry");

  await Registry.setStrategyProviderWalletFactory(StrategyProviderWalletFactoryD.address, {
    gasPrice: Config[chainId].gasPrice,
    gasLimit: Config[chainId].gasLimit,
  });
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Set StrategyProviderWalletFactory to Registry");

  // ******************** Add modules and recipes and factory to registry ********************
  const positionManagerFactory = (await ethers.getContractAt(
    "PositionManagerFactory",
    PositionManagerFactoryD.address,
  )) as PositionManagerFactory;

  const idleLiquidityModule = (await ethers.getContractAt(
    "IdleLiquidityModule",
    IdleLiquidityModuleD.address,
  )) as IdleLiquidityModule;

  const depositRecipes = (await ethers.getContractAt("DepositRecipes", DepositRecipesD.address)) as DepositRecipes;

  const withdrawRecipes = (await ethers.getContractAt("WithdrawRecipes", WithdrawRecipesD.address)) as WithdrawRecipes;

  await Registry.addNewContract(
    hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("PositionManagerFactory")),
    positionManagerFactory.address,
    ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32),
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added PositionManagerFactory to Registry");

  await Registry.addNewContract(
    hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("IdleLiquidityModule")),
    idleLiquidityModule.address,
    ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32),
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added IdleLiquidityModule to Registry");

  await Registry.addNewContract(
    hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("DepositRecipes")),
    depositRecipes.address,
    ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32),
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added DepositRecipes to Registry");

  await Registry.addNewContract(
    hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("WithdrawRecipes")),
    withdrawRecipes.address,
    ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32),
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added WithdrawRecipes to Registry");

  // ****************** Add keeper(s) to the whitelist ******************
  const keeperAddress = "0xb86659C1010f60CC3fDE9EF90C9d3D71C537A526";
  await Registry.addKeeperToWhitelist(keeperAddress, {
    gasPrice: Config[chainId].gasPrice,
    gasLimit: Config[chainId].gasLimit,
  });
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added keeper to Registry keeper whitelist");

  // ****************** Add creator to StrategyProviderWalletFactory  ******************
  const strategyProviderWalletFactory = (await ethers.getContractAt(
    "StrategyProviderWalletFactory",
    StrategyProviderWalletFactoryD.address,
  )) as StrategyProviderWalletFactory;

  await strategyProviderWalletFactory.addCreatorWhitelist(PositionManagerFactoryD.address, {
    gasPrice: Config[chainId].gasPrice,
    gasLimit: Config[chainId].gasLimit,
  });
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added creator to StrategyProviderWalletFactory whitelist");

  // ****************** Add Actions to PositionManagerFactory  ******************
  //close position
  const closePosition = (await ethers.getContractAt("ClosePosition", ClosePositionD.address)) as ClosePosition;

  // add actions to diamond cut
  await positionManagerFactory.updateActionData(
    {
      facetAddress: closePosition.address,
      action: 0,
      functionSelectors: await getSelectors(closePosition),
    },
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added ClosePosition to PositionManagerFactory");

  //increase liquidity
  const increaseLiquidity = (await ethers.getContractAt(
    "IncreaseLiquidity",
    IncreaseLiquidityD.address,
  )) as IncreaseLiquidity;

  // add actions to diamond cut
  await positionManagerFactory.updateActionData(
    {
      facetAddress: increaseLiquidity.address,
      action: 0,
      functionSelectors: await getSelectors(increaseLiquidity),
    },
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added IncreaseLiquidity to PositionManagerFactory");

  //mint
  const mint = (await ethers.getContractAt("Mint", MintD.address)) as Mint;

  // add actions to diamond cut
  await positionManagerFactory.updateActionData(
    {
      facetAddress: mint.address,
      action: 0,
      functionSelectors: await getSelectors(mint),
    },
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added Mint to PositionManagerFactory");

  //repay rebalance fee
  const repayRebalanceFee = (await ethers.getContractAt(
    "RepayRebalanceFee",
    RepayRebalanceFeeD.address,
  )) as RepayRebalanceFee;

  // add actions to diamond cut
  await positionManagerFactory.updateActionData(
    {
      facetAddress: repayRebalanceFee.address,
      action: 0,
      functionSelectors: await getSelectors(repayRebalanceFee),
    },
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added RepayRebalanceFee to PositionManagerFactory");

  //return profit
  const returnProfit = (await ethers.getContractAt("ReturnProfit", ReturnProfitD.address)) as ReturnProfit;

  // add actions to diamond cut
  await positionManagerFactory.updateActionData(
    {
      facetAddress: returnProfit.address,
      action: 0,
      functionSelectors: await getSelectors(returnProfit),
    },
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added ReturnProfit to PositionManagerFactory");

  //share profit
  const shareProfit = (await ethers.getContractAt("ShareProfit", ShareProfitD.address)) as ShareProfit;

  // add actions to diamond cut
  await positionManagerFactory.updateActionData(
    {
      facetAddress: shareProfit.address,
      action: 0,
      functionSelectors: await getSelectors(shareProfit),
    },
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added ShareProfit to PositionManagerFactory");

  //single token increase liquidity
  const singleTokenIncreaseLiquidity = (await ethers.getContractAt(
    "SingleTokenIncreaseLiquidity",
    SingleTokenIncreaseLiquidityD.address,
  )) as SingleTokenIncreaseLiquidity;

  // add actions to diamond cut
  await positionManagerFactory.updateActionData(
    {
      facetAddress: singleTokenIncreaseLiquidity.address,
      action: 0,
      functionSelectors: await getSelectors(singleTokenIncreaseLiquidity),
    },
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added SingleTokenIncreaseLiquidity to PositionManagerFactory");

  //swap to position ratio
  const swapToPositionRatio = (await ethers.getContractAt(
    "SwapToPositionRatio",
    SwapToPositionRatioD.address,
  )) as SwapToPositionRatio;

  // add actions to diamond cut
  await positionManagerFactory.updateActionData(
    {
      facetAddress: swapToPositionRatio.address,
      action: 0,
      functionSelectors: await getSelectors(swapToPositionRatio),
    },
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added SwapToPositionRatio to PositionManagerFactory");

  //zap in
  const zapIn = (await ethers.getContractAt("ZapIn", ZapInD.address)) as ZapIn;

  // add actions to diamond cut
  await positionManagerFactory.updateActionData(
    {
      facetAddress: zapIn.address,
      action: 0,
      functionSelectors: await getSelectors(zapIn),
    },
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added ZapIn to PositionManagerFactory");

  // Set  Registry owner to Timelock
  // const Timelock = (await ethers.getContractAt("Timelock", TimelockD.address)) as Timelock;
  // await Registry.changeGovernance(Timelock.address, {
  //   gasPrice: Config[chainId].gasPrice,
  //   gasLimit: Config[chainId].gasLimit,
  // });
  // await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  // console.log(":: Changed Registry governance to Timelock");
};

export default PostDeployScript;
PostDeployScript.tags = ["SmartVault", "PostDeploy"];
PostDeployScript.dependencies = [
  "Timelock",
  "Registry",
  "PositionManagerFactory",
  "StrategyProviderWalletFactory",
  "IdleLiquidityModule",
  "DepositRecipes",
  "WithdrawRecipes",
  "ClosePosition",
  "IncreaseLiquidity",
  "Mint",
  "RepayRebalanceFee",
  "ReturnProfit",
  "ShareProfit",
  "SingleTokenIncreaseLiquidity",
  "SwapToPositionRatio",
  "ZapIn",
];
