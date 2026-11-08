
import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();

  // Account 0 is the super-admin.
  // Account 1 will represent Institution A.
  const [superAdmin, institutionA] = await ethers.getSigners();

  // Address of the contract deployed earlier.
  const contractAddress =
    "0x5FbDB2315678afecb367f032d93F642f64180aa3";

  // Load the deployed contract using its compiled interface.
  const registry = await ethers.getContractAt(
    "CertificateRegistry",
    contractAddress
  );

  console.log("Super-admin:", superAdmin.address);
  console.log("Institution A:", institutionA.address);

  // Step 1: Super-admin authorizes Institution A.
  const authorizationTx = await registry
    .connect(superAdmin)
    .authorizeIssuer(institutionA.address);

  await authorizationTx.wait();

  console.log("Institution A authorized!");

  // Step 2: Institution A issues a certificate.
  const certificateId = "CERT-LOCAL-001";
  const certificateHash = ethers.id("Sample student certificate");

  const issueTx = await registry
    .connect(institutionA)
    .issueCertificate(certificateId, certificateHash);

  await issueTx.wait();

  console.log("Certificate issued:", certificateId);
  console.log("Certificate hash:", certificateHash);

  // Step 3: Verify the certificate.
  const isValid = await registry.verifyCertificate(
    certificateId,
    certificateHash
  );

  console.log("Certificate valid:", isValid);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
