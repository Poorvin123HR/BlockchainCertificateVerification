
import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();

  const [superAdmin, institutionA, institutionB] =
    await ethers.getSigners();

  const contractAddress =
    "0x5FbDB2315678afecb367f032d93F642f64180aa3";

  const registry = await ethers.getContractAt(
    "CertificateRegistry",
    contractAddress
  );

  const certificateId = "CERT-LOCAL-001";
  const certificateHash = ethers.id("Sample student certificate");

  console.log("Super-admin:", superAdmin.address);
  console.log("Institution A:", institutionA.address);
  console.log("Institution B:", institutionB.address);

  // Step 1: Confirm that the certificate is currently valid.
  const initiallyValid = await registry.verifyCertificate(
    certificateId,
    certificateHash
  );

  console.log("\nInitially valid:", initiallyValid);

  // Step 2: Institution B tries to revoke Institution A's certificate.
  try {
    const tx = await registry
      .connect(institutionB)
      .revokeCertificate(certificateId);

    await tx.wait();

    console.log("ERROR: Institution B revoked the certificate!");
  } catch (error) {
    console.log(
      "SUCCESS: Institution B was prevented from revoking it."
    );
    console.log(
      "Reason:",
      error instanceof Error ? error.message : error
    );
  }

  // Step 3: The super-admin also tries to revoke it.
  try {
    const tx = await registry
      .connect(superAdmin)
      .revokeCertificate(certificateId);

    await tx.wait();

    console.log("ERROR: Super-admin revoked the certificate!");
  } catch (error) {
    console.log(
      "SUCCESS: Super-admin was prevented from revoking it."
    );
    console.log(
      "Reason:",
      error instanceof Error ? error.message : error
    );
  }

  // Step 4: Institution A, the original issuer, revokes it.
  const revokeTx = await registry
    .connect(institutionA)
    .revokeCertificate(certificateId);

  await revokeTx.wait();

  console.log("\nInstitution A successfully revoked the certificate.");

  // Step 5: Verify that the revoked certificate is no longer valid.
  const finallyValid = await registry.verifyCertificate(
    certificateId,
    certificateHash
  );

  console.log("Valid after revocation:", finallyValid);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
