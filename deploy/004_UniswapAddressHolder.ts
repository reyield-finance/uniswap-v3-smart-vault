import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "./000_Config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const chainId = await getChainId();
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  const Registry = await deployments.get("Registry");

  await deploy("UniswapAddressHolder", {
    from: deployer,
    args: [
      "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", //nonfungiblePositionManager address
      "0x1F98431c8aD98523631AE4a59f267346ea31F984", //uniswapv3Factory address
      "0xE592427A0AEce92De3Edee1F18E0157C05861564", //swapRouter address
      Registry.address,
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
