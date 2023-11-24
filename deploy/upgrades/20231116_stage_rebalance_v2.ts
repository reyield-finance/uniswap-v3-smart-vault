import { ethers } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import config, { Config } from "../000_Config";
import deployClosePositionOneShot from "../015_ClosePositionOneShot";
import deployWithdrawNativeToken from "../016_WithdrawNativeToken";
import deployIdleLiquidityModuleV2 from "../019_IdleLiquidityModuleV2";
import deployRefundGasExpenseRecipes from "../024_RefundGasExpenseRecipes";
import { getSelectors } from "../../test/shared/fixtures";
import { ClosePositionOneShot, PositionManagerFactory, WithdrawNativeToken } from "../../types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const CONFIRMATIONS = 3;
  const { getChainId } = hre;
  const chainId = await getChainId();
  //XXX: before running this script
  //XXX: make sure that the "arguments" and "nonce" are correct in the following deploy scripts
  await config(hre);
  await deployClosePositionOneShot(hre);
  await deployWithdrawNativeToken(hre);
  await deployIdleLiquidityModuleV2(hre);
  await deployRefundGasExpenseRecipes(hre);

  const positionManagerFactory = (await ethers.getContractAt(
    "PositionManagerFactory",
    "0x9ff67463BDb860e51b8992ae35dee1896acDDd5b",
  )) as PositionManagerFactory;

  const closePositionOneShot = (await ethers.getContractAt(
    "ClosePositionOneShot",
    "0xdD9fFcDA84C27b8f4e982559ca779df9Aeee1162",
  )) as ClosePositionOneShot;
  // add actions to diamond cut
  let txn = await positionManagerFactory.updateActionData(
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
  txn = await positionManagerFactory.updateActionData(
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

  const pmLength = (await positionManagerFactory.getPositionManagersLength()).toNumber();
  const cursor = 0;
  const howMany = 100;
  let managerAddresses: string[] = [];

  for (let i = cursor; i < pmLength; i += howMany) {
    const { managers } = await positionManagerFactory.getPositionManagers(i, howMany);
    managerAddresses = managerAddresses.concat(managers);
  }

  console.log("managers", managerAddresses.length, managerAddresses);

  if (managerAddresses.length != pmLength) throw new Error("managers length mismatch");

  // for loop managerAddresses
  for (const managerAddress of managerAddresses) {
    const txn = await positionManagerFactory.updateDiamond(
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
