import { ethers } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "../000_Config";
import { IUniswapV3Pool } from "../../types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getChainId } = hre;

  const chainId = await getChainId();

  const Factory = await ethers.getContractAt("IUniswapV3Factory", Config[chainId].uniswapV3Factory);
  const PoolAddress = await Factory.getPool(Config[chainId].usdcAddress, Config[chainId].wethAddress, 500);

  const Pool = (await ethers.getContractAt("IUniswapV3Pool", PoolAddress)) as IUniswapV3Pool;
  await Pool.initialize("1846285263884419025099727028297127", {
    gasLimit: 10000000,
    gasPrice: ethers.utils.parseUnits("1", "gwei"),
  });
  await new Promise((resolve) => setTimeout(resolve, Config[chainId].sleep));
  const [, , , , , , unlocked] = await Pool.slot0();
  console.log("unlocked", unlocked.toString());
};

export default func;
func.tags = ["Test", "InitializePool"];
