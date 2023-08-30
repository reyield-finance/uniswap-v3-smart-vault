import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "./000_Config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const chainId = await getChainId();
  const { deployer } = await getNamedAccounts();

  await deploy("Mint", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
    nonce: 8,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Deployed Mint: ", (await deployments.get("Mint")).address);
};

export default func;
func.tags = ["SmartVault", "Action", "Mint"];
func.dependencies = ["PositionManagerFactory"];
