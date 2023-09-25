import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "./000_Config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();

  const maxTwapDeviation = 300;
  const twapDuration = 3;
  const usdcAddress = Config[chainId].usdcAddress;
  const wethAddress = Config[chainId].wethAddress;
  const { governance, serviceFeeRecipient, official, keeper } = await getNamedAccounts();
  await deploy("Registry", {
    from: deployer,
    args: [governance, serviceFeeRecipient, maxTwapDeviation, twapDuration, usdcAddress, wethAddress],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
    nonce: 0,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Deployed Registry: ", (await deployments.get("Registry")).address);
};

export default func;
func.tags = ["SmartVault", "Registry"];
