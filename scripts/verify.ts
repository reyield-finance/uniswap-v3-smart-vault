import { ethers, network, run } from "hardhat";

async function main() {
  const contractAddress = "0x308A5de3D59Ff76f67b0BA4656B8cD3408a31D0D";
  await run("verify:verify", {
    address: contractAddress,
    constructorArguments: [
      "0x565d490806A6D8eF532f4d29eC00EF6aAC71A17A",
      "0x2833242BAC2E2a196d240ADe39ff6D2b912D9edb",
      "0x99c4bEa3DbC7C2670B0D781946071cAC215aC86D",
    ],
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
