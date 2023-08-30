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
  const { deployments, getChainId, getNamedAccounts } = hre;
  const chainId = await getChainId();
  const { deployer } = await getNamedAccounts();

  // const TimelockD = await deployments.get("Timelock");
  const RegistryD = await deployments.get("Registry");
  const DiamondCutFacetD = await deployments.get("DiamondCutFacet");
  const UniswapAddressHolderD = await deployments.get("UniswapAddressHolder");
  const PositionManagerFactoryD = await deployments.get("PositionManagerFactory");
  const StrategyProviderWalletFactoryD = await deployments.get("StrategyProviderWalletFactory");
  const IdleLiquidityModuleD = await deployments.get("IdleLiquidityModule");
  const DepositRecipesD = await deployments.get("DepositRecipes");
  const WithdrawRecipesD = await deployments.get("WithdrawRecipes");
  const GovernanceRecipesD = await deployments.get("GovernanceRecipes");
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

  const governanceRecipes = (await ethers.getContractAt(
    "GovernanceRecipes",
    GovernanceRecipesD.address,
  )) as GovernanceRecipes;

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

  await Registry.addNewContract(
    hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("GovernanceRecipes")),
    governanceRecipes.address,
    ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32),
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Added GovernanceRecipes to Registry");

  // ****************** Add keeper(s) to the whitelist ******************
  const { keeper } = await getNamedAccounts();
  await Registry.addKeeperToWhitelist(keeper, {
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
  /**
   * 1. close position
   */
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

  /**
   * 2. increase liquidity
   */
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

  /**
   * 3. mint
   */
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

  /**
   * 4. repay rebalance fee
   */
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

  /**
   * 5. return profit
   */
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

  /**
   * 6. share profit
   */
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

  /**
   * 7. single token increase liquidity
   */
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

  /**
   * 8. swap to position ratio
   */
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

  /**
   * 9. zap in
   */
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

  // verify
  const maxTwapDeviation = 300;
  const twapDuration = 3;
  const usdcAddress = Config[chainId].usdcAddress;
  const wethAddress = Config[chainId].wethAddress;
  await run("verify:verify", {
    address: (await deployments.get("Registry")).address,
    constructorArguments: [deployer, deployer, maxTwapDeviation, twapDuration, usdcAddress, wethAddress],
  });

  await run("verify:verify", {
    address: (await deployments.get("DiamondCutFacet")).address,
    constructorArguments: [],
  });

  await run("verify:verify", {
    address: (await deployments.get("Timelock")).address,
    constructorArguments: [deployer, 21600],
  });

  await run("verify:verify", {
    address: (await deployments.get("UniswapAddressHolder")).address,
    constructorArguments: [
      Config[chainId].nonfungiblePositionManager, //nonfungiblePositionManager address
      Config[chainId].uniswapV3Factory, //uniswapv3Factory address
      Config[chainId].swapRouter, //swapRouter address
      Registry.address,
    ],
  });

  await run("verify:verify", {
    address: (await deployments.get("PositionManagerFactory")).address,
    constructorArguments: [RegistryD.address, DiamondCutFacetD.address, UniswapAddressHolderD.address],
  });

  await run("verify:verify", {
    address: (await deployments.get("StrategyProviderWalletFactory")).address,
    constructorArguments: [RegistryD.address, UniswapAddressHolderD.address],
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
    address: (await deployments.get("IdleLiquidityModule")).address,
    constructorArguments: [RegistryD.address, UniswapAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("DepositRecipes")).address,
    constructorArguments: [RegistryD.address, UniswapAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("WithdrawRecipes")).address,
    constructorArguments: [RegistryD.address, UniswapAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("GovernanceRecipes")).address,
    constructorArguments: [RegistryD.address, UniswapAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("PositionHelper")).address,
    constructorArguments: [RegistryD.address, UniswapAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("UniswapCalculator")).address,
    constructorArguments: [RegistryD.address, UniswapAddressHolderD.address],
  });
  await run("verify:verify", {
    address: (await deployments.get("ERC20Extended")).address,
    constructorArguments: [],
  });
};

export default PostDeployScript;
PostDeployScript.tags = ["SmartVault", "PostDeploy"];
PostDeployScript.dependencies = [
  "Timelock",
  "Registry",
  "DiamondCutFacet",
  "UniswapAddressHolder",
  "PositionManagerFactory",
  "StrategyProviderWalletFactory",
  "IdleLiquidityModule",
  "DepositRecipes",
  "WithdrawRecipes",
  "GovernanceRecipes",
  "ClosePosition",
  "IncreaseLiquidity",
  "Mint",
  "RepayRebalanceFee",
  "ReturnProfit",
  "ShareProfit",
  "SingleTokenIncreaseLiquidity",
  "SwapToPositionRatio",
  "ZapIn",
  "PositionHelper",
  "UniswapCalculator",
  "ERC20Extended",
];
