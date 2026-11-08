
import { expect } from "chai";
import { network } from "hardhat";

async function deployRegistry() {
  const connection = await network.create();
  const { ethers } = connection;

  const [superAdmin, institutionA, institutionB, unauthorizedUser] =
    await ethers.getSigners();

  const Registry = await ethers.getContractFactory(
    "CertificateRegistry"
  );

  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  return {
    registry,
    ethers,
    superAdmin,
    institutionA,
    institutionB,
    unauthorizedUser,
  };
}

describe("CertificateRegistry Invariant Tests", function () {
  it("INVARIANT: a revoked certificate must never become valid again", async function () {
    const { registry, ethers, institutionA } =
      await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    const certificateId = "CERT-INVARIANT-001";
    const certificateHash = ethers.id("Invariant certificate");

    // Issue certificate
    await registry.connect(institutionA).issueCertificate(
      certificateId,
      certificateHash
    );

    // Verify before revocation
    expect(
      await registry.verifyCertificate(certificateId, certificateHash)
    ).to.equal(true);

    // Revoke certificate
    await registry.connect(institutionA).revokeCertificate(certificateId);

    // Verify after revocation
    expect(
      await registry.verifyCertificate(certificateId, certificateHash)
    ).to.equal(false);
  });
  
  it("INVARIANT: unauthorized wallets must never issue certificates", async function () {
    const { registry, ethers, unauthorizedUser } =
      await deployRegistry();

    const certificateId = "CERT-INVARIANT-UNAUTHORIZED";
    const certificateHash = ethers.id("Unauthorized certificate");

    await expect(
      registry.connect(unauthorizedUser).issueCertificate(
        certificateId,
        certificateHash
      )
    ).to.be.revertedWith("Not an authorized issuer");

    expect(
      await registry.verifyCertificate(certificateId, certificateHash)
    ).to.equal(false);
  });
  
it("INVARIANT: certificate issuer must remain unchanged", async function () {
  const { registry, ethers, institutionA, institutionB } =
    await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);
  await registry.authorizeIssuer(institutionB.address);

  const certificateId = "CERT-INVARIANT-ISSUER";
  const certificateHash = ethers.id("Issuer integrity certificate");

  // Institution A issues the certificate
  await registry.connect(institutionA).issueCertificate(
    certificateId,
    certificateHash
  );

  // Institution B must not revoke Institution A's certificate
  await expect(
    registry.connect(institutionB).revokeCertificate(certificateId)
  ).to.be.revertedWith("Only issuing institution can revoke");

  // Institution A must still be able to revoke it
  await registry.connect(institutionA).revokeCertificate(certificateId);

  // Certificate is now revoked
  expect(
    await registry.verifyCertificate(certificateId, certificateHash)
  ).to.equal(false);
});

it("INVARIANT: certificate revocation must be permanent", async function () {
  const { registry, ethers, institutionA } =
    await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const certificateId = "CERT-INVARIANT-PERMANENT";
  const certificateHash = ethers.id("Permanent revocation");

  await registry.connect(institutionA).issueCertificate(
    certificateId,
    certificateHash
  );

  await registry.connect(institutionA).revokeCertificate(certificateId);

  // Attempt to revoke the same certificate again
  await expect(
    registry.connect(institutionA).revokeCertificate(certificateId)
  ).to.be.revertedWith("Certificate already revoked");

  // Certificate must remain invalid
  expect(
    await registry.verifyCertificate(certificateId, certificateHash)
  ).to.equal(false);
});

it("INVARIANT: issuer nonce must increase after successful signed issuance", async function () {
  const {
    registry,
    ethers,
    institutionA,
    unauthorizedUser,
  } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const networkInfo = await ethers.provider.getNetwork();
  const latestBlock = await ethers.provider.getBlock("latest");
  const deadline = BigInt(latestBlock!.timestamp + 3600);

  const domain = {
    name: "CertificateRegistry",
    version: "1",
    chainId: networkInfo.chainId,
    verifyingContract: await registry.getAddress(),
  };

  const types = {
    Certificate: [
      { name: "certificateId", type: "string" },
      { name: "certificateHash", type: "bytes32" },
      { name: "issuer", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const certificateHash = ethers.id("Nonce invariant certificate");

  const value = {
    certificateId: "CERT-INVARIANT-NONCE",
    certificateHash,
    issuer: institutionA.address,
    nonce: 0n,
    deadline,
  };

  const signature = await institutionA.signTypedData(
    domain,
    types,
    value
  );

  // Initial nonce must be zero
  expect(await registry.nonces(institutionA.address)).to.equal(0n);

  // Submit valid signed issuance
  await registry.connect(unauthorizedUser).issueCertificateWithSignature(
    value.certificateId,
    value.certificateHash,
    value.issuer,
    value.nonce,
    value.deadline,
    signature
  );

  // Successful issuance must increase nonce to one
  expect(await registry.nonces(institutionA.address)).to.equal(1n);
});

it("INVARIANT: failed signed issuance must not consume issuer nonce", async function () {
  const {
    registry,
    ethers,
    institutionA,
    unauthorizedUser,
  } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const networkInfo = await ethers.provider.getNetwork();
  const latestBlock = await ethers.provider.getBlock("latest");
  const deadline = BigInt(latestBlock!.timestamp + 3600);

  const domain = {
    name: "CertificateRegistry",
    version: "1",
    chainId: networkInfo.chainId,
    verifyingContract: await registry.getAddress(),
  };

  const types = {
    Certificate: [
      { name: "certificateId", type: "string" },
      { name: "certificateHash", type: "bytes32" },
      { name: "issuer", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const value = {
    certificateId: "",
    certificateHash: ethers.id("Failed issuance"),
    issuer: institutionA.address,
    nonce: 0n,
    deadline,
  };

  const signature = await institutionA.signTypedData(
    domain,
    types,
    value
  );

  await expect(
    registry.connect(unauthorizedUser).issueCertificateWithSignature(
      value.certificateId,
      value.certificateHash,
      value.issuer,
      value.nonce,
      value.deadline,
      signature
    )
  ).to.be.revertedWith("Certificate ID required");

  // Failed transaction must leave nonce unchanged
  expect(await registry.nonces(institutionA.address)).to.equal(0n);
});

it("INVARIANT: one institution's nonce must not affect another institution", async function () {
  const {
    registry,
    ethers,
    institutionA,
    institutionB,
    unauthorizedUser,
  } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);
  await registry.authorizeIssuer(institutionB.address);

  const networkInfo = await ethers.provider.getNetwork();
  const latestBlock = await ethers.provider.getBlock("latest");
  const deadline = BigInt(latestBlock!.timestamp + 3600);

  const domain = {
    name: "CertificateRegistry",
    version: "1",
    chainId: networkInfo.chainId,
    verifyingContract: await registry.getAddress(),
  };

  const types = {
    Certificate: [
      { name: "certificateId", type: "string" },
      { name: "certificateHash", type: "bytes32" },
      { name: "issuer", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const value = {
    certificateId: "CERT-INVARIANT-INDEPENDENT",
    certificateHash: ethers.id("Institution A certificate"),
    issuer: institutionA.address,
    nonce: 0n,
    deadline,
  };

  const signature = await institutionA.signTypedData(
    domain,
    types,
    value
  );

  await registry.connect(unauthorizedUser).issueCertificateWithSignature(
    value.certificateId,
    value.certificateHash,
    value.issuer,
    value.nonce,
    value.deadline,
    signature
  );

  expect(await registry.nonces(institutionA.address)).to.equal(1n);
  expect(await registry.nonces(institutionB.address)).to.equal(0n);
});

it("INVARIANT: unauthorized users must never revoke another institution's certificate", async function () {
  const {
    registry,
    ethers,
    institutionA,
    unauthorizedUser,
  } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const certificateId = "CERT-INVARIANT-UNAUTHORIZED-REVOKE";
  const certificateHash = ethers.id("Protected certificate");

  await registry.connect(institutionA).issueCertificate(
    certificateId,
    certificateHash
  );

  // Unauthorized user attempts revocation
  await expect(
    registry.connect(unauthorizedUser).revokeCertificate(certificateId)
  ).to.be.revertedWith("Only issuing institution can revoke");

  // Certificate must remain valid
  expect(
    await registry.verifyCertificate(certificateId, certificateHash)
  ).to.equal(true);
});

it("INVARIANT: duplicate certificate IDs must never overwrite existing certificates", async function () {
  const { registry, ethers, institutionA, institutionB } =
    await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);
  await registry.authorizeIssuer(institutionB.address);

  const certificateId = "CERT-INVARIANT-DUPLICATE";

  const originalHash = ethers.id("Original certificate");
  const modifiedHash = ethers.id("Modified certificate");

  // Institution A issues the original certificate
  await registry.connect(institutionA).issueCertificate(
    certificateId,
    originalHash
  );

  // Institution B attempts to reuse the same ID
  await expect(
    registry.connect(institutionB).issueCertificate(
      certificateId,
      modifiedHash
    )
  ).to.be.revertedWith("Certificate already exists");

  // Original certificate must remain valid
  expect(
    await registry.verifyCertificate(certificateId, originalHash)
  ).to.equal(true);

  // Modified certificate must not verify
  expect(
    await registry.verifyCertificate(certificateId, modifiedHash)
  ).to.equal(false);
});

it("INVARIANT: deauthorized institutions must never issue new certificates", async function () {
  const { registry, ethers, institutionA } =
    await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  // Revoke institution A's authorization
  await registry.revokeIssuerAuthorization(institutionA.address);

  const certificateId = "CERT-INVARIANT-DEAUTHORIZED";
  const certificateHash = ethers.id("Deauthorized issuer");

  await expect(
    registry.connect(institutionA).issueCertificate(
      certificateId,
      certificateHash
    )
  ).to.be.revertedWith("Not an authorized issuer");

  expect(
    await registry.verifyCertificate(certificateId, certificateHash)
  ).to.equal(false);
});

it("INVARIANT 11: deauthorized institutions must never issue signed certificates", async function () {
  const { registry, ethers, institutionA, unauthorizedUser } =
    await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);
  await registry.revokeIssuerAuthorization(institutionA.address);

  const networkInfo = await ethers.provider.getNetwork();
  const latestBlock = await ethers.provider.getBlock("latest");
  const deadline = BigInt(latestBlock!.timestamp + 3600);

  const domain = {
    name: "CertificateRegistry",
    version: "1",
    chainId: networkInfo.chainId,
    verifyingContract: await registry.getAddress(),
  };

  const types = {
    Certificate: [
      { name: "certificateId", type: "string" },
      { name: "certificateHash", type: "bytes32" },
      { name: "issuer", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const value = {
    certificateId: "CERT-INV-11",
    certificateHash: ethers.id("Deauthorized signed certificate"),
    issuer: institutionA.address,
    nonce: 0n,
    deadline,
  };

  const signature = await institutionA.signTypedData(domain, types, value);

  await expect(
    registry.connect(unauthorizedUser).issueCertificateWithSignature(
      value.certificateId,
      value.certificateHash,
      value.issuer,
      value.nonce,
      value.deadline,
      signature
    )
  ).to.be.revertedWith("Not an authorized issuer");

  expect(await registry.nonces(institutionA.address)).to.equal(0n);
});


it("INVARIANT 12: deauthorizing one institution must not affect another", async function () {
  const { registry, ethers, institutionA, institutionB } =
    await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);
  await registry.authorizeIssuer(institutionB.address);

  await registry.revokeIssuerAuthorization(institutionA.address);

  const certificateHash = ethers.id("Institution B certificate");

  await registry.connect(institutionB).issueCertificate(
    "CERT-INV-12",
    certificateHash
  );

  expect(
    await registry.verifyCertificate("CERT-INV-12", certificateHash)
  ).to.equal(true);

  expect(await registry.authorizedIssuers(institutionA.address)).to.equal(false);
  expect(await registry.authorizedIssuers(institutionB.address)).to.equal(true);
});


it("INVARIANT 13: super-admin identity must remain unchanged", async function () {
  const { registry, ethers, superAdmin, institutionA, institutionB } =
    await deployRegistry();

  const originalAdmin = await registry.superAdmin();

  await registry.authorizeIssuer(institutionA.address);
  await registry.authorizeIssuer(institutionB.address);

  await registry.revokeIssuerAuthorization(institutionA.address);

  expect(await registry.superAdmin()).to.equal(originalAdmin);
  expect(await registry.superAdmin()).to.equal(superAdmin.address);
});


it("INVARIANT 14: invalid signatures must never consume issuer nonce", async function () {
  const { registry, ethers, institutionA, institutionB, unauthorizedUser } =
    await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const networkInfo = await ethers.provider.getNetwork();
  const latestBlock = await ethers.provider.getBlock("latest");
  const deadline = BigInt(latestBlock!.timestamp + 3600);

  const domain = {
    name: "CertificateRegistry",
    version: "1",
    chainId: networkInfo.chainId,
    verifyingContract: await registry.getAddress(),
  };

  const types = {
    Certificate: [
      { name: "certificateId", type: "string" },
      { name: "certificateHash", type: "bytes32" },
      { name: "issuer", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const value = {
    certificateId: "CERT-INV-14",
    certificateHash: ethers.id("Invalid signature"),
    issuer: institutionA.address,
    nonce: 0n,
    deadline,
  };

  // Institution B signs instead of Institution A
  const invalidSignature = await institutionB.signTypedData(domain, types, value);

  await expect(
    registry.connect(unauthorizedUser).issueCertificateWithSignature(
      value.certificateId,
      value.certificateHash,
      value.issuer,
      value.nonce,
      value.deadline,
      invalidSignature
    )
  ).to.be.revertedWith("Invalid issuer signature");

  expect(await registry.nonces(institutionA.address)).to.equal(0n);
});


it("INVARIANT 15: expired signatures must never consume issuer nonce", async function () {
  const { registry, ethers, institutionA, unauthorizedUser } =
    await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const networkInfo = await ethers.provider.getNetwork();
  const latestBlock = await ethers.provider.getBlock("latest");
  const deadline = BigInt(latestBlock!.timestamp - 1);

  const domain = {
    name: "CertificateRegistry",
    version: "1",
    chainId: networkInfo.chainId,
    verifyingContract: await registry.getAddress(),
  };

  const types = {
    Certificate: [
      { name: "certificateId", type: "string" },
      { name: "certificateHash", type: "bytes32" },
      { name: "issuer", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const value = {
    certificateId: "CERT-INV-15",
    certificateHash: ethers.id("Expired signature"),
    issuer: institutionA.address,
    nonce: 0n,
    deadline,
  };

  const signature = await institutionA.signTypedData(domain, types, value);

  await expect(
    registry.connect(unauthorizedUser).issueCertificateWithSignature(
      value.certificateId,
      value.certificateHash,
      value.issuer,
      value.nonce,
      value.deadline,
      signature
    )
  ).to.be.revertedWith("Signature expired");

  expect(await registry.nonces(institutionA.address)).to.equal(0n);
});


it("INVARIANT 16: incorrect certificate hashes must never verify", async function () {
  const { registry, ethers, institutionA } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const certificateId = "CERT-INV-16";
  const originalHash = ethers.id("Original document");
  const incorrectHash = ethers.id("Different document");

  await registry.connect(institutionA).issueCertificate(
    certificateId,
    originalHash
  );

  expect(
    await registry.verifyCertificate(certificateId, originalHash)
  ).to.equal(true);

  expect(
    await registry.verifyCertificate(certificateId, incorrectHash)
  ).to.equal(false);
});


it("INVARIANT 17: revoking one certificate must not affect another", async function () {
  const { registry, ethers, institutionA } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const hashA = ethers.id("Certificate A");
  const hashB = ethers.id("Certificate B");

  await registry.connect(institutionA).issueCertificate("CERT-INV-17-A", hashA);
  await registry.connect(institutionA).issueCertificate("CERT-INV-17-B", hashB);

  await registry.connect(institutionA).revokeCertificate("CERT-INV-17-A");

  expect(
    await registry.verifyCertificate("CERT-INV-17-A", hashA)
  ).to.equal(false);

  expect(
    await registry.verifyCertificate("CERT-INV-17-B", hashB)
  ).to.equal(true);
});


it("INVARIANT 18: existing certificates must remain valid after issuer deauthorization", async function () {
  const { registry, ethers, institutionA } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const certificateId = "CERT-INV-18";
  const certificateHash = ethers.id("Previously issued certificate");

  await registry.connect(institutionA).issueCertificate(
    certificateId,
    certificateHash
  );

  await registry.revokeIssuerAuthorization(institutionA.address);

  expect(
    await registry.verifyCertificate(certificateId, certificateHash)
  ).to.equal(true);
});


it("INVARIANT 19: empty certificate IDs must never be accepted", async function () {
  const { registry, ethers, institutionA } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const certificateHash = ethers.id("Empty ID test");

  await expect(
    registry.connect(institutionA).issueCertificate("", certificateHash)
  ).to.be.revertedWith("Certificate ID required");

  expect(
    await registry.verifyCertificate("", certificateHash)
  ).to.equal(false);
});


it("INVARIANT 20: zero certificate hashes must never be accepted", async function () {
  const { registry, ethers, institutionA } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  await expect(
    registry.connect(institutionA).issueCertificate(
      "CERT-INV-20",
      ethers.ZeroHash
    )
  ).to.be.revertedWith("Invalid certificate hash");

  expect(
    await registry.verifyCertificate("CERT-INV-20", ethers.ZeroHash)
  ).to.equal(false);
});

});
