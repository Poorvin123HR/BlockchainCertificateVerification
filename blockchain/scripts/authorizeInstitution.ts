
import { network } from "hardhat";

const CONTRACT_ADDRESS =
  "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";

const INSTITUTION_ADDRESS =
  "0x3eb6526f4db6dcf7ae07daaa2d587c6d2a3dfe91";

async function main() {
  const { ethers } = await network.create();

  const [superAdmin] = await ethers.getSigners();

  console.log("Connected super-admin:", superAdmin.address);

  const registry = await ethers.getContractAt(
    "CertificateRegistry",
    CONTRACT_ADDRESS,
    superAdmin
  );

  const actualSuperAdmin = await registry.superAdmin();

  if (
    actualSuperAdmin.toLowerCase() !==
    superAdmin.address.toLowerCase()
  ) {
    throw new Error(
      "The first Hardhat account is not the contract's super-admin. Stopping."
    );
  }

  const alreadyAuthorized = await registry.authorizedIssuers(
    INSTITUTION_ADDRESS
  );

  if (alreadyAuthorized) {
    console.log("Institution wallet is already authorized.");
    return;
  }

  console.log("Authorizing institution:", INSTITUTION_ADDRESS);

  const tx = await registry.authorizeIssuer(INSTITUTION_ADDRESS);

  console.log("Transaction submitted:", tx.hash);

  await tx.wait();

  const isAuthorized = await registry.authorizedIssuers(
    INSTITUTION_ADDRESS
  );

  if (!isAuthorized) {
    throw new Error("Authorization could not be confirmed.");
  }

  console.log("SUCCESS: Institution wallet is now authorized.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
