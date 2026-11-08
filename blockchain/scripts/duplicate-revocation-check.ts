
import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();

  const [, institutionA] = await ethers.getSigners();

  const contractAddress =
    "0x5FbDB2315678afecb367f032d93F642f64180aa3";

  const registry = await ethers.getContractAt(
    "CertificateRegistry",
    contractAddress
  );

  const certificateId = "CERT-LOCAL-001";

  console.log("Institution A:", institutionA.address);

  // Step 1: Confirm that the certificate is already revoked.
  const certificateHash = ethers.id("Sample student certificate");

  const isValid = await registry.verifyCertificate(
    certificateId,
    certificateHash
  );

  console.log("Certificate valid before second attempt:", isValid);

  // Step 2: Institution A attempts to revoke it again.
  try {
    const tx = await registry
      .connect(institutionA)
      .revokeCertificate(certificateId);

    await tx.wait();

    console.log("ERROR: Duplicate revocation unexpectedly succeeded.");
    process.exitCode = 1;
  } catch (error) {
    console.log("SUCCESS: Duplicate revocation was rejected.");
    console.log(
      "Reason:",
      error instanceof Error ? error.message : error
    );
  }

  // Step 3: Confirm that the certificate remains invalid.
  const stillValid = await registry.verifyCertificate(
    certificateId,
    certificateHash
  );

  console.log("Certificate valid after second attempt:", stillValid);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
