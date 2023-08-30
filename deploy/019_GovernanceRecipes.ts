import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "./000_Config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const chainId = await getChainId();

  const { deployer } = await getNamedAccounts();

  const UniswapAddressHolder = await deployments.get("UniswapAddressHolder");
  const registry = await deployments.get("Registry");

  await deploy("GovernanceRecipes", {
    from: deployer,
    args: [registry.address, UniswapAddressHolder.address],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
    nonce: 18,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Deployed GovernanceRecipes: ", (await deployments.get("GovernanceRecipes")).address);
};

export default func;
func.tags = ["SmartVault", "Recipes", "GovernanceRecipes"];
func.dependencies = ["UniswapAddressHolder", "Registry"];
