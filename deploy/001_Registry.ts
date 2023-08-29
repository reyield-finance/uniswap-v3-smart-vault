import { run } from "hardhat";
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

  await deploy("Registry", {
    from: deployer,
    args: [deployer, deployer, maxTwapDeviation, twapDuration, usdcAddress, wethAddress],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Deployed Registry: ", (await deployments.get("Registry")).address);
  console.log(`Verifying contract on Etherscan...`);
  await run("verify:verify", {
    address: (await deployments.get("Registry")).address,
    constructorArguments: [deployer, deployer, maxTwapDeviation, twapDuration, usdcAddress, wethAddress],
  });
  console.log(`Verifying contract on Etherscan finished.`);
};

export default func;
func.tags = ["SmartVault", "Registry"];
