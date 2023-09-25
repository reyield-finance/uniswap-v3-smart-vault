import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "./000_Config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const chainId = await getChainId();

  const { deployer } = await getNamedAccounts();

  const registryAddressHolder = await deployments.get("RegistryAddressHolder");
  const uniswapAddressHolder = await deployments.get("UniswapAddressHolder");

  await deploy("GovernanceRecipes", {
    from: deployer,
    args: [registryAddressHolder.address, uniswapAddressHolder.address],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
    nonce: 19,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Deployed GovernanceRecipes: ", (await deployments.get("GovernanceRecipes")).address);
};

export default func;
func.tags = ["SmartVault", "Recipes", "GovernanceRecipes"];
func.dependencies = ["UniswapAddressHolder", "Registry"];
