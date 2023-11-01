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

  await deploy("WithdrawRecipes", {
    from: deployer,
    args: [registryAddressHolder.address, uniswapAddressHolder.address],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
    nonce: 21,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Deployed WithdrawRecipes: ", (await deployments.get("WithdrawRecipes")).address);
};

export default func;
func.tags = ["SmartVault", "Recipes", "WithdrawRecipes"];
func.dependencies = ["UniswapAddressHolder", "RegistryAddressHolder"];
