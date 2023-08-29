import { ethers } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  await deploy("MockToken", {
    from: deployer,
    args: ["REYIELD", "USDC", 6],
    log: true,
    autoMine: true,
    gasLimit: 1000000,
    gasPrice: ethers.utils.parseUnits("1", "gwei"),
  });

  const MockTokenDepolyment = await deployments.get("MockToken");
  console.log("MockToken", MockTokenDepolyment.address);
  const MockToken = await ethers.getContractAt("MockToken", MockTokenDepolyment.address);
  await MockToken.mint(deployer, ethers.utils.parseEther("1000000000000000000000"));

  console.log("MockToken balance", (await MockToken.balanceOf(deployer)).toString());
};

export default func;
func.tags = ["Test", "USDC"];
