
import { network } from "hardhat";

const CONTRACT_ADDRESS =
  "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";

const BATCH_ID = "VIT-2026-BATCH-5F012AF2";

async function main() {
  console.log("Connecting to Hardhat localhost...");

  const { ethers } = await network.create();

  const provider = ethers.provider;

  const institutionPrivateKey =
    process.env.INSTITUTION_PRIVATE_KEY;

  if (!institutionPrivateKey) {
    throw new Error(
      "INSTITUTION_PRIVATE_KEY environment variable is not configured."
    );
  }

  const institutionWallet = new ethers.Wallet(
    institutionPrivateKey,
    provider
  );

  console.log("Institution wallet:", institutionWallet.address);
  console.log("Contract:", CONTRACT_ADDRESS);
  console.log("Batch ID:", BATCH_ID);

  const registry = await ethers.getContractAt(
    "CertificateRegistry",
    CONTRACT_ADDRESS,
    institutionWallet
  );

  // Step 1: Read the batch from the blockchain.
  const batch = await registry.certificateBatches(BATCH_ID);

  if (!batch.exists) {
    throw new Error("Batch does not exist on the blockchain.");
  }

  // Step 2: Confirm that this wallet owns the batch.
  if (
    batch.issuer.toLowerCase() !==
    institutionWallet.address.toLowerCase()
  ) {
    throw new Error(
      "The configured institution wallet is not the batch issuer."
    );
  }

  console.log("\nBatch found.");
  console.log("Merkle root:", batch.merkleRoot);
  console.log("Issuer:", batch.issuer);
  console.log("Already revoked:", batch.revoked);

  // Step 3: Prevent duplicate revocation.
  if (batch.revoked) {
    throw new Error("This batch has already been revoked.");
  }

  // Step 4: Submit the revocation transaction.
  console.log("\nSubmitting batch revocation...");

  const transaction = await registry.revokeBatch(BATCH_ID);

  console.log("Transaction hash:", transaction.hash);

  const receipt = await transaction.wait();

  if (!receipt || receipt.status !== 1) {
    throw new Error("Batch revocation transaction failed.");
  }

  // Step 5: Confirm the updated blockchain state.
  const updatedBatch =
    await registry.certificateBatches(BATCH_ID);

  if (!updatedBatch.revoked) {
    throw new Error(
      "Transaction completed, but batch is not marked revoked."
    );
  }

  console.log("\n=================================");
  console.log("BATCH REVOCATION SUCCESSFUL");
  console.log("=================================");
  console.log("Batch ID:", BATCH_ID);
  console.log("Revoked:", updatedBatch.revoked);
  console.log("Transaction:", transaction.hash);
}

main().catch((error) => {
  console.error("\nBatch revocation failed:");
  console.error(error);
  process.exitCode = 1;
});
