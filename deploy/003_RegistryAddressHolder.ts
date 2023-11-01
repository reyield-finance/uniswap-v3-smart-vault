import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "./000_Config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const chainId = await getChainId();
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  const Registry = await deployments.get("Registry");

  await deploy("RegistryAddressHolder", {
    from: deployer,
    args: [Registry.address],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
    nonce: 2,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Deployed RegistryAddressHolder: ", (await deployments.get("RegistryAddressHolder")).address);
};

export default func;
func.tags = ["SmartVault", "RegistryAddressHolder"];
func.dependencies = ["Registry"];
