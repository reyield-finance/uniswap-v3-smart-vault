import { ethers } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import config, { Config } from "../000_Config";
import { Registry, RegistryAddressHolder, UniswapAddressHolder } from "../../types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const CONFIRMATIONS = 3;
  const { getChainId, deployments } = hre;
  const { deploy } = deployments;
  const chainId = await getChainId();
  //!!!: deployer & governance must be different, otherwise one of them would be throw undefined error
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const governance = signers[1];
  //XXX: before running this script
  //XXX: make sure that the "arguments" and "nonce" are correct in the following deploy scripts
  await config(hre);
  const registryAddressHolder = (await ethers.getContractAt(
    "RegistryAddressHolder",
    "0x1BdcF8Fea00691B61a1fA48c4785A23E9a6b4180",
  )) as RegistryAddressHolder;
  const uniswapAddressHolder = (await ethers.getContractAt(
    "UniswapAddressHolder",
    "0xC847FD0bFADCAb154FDFAD397BA236280C45239E",
  )) as UniswapAddressHolder;

  await deploy("IncreaseLiquidityRecipes", {
    from: deployer.address,
    args: [registryAddressHolder.address, uniswapAddressHolder.address],
    log: true,
    autoMine: true,
    gasLimit: Config[chainId].gasLimit,
    gasPrice: Config[chainId].gasPrice,
  });

  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  console.log(":: Deployed IncreaseLiquidityRecipes: ", (await deployments.get("IncreaseLiquidityRecipes")).address);

  const registry = (await ethers.getContractAt("Registry", "0xbAC6d4e5333034B6B7B16a480Caab522A2Fb6138")) as Registry;

  const IncreaseLiquidityRecipesD = await deployments.get("IncreaseLiquidityRecipes"); // contractAddresses are string[]
  const contractAddresses = [{ name: "IncreaseLiquidityRecipes", address: IncreaseLiquidityRecipesD.address }];

  // for each contract address
  for (const contractAddress of contractAddresses) {
    const isActiveModule = await registry.connect(governance).activeModule(contractAddress.address, {
      gasLimit: Config[chainId].gasLimit,
      gasPrice: Config[chainId].gasPrice,
    });
    if (isActiveModule) {
      console.log(`${contractAddress} is already in whitelist!`);
      continue;
    }

    const txn = await registry
      .connect(governance)
      .changeContract(ethers.utils.keccak256(ethers.utils.toUtf8Bytes(contractAddress.name)), contractAddress.address);
    console.log(`changeContract txn hash: ${txn.hash}...`);
    await txn.wait(CONFIRMATIONS);

    console.log(`changeContract txn confirmed!`);
  }
};

export default func;
func.tags = ["20231213_stage_update_increaseLiquidityRecipes"];
