import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "./000_Config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;
  const chainId = await getChainId();
  const { deployer } = await getNamedAccounts();

  const registry = await deployments.get("Registry");
  const uniAddressHolder = await deployments.get("UniswapAddressHolder");

  await deploy("StrategyProviderWalletFactory", {
    from: deployer,
    args: [registry.address, uniAddressHolder.address],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(
    ":: Deployed StrategyProviderWalletFactory: ",
    (await deployments.get("StrategyProviderWalletFactory")).address,
  );
};

export default func;
func.tags = ["SmartVault", "StrategyProviderWalletFactory"];
func.dependencies = ["Registry", "UniswapAddressHolder"];
