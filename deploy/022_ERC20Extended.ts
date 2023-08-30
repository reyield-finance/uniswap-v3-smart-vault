import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "./000_Config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const chainId = await getChainId();

  const { deployer } = await getNamedAccounts();

  await deploy("ERC20Extended", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
    nonce: 21,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Deployed ERC20Extended: ", (await deployments.get("ERC20Extended")).address);
};

export default func;
func.tags = ["SmartVault", "Utils", "ERC20Extended"];
