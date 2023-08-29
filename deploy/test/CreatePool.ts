import UniswapV3Factoryjson from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import { ethers } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "../000_Config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getChainId } = hre;

  const chainId = await getChainId();

  const [deployer] = await hre.ethers.getSigners();

  const uniswapFactoryFactory = new ethers.ContractFactory(
    UniswapV3Factoryjson["abi"],
    UniswapV3Factoryjson["bytecode"],
    deployer,
  );
  const uniswapFactory = await uniswapFactoryFactory.deploy();
  await uniswapFactory.deployed();

  await uniswapFactory.createPool(Config[chainId].usdcAddress, Config[chainId].wethAddress, 500, {
    gasLimit: 10000000,
    gasPrice: ethers.utils.parseUnits("1", "gwei"),
  });
  console.log("Factory", uniswapFactory.address);
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));

  const PoolAddress = await uniswapFactory.getPool(Config[chainId].usdcAddress, Config[chainId].wethAddress, 500);
  console.log("PoolAddress", PoolAddress);
};

export default func;
func.tags = ["Test", "CreatePool"];
