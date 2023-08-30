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

  await deploy("PositionHelper", {
    from: deployer,
    args: [registry.address, UniswapAddressHolder.address],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
    nonce: 19,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Deployed PositionHelper: ", (await deployments.get("PositionHelper")).address);
};

export default func;
func.tags = ["SmartVault", "Utils", "PositionHelper"];
func.dependencies = ["UniswapAddressHolder", "Registry"];
