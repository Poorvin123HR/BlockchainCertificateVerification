
import { network } from "hardhat";
import { Wallet, isHexString, isAddress, getAddress } from "ethers";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const CONTRACT_ADDRESS =
  "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";

const OUTPUT_FILE =
  process.env.MERKLE_OUTPUT_FILE ||
  "merkle-batch-output.json";

const OUTPUT_PATH = resolve(
  process.cwd(),
  "data",
  OUTPUT_FILE
);

interface MerkleBatchOutput {
  batchId: string;
  issuer: string;
  merkleRoot: string;
  certificateCount: number;
}

async function main() {
  const privateKey = process.env.INSTITUTION_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error(
      "INSTITUTION_PRIVATE_KEY environment variable is missing."
    );
  }

  const batch: MerkleBatchOutput = JSON.parse(
    await readFile(OUTPUT_PATH, "utf8")
  );

  if (!batch.batchId || batch.batchId.trim() === "") {
    throw new Error("Batch ID is missing.");
  }

  if (!isAddress(batch.issuer)) {
    throw new Error("Invalid issuer address in Merkle batch.");
  }

  if (
    !isHexString(batch.merkleRoot, 32) ||
    batch.merkleRoot === "0x" + "00".repeat(32)
  ) {
    throw new Error("Invalid or zero Merkle root.");
  }

  if (
    !Number.isSafeInteger(batch.certificateCount) ||
    batch.certificateCount < 1
  ) {
    throw new Error("Invalid certificate count.");
  }

  const { ethers } = await network.create();

  const institutionWallet = new Wallet(
    privateKey,
    ethers.provider
  );

  const issuerAddress = getAddress(batch.issuer);

  console.log("Institution wallet:", institutionWallet.address);

  if (
    institutionWallet.address.toLowerCase() !==
    issuerAddress.toLowerCase()
  ) {
    throw new Error(
      "Institution wallet does not match the issuer in the Merkle batch."
    );
  }

  const registry = await ethers.getContractAt(
    "CertificateRegistry",
    CONTRACT_ADDRESS,
    institutionWallet
  );

  const authorized = await registry.authorizedIssuers(
    institutionWallet.address
  );

  if (!authorized) {
    throw new Error(
      "Institution is not authorized to register batches."
    );
  }

  const existingBatch = await registry.certificateBatches(
    batch.batchId
  );

  if (existingBatch.exists) {
    if (
      existingBatch.merkleRoot.toLowerCase() ===
        batch.merkleRoot.toLowerCase() &&
      BigInt(existingBatch.totalCertificates) ===
        BigInt(batch.certificateCount)
    ) {
      console.log("This batch is already registered.");
      console.log(
        "Certificate count:",
        existingBatch.totalCertificates.toString()
      );
      return;
    }

    throw new Error(
      "This batch ID already exists with a different Merkle root or certificate count."
    );
  }

  console.log("-------------------------------------");
  console.log("Registering Merkle batch...");
  console.log("Batch ID:", batch.batchId);
  console.log("Certificate count:", batch.certificateCount);
  console.log("Merkle root:", batch.merkleRoot);
  console.log("-------------------------------------");

  const tx = await registry.registerBatch(
    batch.batchId,
    batch.merkleRoot,
    batch.certificateCount
  );

  console.log("Transaction submitted:", tx.hash);

  const receipt = await tx.wait();

  if (!receipt || receipt.status !== 1) {
    throw new Error("Batch registration transaction failed.");
  }

  const registeredBatch = await registry.certificateBatches(
    batch.batchId
  );

  if (
    !registeredBatch.exists ||
    registeredBatch.merkleRoot.toLowerCase() !==
      batch.merkleRoot.toLowerCase() ||
    BigInt(registeredBatch.totalCertificates) !==
      BigInt(batch.certificateCount)
  ) {
    throw new Error(
      "On-chain batch registration could not be confirmed."
    );
  }

  console.log("-------------------------------------");
  console.log("SUCCESS: Merkle batch registered!");
  console.log("Batch ID:", batch.batchId);
  console.log("Issuer:", registeredBatch.issuer);
  console.log("Merkle root:", registeredBatch.merkleRoot);
  console.log(
    "Certificate count:",
    registeredBatch.totalCertificates.toString()
  );
  console.log("Transaction hash:", receipt.hash);
  console.log("-------------------------------------");
}

main().catch((error) => {
  console.error("Merkle registration failed:", error);
  process.exitCode = 1;
});
