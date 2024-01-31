import { ethers, network, run } from "hardhat";

async function main() {
  const contractAddress = "0x521bf547Ce62ce0fd84A171A6704F64F663543ee";
  await run("verify:verify", {
    address: contractAddress,
    constructorArguments: ["0x1BdcF8Fea00691B61a1fA48c4785A23E9a6b4180", "0xC847FD0bFADCAb154FDFAD397BA236280C45239E"],
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
