import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { AbiCoder } from "ethers/lib/utils";
import hre from "hardhat";
import { ethers } from "hardhat";

import { Registry, Timelock } from "../types";
import { RegistryFixture, TimelockFixture, tokensFixture } from "./shared/fixtures";

describe("Timelock.sol", function () {
  let deployer: SignerWithAddress;
  let deployer2: SignerWithAddress;
  let deployer3: SignerWithAddress;
  let deployer4: SignerWithAddress;
  let serviceFeeRecipient: SignerWithAddress;
  let Registry: Registry;
  let Timelock: Timelock;
  let Timelock2: Timelock;
  // let AaveAddressHolder: any;
  let AbiCoder: AbiCoder;
  const randomContractAddress = "0x29D7d1dd5B6f9C864d9db560D72a247c178aE86B";

  before(async function () {
    await hre.network.provider.send("hardhat_reset");

    const signers = await ethers.getSigners();
    deployer = signers[0];
    deployer2 = signers[1];
    deployer3 = signers[2];
    deployer4 = signers[3];
    serviceFeeRecipient = signers[4];
    const usdValueTokenAddress = (await tokensFixture("USDC", 6)).tokenFixture;
    const weth = (await tokensFixture("WETH", 18)).tokenFixture;

    //select standard abicoder
    AbiCoder = ethers.utils.defaultAbiCoder;

    // deploy the timelock
    const delay = 21600; // 6 hours
    Timelock = (await TimelockFixture(deployer.address, delay)).timelockFixture;

    // deploy an additional timelock to test admin features
    Timelock2 = (await TimelockFixture(deployer4.address, delay)).timelockFixture;

    //deploy the registry - we need it to test the timelock features
    Registry = (
      await RegistryFixture(
        Timelock.address,
        await serviceFeeRecipient.getAddress(),
        500,
        4,
        usdValueTokenAddress.address,
        weth.address,
      )
    ).registryFixture;

    // AaveAddressHolder = await deployContract("AaveAddressHolder", [randomContractAddress, Registry.address]);
  });

  describe("Deployment ", function () {
    it("Should correctly set timelock admin", async function () {
      expect(await Timelock.admin()).to.equal(deployer.address);
    });

    it("Should revert if the delay is too small", async function () {
      const delayTooSmall = 100;
      const timelockFactory = await ethers.getContractFactory("Timelock");
      await expect(timelockFactory.deploy(deployer2.address, delayTooSmall)).to.be.revertedWith("TVDMIN");
    });

    it("Should revert if the delay is too big", async function () {
      const delayTooSmall = 3e7;
      const timelockFactory = await ethers.getContractFactory("Timelock");
      await expect(timelockFactory.deploy(deployer3.address, delayTooSmall)).to.be.revertedWith("TVDMAX");
    });
  });

  describe("Admin settings ", function () {
    it("Should correctly set a new time delay", async function () {
      const newDelay = 40000;
      await Timelock2.connect(deployer4).setDelay(newDelay);
      expect(await Timelock2.delay()).to.equal(newDelay);
    });

    it("Should correctly set a new pending admin", async function () {
      const newPendingAdmin = deployer2.address;
      await Timelock2.connect(deployer4).setNewPendingAdmin(newPendingAdmin);
      expect(await Timelock2.pendingAdmin()).to.equal(newPendingAdmin);
    });

    it("Should correctly accept role of new admin", async function () {
      await Timelock2.connect(deployer2).acceptAdminRole();
      expect(await Timelock2.pendingAdminAccepted(deployer2.address)).to.equal(true);
    });

    it("Should correctly confirm the newly accepted admin", async function () {
      await Timelock2.connect(deployer4).confirmNewAdmin();
      expect(await Timelock2.admin()).to.equal(deployer2.address);
    });
  });

  describe("Transaction processing", async function () {
    it("Should correctly queue a transaction", async function () {
      const target = Registry.address;
      const value = 0;
      const signature = "addNewContract(bytes32,address,bytes32,bool)";
      const data = AbiCoder.encode(
        ["bytes32", "address", "bytes32", "bool"],
        [
          hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("Test")),
          randomContractAddress,
          hre.ethers.utils.formatBytes32String("0"),
          false,
        ],
      );
      const eta = (await ethers.provider.getBlock("latest")).timestamp + 21800;

      const txReceipt = await (
        await Timelock.connect(deployer).queueTransaction(target, value, signature, data, eta)
      ).wait();

      const events = txReceipt.events!;
      expect(events[0].event).to.be.equal("QueueTransaction");
    });

    it("Should correctly cancel a queued transaction", async function () {
      const target = Registry.address;
      const value = 0;
      const signature = "addNewContract(address)";
      const data = AbiCoder.encode(["address"], [randomContractAddress]);
      const eta = (await ethers.provider.getBlock("latest")).timestamp + 21700;

      const txReceipt = await (
        await Timelock.connect(deployer).cancelTransaction(target, value, signature, data, eta)
      ).wait();

      const events = txReceipt.events!;
      expect(events[0].event).to.be.equal("CancelTransaction");
    });

    it("Should correctly execute a queued transaction", async function () {
      const target = Registry.address;
      const value = 0;
      const signature = "addNewContract(bytes32,address,bytes32)";
      const data = AbiCoder.encode(
        ["bytes32", "address", "bytes32"],
        [
          hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("Test")),
          randomContractAddress,
          hre.ethers.utils.formatBytes32String("0"),
        ],
      );
      const eta = (await ethers.provider.getBlock("latest")).timestamp + 21700;

      const queueTxReceipt = await (await Timelock.queueTransaction(target, value, signature, data, eta)).wait();

      const queueEvents = queueTxReceipt.events!;
      expect(queueEvents[0].event).to.be.equal("QueueTransaction");

      // Increase timestamp to satisfy timelock delay
      // We must increase it by at least eta amount (21700 in this case)
      const forwardInTime = 30000;
      await ethers.provider.send("evm_increaseTime", [forwardInTime]);

      const executeTxReceipt = await (
        await Timelock.connect(deployer).executeTransaction(target, value, signature, data, eta)
      ).wait();

      const executeEvents = executeTxReceipt.events!;
      expect(executeEvents[1].event).to.be.equal("ExecuteTransaction");
    });
    it("Should correctly execute a queued transaction of a set new address", async function () {
      const target = Registry.address;
      const value = 0;
      const signature = "changeServiceFeeRecipient(address)";
      const data = AbiCoder.encode(["address"], [serviceFeeRecipient.address]);
      const eta = (await ethers.provider.getBlock("latest")).timestamp + 21700;

      const queueTxReceipt = await (await Timelock.queueTransaction(target, value, signature, data, eta)).wait();

      const queueEvents = queueTxReceipt.events!;
      expect(queueEvents[0].event).to.be.equal("QueueTransaction");

      // Increase timestamp to satisfy timelock delay
      // We must increase it by at least eta amount (21700 in this case)
      const forwardInTime = 30000;
      await ethers.provider.send("evm_increaseTime", [forwardInTime]);

      const executeTxReceipt = await (
        await Timelock.connect(deployer).executeTransaction(target, value, signature, data, eta)
      ).wait();

      const executeEvents = executeTxReceipt.events!;
      expect(executeEvents[1].event).to.be.equal("ExecuteTransaction");
    });

    it("Should revert if not enough time has passed", async function () {
      const target = Registry.address;
      const value = 0;
      const signature = "addNewContract(bytes32,address,bytes32,bool)";
      const data = AbiCoder.encode(
        ["bytes32", "address", "bytes32"],
        [
          hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes("Test")),
          randomContractAddress,
          hre.ethers.utils.formatBytes32String("0"),
        ],
      );
      const eta = (await ethers.provider.getBlock("latest")).timestamp + 21700;

      const queueTxReceipt = await (
        await Timelock.connect(deployer).queueTransaction(target, value, signature, data, eta)
      ).wait();

      const queueEvents = queueTxReceipt.events!;
      expect(queueEvents[0].event).to.be.equal("QueueTransaction");

      // Increase timestamp not enough to satisfy timelock delay
      const forwardInTime = 1000;
      await ethers.provider.send("evm_increaseTime", [forwardInTime]);

      await expect(
        Timelock.connect(deployer).executeTransaction(target, value, signature, data, eta),
      ).to.be.revertedWith("TETNSTL");
    });
  });
});
