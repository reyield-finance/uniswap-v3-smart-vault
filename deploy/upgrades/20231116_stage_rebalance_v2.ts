import { ethers } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import config, { Config } from "../000_Config";
import deployClosePositionOneShot from "../015_ClosePositionOneShot";
import deployWithdrawNativeToken from "../016_WithdrawNativeToken";
import deployIdleLiquidityModuleV2 from "../019_IdleLiquidityModuleV2";
import deployRefundGasExpenseRecipes from "../025_RefundGasExpenseRecipes";
import { getSelectors } from "../../test/shared/fixtures";
import { ClosePositionOneShot, PositionManagerFactory, WithdrawNativeToken } from "../../types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const CONFIRMATIONS = 3;
  const { getChainId } = hre;
  const chainId = await getChainId();

  //!!! deployer & governance must be different, otherwise one of them would be throw undefined error
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const governance = signers[1];
  //XXX: before running this script
  //XXX: make sure that the "arguments" and "nonce" are correct in the following deploy scripts
  await config(hre);
  await deployClosePositionOneShot(hre);
  await deployWithdrawNativeToken(hre);
  await deployIdleLiquidityModuleV2(hre);
  await deployRefundGasExpenseRecipes(hre);

  const registry = (await ethers.getContractAt("Registry", "0x621e848F39fb29843cf8b42c86Ff2558bCd6C327")) as Registry;

  // contractAddrsses are string[]
  const contractAddrsses = [
    { name: "IdleLiquidityModuleV2", address: "0x1c354B9cE94b19f620BEAeb0fBf1C13EAa0Bae13" },
    { name: "RefundGasExpenseRecipes", address: "0x4A89f17109651C1216e93E058e285D6e74618C28" },
  ];

  // for each contract address
  for (const contractAddress of contractAddrsses) {
    const isActiveModule = await registry.connect(governance).activeModule(contractAddress.address);
    if (isActiveModule) {
      console.log(`${contractAddress} is already in whitelist!`);
      continue;
    }
    const txn = await registry
      .connect(governance)
      .addNewContract(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes(contractAddress.name)),
        contractAddress.address,
        ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32),
      );
    console.log(`addNewContract txn hash: ${txn.hash}...`);
    await txn.wait(CONFIRMATIONS);

    console.log(`addNewContract txn confirmed!`);
  }

  const positionManagerFactory = (await ethers.getContractAt(
    "PositionManagerFactory",
    "0x9ff67463BDb860e51b8992ae35dee1896acDDd5b",
  )) as PositionManagerFactory;

  const closePositionOneShot = (await ethers.getContractAt(
    "ClosePositionOneShot",
    "0xdD9fFcDA84C27b8f4e982559ca779df9Aeee1162",
  )) as ClosePositionOneShot;
  // add actions to diamond cut
  let txn = await positionManagerFactory.connect(governance).updateActionData(
    {
      facetAddress: closePositionOneShot.address,
      action: 0,
      functionSelectors: await getSelectors(closePositionOneShot),
    },
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );
  await txn.wait(CONFIRMATIONS);
  console.log(":: Added ClosePositionOneShot to PositionManagerFactory");

  const withdrawNativeToken = (await ethers.getContractAt(
    "WithdrawNativeToken",
    "0xE5ec876520e6a8c812aBb849d3c36fC463d58940",
  )) as WithdrawNativeToken;
  // add actions to diamond cut
  txn = await positionManagerFactory.connect(governance).updateActionData(
    {
      facetAddress: withdrawNativeToken.address,
      action: 0,
      functionSelectors: await getSelectors(withdrawNativeToken),
    },
    {
      gasPrice: Config[chainId].gasPrice,
      gasLimit: Config[chainId].gasLimit,
    },
  );
  await txn.wait(CONFIRMATIONS);
  console.log(":: Added WithdrawNativeToken to PositionManagerFactory");

  const pmLength = (await positionManagerFactory.connect(governance).getPositionManagersLength()).toNumber();
  const cursor = 0;
  const howMany = 100;
  let managerAddresses: string[] = [];

  for (let i = cursor; i < pmLength; i += howMany) {
    const { managers } = await positionManagerFactory.connect(governance).getPositionManagers(i, howMany);
    managerAddresses = managerAddresses.concat(managers);
  }

  console.log("managers", managerAddresses.length, managerAddresses);

  if (managerAddresses.length != pmLength) throw new Error("managers length mismatch");

  // for loop managerAddresses
  for (const managerAddress of managerAddresses) {
    const txn = await positionManagerFactory.connect(governance).updateDiamond(
      managerAddress,
      [
        {
          facetAddress: closePositionOneShot.address,
          action: 0,
          functionSelectors: await getSelectors(closePositionOneShot),
        },
        {
          facetAddress: withdrawNativeToken.address,
          action: 0,
          functionSelectors: await getSelectors(withdrawNativeToken),
        },
      ],
      {
        gasPrice: Config[chainId].gasPrice,
        gasLimit: Config[chainId].gasLimit,
      },
    );

    await txn.wait(CONFIRMATIONS);
    console.log(":: Update Diamond ClosePositionOneShot & WithdrawNativeToken to PositionManager");

    console.log(">>>>managerCompleted: ", managerAddress);
  }
};

export default func;
func.tags = ["20231116_stage_rebalance_v2"];
