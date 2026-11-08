
import { network } from "hardhat";

const INSTITUTION_ADDRESS =
  "0x3eb6526f4Db6DCF7ae07DAAA2D587C6d2A3dfe91";

async function main() {
  const { ethers } = await network.create();

  const [superAdmin] = await ethers.getSigners();

  const amount = ethers.parseEther("1");

  console.log("Funding institution wallet...");
  console.log("From:", superAdmin.address);
  console.log("To:", INSTITUTION_ADDRESS);
  console.log("Amount: 1 ETH");

  const tx = await superAdmin.sendTransaction({
    to: INSTITUTION_ADDRESS,
    value: amount,
  });

  await tx.wait();

  const balance = await ethers.provider.getBalance(
    INSTITUTION_ADDRESS
  );

  console.log("--------------------------------");
  console.log("SUCCESS: Institution funded!");
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("--------------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
