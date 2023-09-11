import "@nomiclabs/hardhat-ethers";
import { expect } from "chai";
import { Signer } from "ethers";
import { AbiCoder } from "ethers/lib/utils";
import hre, { ethers } from "hardhat";

import { DepositRecipes, IdleLiquidityModule, MockToken, Registry, WithdrawRecipes } from "../types";
import { RegistryFixture, tokensFixture } from "./shared/fixtures";

describe("Registry.sol", function () {
  let deployer: Signer;
  let user: Signer;
  let serviceFeeRecipient: Signer;
  let usdValueTokenAddress: MockToken;
  let weth: MockToken;
  let Registry: Registry;
  let ILM: IdleLiquidityModule;
  let DR: DepositRecipes;
  let WR: WithdrawRecipes;
  let abiCoder: AbiCoder;

  const dummyAddress: string = "0x0000000000000000000000000000000000000001";
  const dummyAddress2: string = "0x0000000000000000000000000000000000000002";

  async function deployRegistry() {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];
    serviceFeeRecipient = signers[2];

    usdValueTokenAddress = (await tokensFixture("USDC", 6)).tokenFixture;
    weth = (await tokensFixture("WETH", 18)).tokenFixture;

    //deploy the registry
    Registry = (
      await RegistryFixture(
        await deployer.getAddress(),
        await serviceFeeRecipient.getAddress(),
        500,
        4,
        usdValueTokenAddress.address,
        weth.address,
      )
    ).registryFixture;
  }

  async function deployModules() {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];
    serviceFeeRecipient = signers[2];

    //Deploy modules
    const IdleLiquidityModuleFactory = await ethers.getContractFactory("IdleLiquidityModule");
    ILM = (await IdleLiquidityModuleFactory.deploy(
      Registry.address,
      "0x0000000000000000000000000000000000000001", //we don't need this contract for this test
    )) as IdleLiquidityModule;

    const DepositRecipesFactory = await ethers.getContractFactory("DepositRecipes");
    DR = (await DepositRecipesFactory.deploy(
      Registry.address,
      "0x0000000000000000000000000000000000000001", //we don't need this contract for this test
    )) as DepositRecipes;

    const WithdrawRecipesFactory = await ethers.getContractFactory("WithdrawRecipes");
    WR = (await WithdrawRecipesFactory.deploy(
      Registry.address,
      "0x0000000000000000000000000000000000000001", //we don't need this contract for this test
    )) as WithdrawRecipes;
  }

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];
    serviceFeeRecipient = signers[2];

    await deployRegistry();
    await deployModules();

    abiCoder = ethers.utils.defaultAbiCoder;
  });

  describe("Deployment", function () {
    // Constructor
    it("Constructor", async function () {
      expect(await Registry.governance()).to.be.equal(await deployer.getAddress());
      expect(await Registry.serviceFeeRecipient()).to.be.equal(await serviceFeeRecipient.getAddress());
      expect(await Registry.usdValueTokenAddress()).to.be.equal(usdValueTokenAddress.address);
      expect(await Registry.weth9()).to.be.equal(weth.address);
    });
  });

  describe("FeeTier", function () {
    it("Should init success", async function () {
      const feeTiers: number[] = await Registry.getFeeTiers();

      expect(feeTiers[0]).to.be.equal(100);
      expect(feeTiers[1]).to.be.equal(500);
      expect(feeTiers[2]).to.be.equal(3000);
      expect(feeTiers[3]).to.be.equal(10000);

      expect(await Registry.allowableFeeTiers(0)).to.be.false;
      expect(await Registry.allowableFeeTiers(100)).to.be.true;
      expect(await Registry.allowableFeeTiers(500)).to.be.true;
      expect(await Registry.allowableFeeTiers(3000)).to.be.true;
      expect(await Registry.allowableFeeTiers(10000)).to.be.true;
      expect(await Registry.allowableFeeTiers(10001)).to.be.false;
    });

    it("Should activate & deactivate success", async function () {
      await Registry.activateFeeTier(200);
      expect(await Registry.allowableFeeTiers(200)).to.be.true;

      await Registry.deactivateFeeTier(100);
      expect(await Registry.allowableFeeTiers(100)).to.be.false;

      const newFeeTiers: number[] = await Registry.getFeeTiers();
      expect(newFeeTiers[0]).to.be.equal(200);
      expect(newFeeTiers[1]).to.be.equal(500);
      expect(newFeeTiers[2]).to.be.equal(3000);
      expect(newFeeTiers[3]).to.be.equal(10000);

      expect(await Registry.isAllowableFeeTier(100)).to.be.false;
      expect(await Registry.isAllowableFeeTier(200)).to.be.true;
      expect(await Registry.isAllowableFeeTier(500)).to.be.true;
      expect(await Registry.isAllowableFeeTier(3000)).to.be.true;
      expect(await Registry.isAllowableFeeTier(10000)).to.be.true;
    });

    it("Should fail if not governance activate & deactivate", async function () {
      await expect(Registry.connect(user).activateFeeTier(300)).to.be.revertedWith("ROG");
      await expect(Registry.connect(user).deactivateFeeTier(300)).to.be.revertedWith("ROG");
    });
  });

  describe("ServiceFee", function () {
    // Service fee
    it("Should init success", async function () {
      expect(await Registry.licnesesToServiceFeeRatio(1)).to.be.equal(15_000_000);
      expect(await Registry.licnesesToServiceFeeRatio(3)).to.be.equal(12_662_384);
      expect(await Registry.licnesesToServiceFeeRatio(19)).to.be.equal(3_265_195);
      expect(await Registry.licnesesToServiceFeeRatio(20)).to.be.equal(3_000_000);
      expect(await Registry.getServiceFeeRatioFromLicenseAmount(1)).to.be.equal(15_000_000);
      expect(await Registry.getServiceFeeRatioFromLicenseAmount(21)).to.be.equal(3_000_000);
      expect(await Registry.getServiceFeeRatioFromLicenseAmount(30)).to.be.equal(3_000_000);

      await Registry.setServiceFeeRatio(1, 10);
      expect(await Registry.getServiceFeeRatioFromLicenseAmount(1)).to.be.equal(10);
      await Registry.setServiceFeeRatio(22, 3);
      expect(await Registry.getServiceFeeRatioFromLicenseAmount(21)).to.be.equal(0);
      expect(await Registry.getServiceFeeRatioFromLicenseAmount(22)).to.be.equal(3);
      expect(await Registry.getServiceFeeRatioFromLicenseAmount(30)).to.be.equal(3);
    });
  });

  describe("Module", async function () {
    it("Should success if governance add new module", async function () {
      const limID = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("IdleLiquidityModule"));
      await Registry.connect(deployer).addNewContract(limID, ILM.address, hre.ethers.utils.formatBytes32String("1"));
      const moduleInfo = await Registry.getModuleInfo(limID);

      expect(moduleInfo.contractAddress).to.be.equal(ILM.address);
      expect(moduleInfo.defaultData).to.be.equal(hre.ethers.utils.formatBytes32String("1"));

      const drID = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("DepositRecipes"));
      await Registry.connect(deployer).addNewContract(drID, DR.address, hre.ethers.utils.formatBytes32String("2"));
      const moduleInfo2 = await Registry.getModuleInfo(drID);

      expect(moduleInfo2.contractAddress).to.be.equal(DR.address);
      expect(moduleInfo2.defaultData).to.be.equal(hre.ethers.utils.formatBytes32String("2"));

      const wrID = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("WithdrawRecipes"));
      await Registry.connect(deployer).addNewContract(wrID, WR.address, hre.ethers.utils.formatBytes32String("3"));
      const moduleInfo3 = await Registry.getModuleInfo(wrID);

      expect(moduleInfo3.contractAddress).to.be.equal(WR.address);
      expect(moduleInfo3.defaultData).to.be.equal(hre.ethers.utils.formatBytes32String("3"));
    });

    it("Should success if governance remove module", async function () {
      const limID = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("IdleLiquidityModule"));
      await Registry.connect(deployer).addNewContract(limID, ILM.address, hre.ethers.utils.formatBytes32String("1"));
      const moduleInfo = await Registry.getModuleInfo(limID);

      expect(moduleInfo.contractAddress).to.be.equal(ILM.address);
      expect(moduleInfo.defaultData).to.be.equal(hre.ethers.utils.formatBytes32String("1"));

      await Registry.connect(deployer).removeContract(limID);
      const module2Info = await Registry.getModuleInfo(limID);

      expect(module2Info.contractAddress).to.be.equal(hre.ethers.constants.AddressZero);
      expect(module2Info.defaultData).to.be.equal(hre.ethers.constants.HashZero);
    });

    it("Should success if governance change module", async function () {
      const limID = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("IdleLiquidityModule"));
      await Registry.connect(deployer).addNewContract(limID, ILM.address, hre.ethers.utils.formatBytes32String("1"));
      const moduleInfo = await Registry.getModuleInfo(limID);
      expect(moduleInfo.contractAddress).to.be.equal(ILM.address);
      expect(moduleInfo.defaultData).to.be.equal(hre.ethers.utils.formatBytes32String("1"));

      await Registry.connect(deployer).changeContract(limID, DR.address);
      const module2Info = await Registry.getModuleInfo(limID);

      expect(module2Info.contractAddress).to.be.equal(DR.address);
      expect(module2Info.defaultData).to.be.equal(hre.ethers.utils.formatBytes32String("1"));
    });

    it("Should success if governance set module default data", async function () {
      const limID = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("IdleLiquidityModule"));
      await Registry.connect(deployer).addNewContract(limID, ILM.address, abiCoder.encode(["uint256"], ["69"]));
      const moduleInfo = await Registry.getModuleInfo(limID);
      expect(moduleInfo.contractAddress).to.be.equal(ILM.address);
      expect(moduleInfo.defaultData).to.be.equal(abiCoder.encode(["uint256"], ["69"]));

      await Registry.connect(deployer).setDefaultData(limID, abiCoder.encode(["uint256"], [100]));
      const module2Info = await Registry.getModuleInfo(limID);

      expect(module2Info.contractAddress).to.be.equal(ILM.address);
      expect(module2Info.defaultData).to.be.equal(abiCoder.encode(["uint256"], [100]));
    });

    it("Should fail if not governance add new module", async function () {
      const limID = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("IdleLiquidityModule"));
      await expect(
        Registry.connect(user).addNewContract(limID, ILM.address, hre.ethers.utils.formatBytes32String("1")),
      ).to.be.revertedWith("ROG");
    });

    it("Should fail if not governance remove module", async function () {
      const limID = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("IdleLiquidityModule"));
      await Registry.connect(deployer).addNewContract(limID, ILM.address, hre.ethers.utils.formatBytes32String("1"));
      const moduleInfo = await Registry.getModuleInfo(limID);

      expect(moduleInfo.contractAddress).to.be.equal(ILM.address);
      expect(moduleInfo.defaultData).to.be.equal(hre.ethers.utils.formatBytes32String("1"));

      await expect(Registry.connect(user).removeContract(limID)).to.be.revertedWith("ROG");
    });

    it("Should fail if not governance change module", async function () {
      const limID = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("IdleLiquidityModule"));
      await Registry.connect(deployer).addNewContract(limID, ILM.address, hre.ethers.utils.formatBytes32String("1"));
      const moduleInfo = await Registry.getModuleInfo(limID);
      expect(moduleInfo.contractAddress).to.be.equal(ILM.address);
      expect(moduleInfo.defaultData).to.be.equal(hre.ethers.utils.formatBytes32String("1"));

      await expect(Registry.connect(user).changeContract(limID, DR.address)).to.be.revertedWith("ROG");
    });

    it("Should fail if not governance set module default data", async function () {
      const limID = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("IdleLiquidityModule"));
      await Registry.connect(deployer).addNewContract(limID, ILM.address, hre.ethers.utils.formatBytes32String("1"));
      const moduleInfo = await Registry.getModuleInfo(limID);
      expect(moduleInfo.contractAddress).to.be.equal(ILM.address);
      expect(moduleInfo.defaultData).to.be.equal(hre.ethers.utils.formatBytes32String("1"));

      await expect(
        Registry.connect(user).setDefaultData(limID, hre.ethers.utils.formatBytes32String("2")),
      ).to.be.revertedWith("ROG");
    });
  });

  describe("Keepers", async function () {
    it("Should success if governance add new keeper", async function () {
      expect(await Registry.whitelistedKeepers(dummyAddress)).to.be.false;
      expect(await Registry.whitelistedKeepers(dummyAddress2)).to.be.false;
      await Registry.connect(deployer).addKeeperToWhitelist(dummyAddress);
      await Registry.connect(deployer).addKeeperToWhitelist(dummyAddress2);
      expect(await Registry.whitelistedKeepers(dummyAddress)).to.be.true;
      expect(await Registry.whitelistedKeepers(dummyAddress2)).to.be.true;
    });

    it("Should success if governance remove keeper", async function () {
      await Registry.connect(deployer).addKeeperToWhitelist(dummyAddress);
      await Registry.connect(deployer).addKeeperToWhitelist(dummyAddress2);
      expect(await Registry.whitelistedKeepers(dummyAddress)).to.be.true;
      expect(await Registry.whitelistedKeepers(dummyAddress2)).to.be.true;
      await Registry.connect(deployer).removeKeeperFromWhitelist(dummyAddress);
      await Registry.connect(deployer).removeKeeperFromWhitelist(dummyAddress2);
      expect(await Registry.whitelistedKeepers(dummyAddress)).to.be.false;
      expect(await Registry.whitelistedKeepers(dummyAddress2)).to.be.false;
    });

    it("Should fail if not governance add new keeper", async function () {
      await expect(Registry.connect(user).addKeeperToWhitelist(dummyAddress)).to.be.revertedWith("ROG");
    });

    it("Should fail if not governance remove keeper", async function () {
      await expect(Registry.connect(user).removeKeeperFromWhitelist(dummyAddress)).to.be.revertedWith("ROG");
    });
  });

  describe("Others set functions", async function () {
    it("Should success if governance call set functions", async function () {
      await Registry.connect(deployer).setMaxTwapDeviation(100);
      expect(await Registry.maxTwapDeviation()).to.be.equal(100);

      await Registry.connect(deployer).setTwapDuration(100);
      expect(await Registry.twapDuration()).to.be.equal(100);

      await Registry.connect(deployer).setUsdValueTokenAddress(dummyAddress);
      expect(await Registry.usdValueTokenAddress()).to.be.equal(dummyAddress);

      await Registry.connect(deployer).setWETH9(dummyAddress);
      expect(await Registry.weth9()).to.be.equal(dummyAddress);

      await Registry.connect(deployer).setPositionManagerFactory(dummyAddress);
      expect(await Registry.positionManagerFactoryAddress()).to.be.equal(dummyAddress);

      await Registry.connect(deployer).setStrategyProviderWalletFactory(dummyAddress);
      expect(await Registry.strategyProviderWalletFactoryAddress()).to.be.equal(dummyAddress);

      await Registry.connect(deployer).setOfficialAccount(dummyAddress);
      expect(await Registry.officialAccount()).to.be.equal(dummyAddress);

      await Registry.connect(deployer).changeGovernance(dummyAddress);
      expect(await Registry.governance()).to.be.equal(dummyAddress);
    });

    it("Should fail if not governance call set functions", async function () {
      await expect(Registry.connect(user).setMaxTwapDeviation(100)).to.be.revertedWith("ROG");
      await expect(Registry.connect(user).setTwapDuration(100)).to.be.revertedWith("ROG");
      await expect(Registry.connect(user).setUsdValueTokenAddress(dummyAddress)).to.be.revertedWith("ROG");
      await expect(Registry.connect(user).setWETH9(dummyAddress)).to.be.revertedWith("ROG");
      await expect(Registry.connect(user).setPositionManagerFactory(dummyAddress)).to.be.revertedWith("ROG");
      await expect(Registry.connect(user).setStrategyProviderWalletFactory(dummyAddress)).to.be.revertedWith("ROG");
      await expect(Registry.connect(user).setOfficialAccount(dummyAddress)).to.be.revertedWith("ROG");
      await expect(Registry.connect(user).changeGovernance(dummyAddress)).to.be.revertedWith("ROG");
    });
  });
});
