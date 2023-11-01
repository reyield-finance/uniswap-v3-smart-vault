import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "./000_Config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const chainId = await getChainId();

  const { deployer } = await getNamedAccounts();

  const registryAddressHolder = await deployments.get("RegistryAddressHolder");

  await deploy("RefundGasExpenseRecipes", {
    from: deployer,
    args: [registryAddressHolder.address],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
    nonce: 23,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Deployed RefundGasExpenseRecipes: ", (await deployments.get("RefundGasExpenseRecipes")).address);
};

export default func;
func.tags = ["SmartVault", "Recipes", "RefundGasExpenseRecipes"];
func.dependencies = ["RegistryAddressHolder"];
