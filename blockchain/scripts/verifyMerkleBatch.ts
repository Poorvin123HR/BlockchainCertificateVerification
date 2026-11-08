
import { network } from "hardhat";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { id } from "ethers";

const CONTRACT_ADDRESS =
  "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";

const OUTPUT_FILE =
  process.env.MERKLE_OUTPUT_FILE ||
  "merkle-batch-output.json";

interface CertificateProof {
  certificateId: string;
  certificateHash: string;
  leaf: string;
  proof: string[];
}

interface MerkleBatchOutput {
  batchId: string;
  issuer: string;
  merkleRoot: string;
  certificateCount: number;
  certificates: CertificateProof[];
}

async function main() {
  const inputPath = resolve(
    process.cwd(),
    "data",
    OUTPUT_FILE
  );

  const batch: MerkleBatchOutput = JSON.parse(
    await readFile(inputPath, "utf8")
  );

  if (
    !batch.batchId ||
    !batch.merkleRoot ||
    !Array.isArray(batch.certificates) ||
    batch.certificates.length === 0
  ) {
    throw new Error("Invalid or empty Merkle batch output.");
  }

  const { ethers } = await network.create();

  const registry = await ethers.getContractAt(
    "CertificateRegistry",
    CONTRACT_ADDRESS
  );

  // Confirm that the expected batch exists on-chain.
  const registeredBatch = await registry.certificateBatches(
    batch.batchId
  );

  if (!registeredBatch.exists) {
    throw new Error(
      `Batch ${batch.batchId} is not registered on-chain.`
    );
  }

  if (
    registeredBatch.merkleRoot.toLowerCase() !==
    batch.merkleRoot.toLowerCase()
  ) {
    throw new Error(
      "The on-chain Merkle root does not match the output file."
    );
  }

  console.log("Verifying Merkle batch...");
  console.log("Batch ID:", batch.batchId);
  console.log("Merkle root:", batch.merkleRoot);
  console.log("-------------------------------------");

  let verifiedCount = 0;

  for (const cert of batch.certificates) {
    const isValid = await registry.verifyBatchCertificate(
      batch.batchId,
      cert.certificateId,
      cert.certificateHash,
      cert.proof
    );

    console.log(
      `${cert.certificateId}: ${isValid ? "VALID" : "INVALID"}`
    );

    if (!isValid) {
      throw new Error(
        `Valid certificate proof failed: ${cert.certificateId}`
      );
    }

    verifiedCount++;
  }

  // Negative test: a modified hash must not verify.
  const firstCertificate = batch.certificates[0];

  const tamperedHash = id("Tampered certificate data");

  const tamperedResult = await registry.verifyBatchCertificate(
    batch.batchId,
    firstCertificate.certificateId,
    tamperedHash,
    firstCertificate.proof
  );

  console.log("-------------------------------------");
  console.log(
    "Tampered certificate:",
    tamperedResult ? "VALID" : "REJECTED"
  );

  if (tamperedResult) {
    throw new Error(
      "Security failure: tampered certificate was accepted."
    );
  }

  console.log("-------------------------------------");
  console.log("SUCCESS: All Merkle proof checks passed!");
  console.log(`Valid certificates verified: ${verifiedCount}`);
  console.log("Tampered certificate rejected: YES");
}

main().catch((error) => {
  console.error("Merkle verification failed:", error);
  process.exitCode = 1;
});
