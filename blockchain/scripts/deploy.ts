
import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();

  // Get the available local blockchain accounts.
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contract...");
  console.log("Super-admin wallet:", deployer.address);

  // Deploy the CertificateRegistry smart contract.
  const registry = await ethers.deployContract("CertificateRegistry");

  await registry.waitForDeployment();

  // Display the deployed contract address.
  const contractAddress = await registry.getAddress();

  console.log("CertificateRegistry deployed at:", contractAddress);

  // Confirm the super-admin stored by the contract.
  console.log("Contract super-admin:", await registry.superAdmin());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
