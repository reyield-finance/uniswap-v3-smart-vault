import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "./000_Config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const chainId = await getChainId();
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const governance = Config[chainId].governance;

  await deploy("Timelock", {
    from: deployer,
    args: [governance, 21600],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
    nonce: 2,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Deployed Timelock: ", (await deployments.get("Timelock")).address);
};

export default func;
func.tags = ["SmartVault", "Timelock"];
