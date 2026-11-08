
import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();

  const [, , unauthorizedUser] = await ethers.getSigners();

  const contractAddress =
    "0x5FbDB2315678afecb367f032d93F642f64180aa3";

  const registry = await ethers.getContractAt(
    "CertificateRegistry",
    contractAddress
  );

  console.log("Unauthorized wallet:", unauthorizedUser.address);

  try {
    const tx = await registry
      .connect(unauthorizedUser)
      .issueCertificate(
        "CERT-UNAUTHORIZED-001",
        ethers.id("Unauthorized test certificate")
      );

    await tx.wait();

    console.log("ERROR: Unauthorized issuance unexpectedly succeeded.");
    process.exitCode = 1;
  } catch (error) {
    console.log("SUCCESS: Unauthorized issuance was rejected.");
    console.log("Reason:", error instanceof Error ? error.message : error);
  }

  const exists = await registry.verifyCertificate(
    "CERT-UNAUTHORIZED-001",
    ethers.id("Unauthorized test certificate")
  );

  console.log("Unauthorized certificate verifies:", exists);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
