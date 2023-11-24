import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "./000_Config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const chainId = await getChainId();
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  const RegistryAddressHolder = await deployments.get("RegistryAddressHolder");

  await deploy("UniswapAddressHolder", {
    from: deployer,
    args: [
      RegistryAddressHolder.address,
      Config[chainId].nonfungiblePositionManager, //nonfungiblePositionManager address
      Config[chainId].uniswapV3Factory, //uniswapv3Factory address
      Config[chainId].swapRouter, //swapRouter address
    ],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Deployed UniswapAddressHolder: ", (await deployments.get("UniswapAddressHolder")).address);
};

export default func;
func.tags = ["SmartVault", "UniswapAddressHolder"];
func.dependencies = ["Registry"];
