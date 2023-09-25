import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "./000_Config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;
  const chainId = await getChainId();
  const { deployer } = await getNamedAccounts();

  const registryAddressHolder = await deployments.get("RegistryAddressHolder");
  const diamondCutFacet = await deployments.get("DiamondCutFacet");
  const uniAddressHolder = await deployments.get("UniswapAddressHolder");

  await deploy("PositionManagerFactory", {
    from: deployer,
    args: [registryAddressHolder.address, uniAddressHolder.address, diamondCutFacet.address],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
    nonce: 4,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Deployed PositionManagerFactory: ", (await deployments.get("PositionManagerFactory")).address);
};

export default func;
func.tags = ["SmartVault", "PositionManagerFactory"];
func.dependencies = ["Registry", "DiamondCutFacet", "UniswapAddressHolder"];
