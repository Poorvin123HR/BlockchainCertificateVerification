
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isAddress, getAddress } from "ethers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

interface CertificateInput {
  certificateId: string;
  certificateHash: string;
}

interface BatchInput {
  batchId: string;
  certificates: CertificateInput[];
}

async function main() {
  // Select the input JSON file.
  // Defaults to the original certificates.json.
  const inputFile =
    process.env.MERKLE_INPUT_FILE || "certificates.json";

  const inputPath = resolve(
    process.cwd(),
    "data",
    inputFile
  );

  const input: BatchInput = JSON.parse(
    await readFile(inputPath, "utf8")
  );

  // Validate institution wallet address.
  const issuerAddressInput = process.env.ISSUER_ADDRESS;

  if (
    !issuerAddressInput ||
    !isAddress(issuerAddressInput)
  ) {
    throw new Error(
      "Please provide a valid institution address using ISSUER_ADDRESS."
    );
  }

  const issuerAddress = getAddress(issuerAddressInput);

  // Validate batch ID.
  if (!input.batchId || input.batchId.trim().length === 0) {
    throw new Error("Batch ID is required.");
  }

  // Validate certificate list.
  if (
    !Array.isArray(input.certificates) ||
    input.certificates.length === 0
  ) {
    throw new Error("At least one certificate is required.");
  }

  const certificateIds = new Set<string>();

  for (const cert of input.certificates) {
    if (
      !cert.certificateId ||
      cert.certificateId.trim().length === 0
    ) {
      throw new Error("Every certificate must have an ID.");
    }

    if (certificateIds.has(cert.certificateId)) {
      throw new Error(
        `Duplicate certificate ID: ${cert.certificateId}`
      );
    }

    certificateIds.add(cert.certificateId);

    if (
      !/^0x[0-9a-fA-F]{64}$/.test(cert.certificateHash) ||
      BigInt(cert.certificateHash) === 0n
    ) {
      throw new Error(
        `Invalid certificate hash for ${cert.certificateId}`
      );
    }
  }

  // Prepare Merkle tree values.
  const values: [string, string, string, string][] =
    input.certificates.map((cert) => [
      input.batchId,
      cert.certificateId,
      cert.certificateHash,
      issuerAddress,
    ]);

  // Generate Standard Merkle Tree.
  const tree = StandardMerkleTree.of(
    values,
    ["string", "string", "bytes32", "address"]
  );

  // Generate individual certificate proofs.
  const certificateProofs = [...tree.entries()].map(
    ([index, value]) => ({
      certificateId: value[1],
      certificateHash: value[2],
      leaf: tree.leafHash(value),
      proof: tree.getProof(index),
    })
  );

  // Prepare output.
  const output = {
    batchId: input.batchId,
    issuer: issuerAddress,
    merkleRoot: tree.root,
    certificateCount: input.certificates.length,
    certificates: certificateProofs,
  };

  // Use a separate output file for database-generated batches.
  // This protects the original registered batch output.
  const outputFile =
    process.env.MERKLE_OUTPUT_FILE ||
    "merkle-batch-output.json";

  const outputPath = resolve(
    process.cwd(),
    "data",
    outputFile
  );

  await writeFile(
    outputPath,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log("\nMerkle batch generated successfully!");
  console.log("-------------------------------------");
  console.log("Input file:", inputPath);
  console.log("Batch ID:", input.batchId);
  console.log("Issuer:", issuerAddress);
  console.log("Certificate count:", input.certificates.length);
  console.log("Merkle root:", tree.root);
  console.log("Output file:", outputPath);
  console.log("-------------------------------------");
}

main().catch((error) => {
  console.error("Merkle generation failed:", error);
  process.exitCode = 1;
});
