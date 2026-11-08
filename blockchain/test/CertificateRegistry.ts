
import { expect } from "chai";
import { network } from "hardhat";
import fc from "fast-check";

describe("CertificateRegistry", function () {
  async function deployRegistry() {
    const { ethers } = await network.create();

    const registry = await ethers.deployContract("CertificateRegistry");
    await registry.waitForDeployment();

    const [
      superAdmin,
      institutionA,
      institutionB,
      unauthorizedUser,
    ] = await ethers.getSigners();

    return {
      registry,
      ethers,
      superAdmin,
      institutionA,
      institutionB,
      unauthorizedUser,
    };
  }

  it("should set the deployer as super-admin", async function () {
    const { registry, superAdmin } = await deployRegistry();

    expect(await registry.superAdmin()).to.equal(superAdmin.address);
  });

  it("should allow the super-admin to authorize an institution", async function () {
    const { registry, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    expect(
      await registry.authorizedIssuers(institutionA.address)
    ).to.equal(true);
  });

  it("should prevent a non-super-admin from authorizing an institution", async function () {
    const { registry, institutionA, institutionB } =
      await deployRegistry();

    await expect(
      registry.connect(institutionA).authorizeIssuer(institutionB.address)
    ).to.be.revertedWith("Only super-admin");
  });

  it("should allow an authorized institution to issue and verify a certificate", async function () {
    const { registry, ethers, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    const certificateId = "CERT-001";
    const certificateHash = ethers.id("Student certificate document");

    await registry
      .connect(institutionA)
      .issueCertificate(certificateId, certificateHash);

    expect(
      await registry.verifyCertificate(certificateId, certificateHash)
    ).to.equal(true);
  });

  it("should return false for an incorrect certificate hash", async function () {
    const { registry, ethers, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    const correctHash = ethers.id("Original certificate");
    const incorrectHash = ethers.id("Modified certificate");

    await registry
      .connect(institutionA)
      .issueCertificate("CERT-002", correctHash);

    expect(
      await registry.verifyCertificate("CERT-002", incorrectHash)
    ).to.equal(false);
  });

  it("should reject certificate issuance by an unauthorized wallet", async function () {
    const { registry, ethers, unauthorizedUser } =
      await deployRegistry();

    await expect(
      registry
        .connect(unauthorizedUser)
        .issueCertificate("CERT-003", ethers.id("Certificate document"))
    ).to.be.revertedWith("Not an authorized issuer");
  });

  it("should reject duplicate certificate IDs", async function () {
    const { registry, ethers, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    await registry
      .connect(institutionA)
      .issueCertificate("CERT-004", ethers.id("First certificate"));

    await expect(
      registry
        .connect(institutionA)
        .issueCertificate("CERT-004", ethers.id("Another certificate"))
    ).to.be.revertedWith("Certificate already exists");
  });

  it("should allow only the issuing institution to revoke its certificate", async function () {
    const {
      registry,
      ethers,
      superAdmin,
      institutionA,
      institutionB,
    } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);
    await registry.authorizeIssuer(institutionB.address);

    const certificateId = "CERT-005";
    const certificateHash = ethers.id("Certificate to revoke");

    await registry
      .connect(institutionA)
      .issueCertificate(certificateId, certificateHash);

    await expect(
      registry.connect(institutionB).revokeCertificate(certificateId)
    ).to.be.revertedWith("Only issuing institution can revoke");

    await expect(
      registry.connect(superAdmin).revokeCertificate(certificateId)
    ).to.be.revertedWith("Only issuing institution can revoke");
  });

  it("should stop verifying a certificate after its issuer revokes it", async function () {
    const { registry, ethers, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    const certificateId = "CERT-006";
    const certificateHash = ethers.id("Certificate to revoke");

    await registry
      .connect(institutionA)
      .issueCertificate(certificateId, certificateHash);

    await registry.connect(institutionA).revokeCertificate(certificateId);

    expect(
      await registry.verifyCertificate(certificateId, certificateHash)
    ).to.equal(false);
  });

  it("should prevent a deauthorized institution from issuing new certificates", async function () {
    const { registry, ethers, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    const certificateHash = ethers.id("Existing certificate");

    await registry
      .connect(institutionA)
      .issueCertificate("CERT-007", certificateHash);

    await registry.revokeIssuerAuthorization(institutionA.address);

    expect(
      await registry.authorizedIssuers(institutionA.address)
    ).to.equal(false);

    await expect(
      registry
        .connect(institutionA)
        .issueCertificate("CERT-008", ethers.id("New certificate"))
    ).to.be.revertedWith("Not an authorized issuer");

    // Deauthorization does not invalidate previously issued certificates.
    expect(
      await registry.verifyCertificate("CERT-007", certificateHash)
    ).to.equal(true);
  });
  
  it("should prevent an unauthorized wallet from revoking issuer authorization", async function () {
    const { registry, institutionA, unauthorizedUser } =
      await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    await expect(
      registry
        .connect(unauthorizedUser)
        .revokeIssuerAuthorization(institutionA.address)
    ).to.be.revertedWith("Only super-admin");
  });

  it("should reject authorization of the zero address", async function () {
    const { registry, ethers } = await deployRegistry();

    await expect(
      registry.authorizeIssuer(ethers.ZeroAddress)
    ).to.be.revertedWith("Invalid institution address");
  });

  it("should reject duplicate institution authorization", async function () {
    const { registry, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    await expect(
      registry.authorizeIssuer(institutionA.address)
    ).to.be.revertedWith("Institution already authorized");
  });

  it("should reject certificate issuance with an empty ID", async function () {
    const { registry, ethers, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    await expect(
      registry
        .connect(institutionA)
        .issueCertificate("", ethers.id("Certificate"))
    ).to.be.revertedWith("Certificate ID required");
  });

  it("should reject certificate issuance with a zero hash", async function () {
    const { registry, ethers, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    await expect(
      registry
        .connect(institutionA)
        .issueCertificate("CERT-009", ethers.ZeroHash)
    ).to.be.revertedWith("Invalid certificate hash");
  });

  it("should prevent an unauthorized wallet from revoking a certificate", async function () {
    const { registry, ethers, institutionA, unauthorizedUser } =
      await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    const certificateHash = ethers.id("Certificate");

    await registry
      .connect(institutionA)
      .issueCertificate("CERT-010", certificateHash);

    await expect(
      registry
        .connect(unauthorizedUser)
        .revokeCertificate("CERT-010")
    ).to.be.revertedWith("Only issuing institution can revoke");

    expect(
      await registry.verifyCertificate("CERT-010", certificateHash)
    ).to.equal(true);
  });

  it("should prevent a certificate from being revoked twice", async function () {
    const { registry, ethers, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    await registry
      .connect(institutionA)
      .issueCertificate("CERT-011", ethers.id("Certificate"));

    await registry.connect(institutionA).revokeCertificate("CERT-011");

    await expect(
      registry.connect(institutionA).revokeCertificate("CERT-011")
    ).to.be.revertedWith("Certificate already revoked");
  });

  it("should reject revocation of a nonexistent certificate", async function () {
    const { registry, institutionA } = await deployRegistry();

    await expect(
      registry.connect(institutionA).revokeCertificate("UNKNOWN-001")
    ).to.be.revertedWith("Certificate does not exist");
  });

  it("should allow a deauthorized issuer to revoke its previously issued certificate", async function () {
    const { registry, ethers, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    const certificateHash = ethers.id("Previously issued certificate");

    await registry
      .connect(institutionA)
      .issueCertificate("CERT-012", certificateHash);

    await registry.revokeIssuerAuthorization(institutionA.address);

    await registry.connect(institutionA).revokeCertificate("CERT-012");

    expect(
      await registry.verifyCertificate("CERT-012", certificateHash)
    ).to.equal(false);
  });
  
  it("should emit IssuerAuthorized with the correct institution address", async function () {
    const { registry, institutionA } = await deployRegistry();

    await expect(
      registry.authorizeIssuer(institutionA.address)
    )
      .to.emit(registry, "IssuerAuthorized")
      .withArgs(institutionA.address);
  });

  it("should emit IssuerAuthorizationRevoked with the correct institution address", async function () {
    const { registry, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    await expect(
      registry.revokeIssuerAuthorization(institutionA.address)
    )
      .to.emit(registry, "IssuerAuthorizationRevoked")
      .withArgs(institutionA.address);
  });

  it("should emit CertificateIssued with the correct certificate details", async function () {
    const { registry, ethers, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    const certificateId = "CERT-EVENT-001";
    const certificateHash = ethers.id("Event test certificate");

    await expect(
      registry.connect(institutionA).issueCertificate(
        certificateId,
        certificateHash
      )
    )
      .to.emit(registry, "CertificateIssued")
      .withArgs(certificateId, certificateHash, institutionA.address);
  });

  it("should emit CertificateRevoked with the correct certificate details", async function () {
    const { registry, ethers, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    const certificateId = "CERT-EVENT-002";
    const certificateHash = ethers.id("Revocation event test");

    await registry.connect(institutionA).issueCertificate(
      certificateId,
      certificateHash
    );

    await expect(
      registry.connect(institutionA).revokeCertificate(certificateId)
    )
      .to.emit(registry, "CertificateRevoked")
      .withArgs(certificateId, institutionA.address);
  });
  it("PROPERTY: unauthorized wallets must never issue certificates", async function () {
    const { registry, ethers, unauthorizedUser } = await deployRegistry();

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        async (certificateId, documentContent) => {
          const certificateHash = ethers.id(documentContent);

          await expect(
            registry
              .connect(unauthorizedUser)
              .issueCertificate(certificateId, certificateHash)
          ).to.be.revertedWith("Not an authorized issuer");
        }
      ),
      { numRuns: 20 }
    );
  });
  it("PROPERTY: unauthorized wallets must never authorize institutions", async function () {
    const { registry, ethers, unauthorizedUser } = await deployRegistry();

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000000 }),
        async (randomNumber) => {
          const institutionAddress = ethers.getAddress(
            ethers.zeroPadValue(ethers.toBeHex(randomNumber), 20)
          );

          await expect(
            registry
              .connect(unauthorizedUser)
              .authorizeIssuer(institutionAddress)
          ).to.be.revertedWith("Only super-admin");
        }
      ),
      { numRuns: 20 }
    );
  });
  it("PROPERTY: unauthorized wallets must never revoke issuer authorization", async function () {
    const { registry, ethers, superAdmin, unauthorizedUser } =
      await deployRegistry();

    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          fc.integer({ min: 1, max: 1000000 }),
          { minLength: 20, maxLength: 20 }
        ),
        async (randomNumbers) => {
          for (const randomNumber of randomNumbers) {
            const institutionAddress = ethers.getAddress(
              ethers.zeroPadValue(ethers.toBeHex(randomNumber), 20)
            );

            await registry
              .connect(superAdmin)
              .authorizeIssuer(institutionAddress);

            await expect(
              registry
                .connect(unauthorizedUser)
                .revokeIssuerAuthorization(institutionAddress)
            ).to.be.revertedWith("Only super-admin");
          }
        }
      ),
      { numRuns: 1 }
    );
  });
  it("PROPERTY: unauthorized wallets must never revoke certificates", async function () {
    const {
      registry,
      ethers,
      institutionA,
      unauthorizedUser,
    } = await deployRegistry();

    await registry
      .connect(institutionA)
      .authorizeIssuer;

    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          fc.integer({ min: 1, max: 1000000 }),
          { minLength: 20, maxLength: 20 }
        ),
        async (randomNumbers) => {
          await registry.authorizeIssuer(institutionA.address);

          for (const randomNumber of randomNumbers) {
            const certificateId = `CERT-PROPERTY-${randomNumber}`;
            const certificateHash = ethers.id(certificateId);

            await registry
              .connect(institutionA)
              .issueCertificate(certificateId, certificateHash);

            await expect(
              registry
                .connect(unauthorizedUser)
                .revokeCertificate(certificateId)
            ).to.be.revertedWith("Only issuing institution can revoke");

            expect(
              await registry.verifyCertificate(
                certificateId,
                certificateHash
              )
            ).to.equal(true);
          }
        }
      ),
      { numRuns: 1 }
    );
  });
  it("PROPERTY: authorized issuers cannot issue duplicate certificate IDs", async function () {
    const { registry, ethers, institutionA } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          fc.string({ minLength: 1, maxLength: 30 }),
          { minLength: 20, maxLength: 20 }
        ),
        async (certificateIds) => {
          for (const certificateId of certificateIds) {
            const firstHash = ethers.id(`Original-${certificateId}`);
            const secondHash = ethers.id(`Duplicate-${certificateId}`);

            await registry
              .connect(institutionA)
              .issueCertificate(certificateId, firstHash);

            await expect(
              registry
                .connect(institutionA)
                .issueCertificate(certificateId, secondHash)
            ).to.be.revertedWith("Certificate already exists");
          }
        }
      ),
      { numRuns: 1 }
    );
  });
  
  it("should issue a certificate using a valid EIP-712 signature", async function () {
    const {
      registry,
      ethers,
      institutionA,
      unauthorizedUser,
    } = await deployRegistry();

    await registry.authorizeIssuer(institutionA.address);

    const certificateId = "CERT-EIP712-001";
    const certificateHash = ethers.id("EIP-712 signed certificate");

    const nonce = 0n;
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
      certificateId,
      certificateHash,
      issuer: institutionA.address,
      nonce,
      deadline,
    };

    const signature = await institutionA.signTypedData(
      domain,
      types,
      value
    );

    // A different wallet submits the transaction.
    await registry
      .connect(unauthorizedUser)
      .issueCertificateWithSignature(
        certificateId,
        certificateHash,
        institutionA.address,
        nonce,
        deadline,
        signature
      );

    expect(
      await registry.verifyCertificate(certificateId, certificateHash)
    ).to.equal(true);

    expect(
      await registry.nonces(institutionA.address)
    ).to.equal(1n);
  });
  it("should prevent replay attacks using the same EIP-712 signature", async function () {
  const {
    registry,
    ethers,
    institutionA,
    unauthorizedUser,
  } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const certificateId = "CERT-EIP712-REPLAY";
  const certificateHash = ethers.id("Replay attack test");

  const nonce = 0n;
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
    certificateId,
    certificateHash,
    issuer: institutionA.address,
    nonce,
    deadline,
  };

  const signature = await institutionA.signTypedData(
    domain,
    types,
    value
  );

  // First submission succeeds.
  await registry
    .connect(unauthorizedUser)
    .issueCertificateWithSignature(
      certificateId,
      certificateHash,
      institutionA.address,
      nonce,
      deadline,
      signature
    );

  // Second submission reuses the old nonce and signature.
  await expect(
    registry
      .connect(unauthorizedUser)
      .issueCertificateWithSignature(
        certificateId,
        certificateHash,
        institutionA.address,
        nonce,
        deadline,
        signature
      )
  ).to.be.revertedWith("Invalid nonce");

  expect(
    await registry.nonces(institutionA.address)
   ).to.equal(1n);
  });
  it("should reject an invalid EIP-712 issuer signature", async function () {
  const {
    registry,
    ethers,
    institutionA,
    institutionB,
    unauthorizedUser,
  } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const certificateId = "CERT-EIP712-INVALID";
  const certificateHash = ethers.id("Invalid signature test");

  const nonce = 0n;
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
    certificateId,
    certificateHash,
    issuer: institutionA.address,
    nonce,
    deadline,
  };

  // Institution B signs while claiming to be institution A.
  const invalidSignature = await institutionB.signTypedData(
    domain,
    types,
    value
  );

  await expect(
    registry
      .connect(unauthorizedUser)
      .issueCertificateWithSignature(
        certificateId,
        certificateHash,
        institutionA.address,
        nonce,
        deadline,
        invalidSignature
      )
  ).to.be.revertedWith("Invalid issuer signature");

  expect(
    await registry.nonces(institutionA.address)
  ).to.equal(0n);
  });
  
it("should reject an expired EIP-712 signature", async function () {
  const {
    registry,
    ethers,
    institutionA,
    unauthorizedUser,
  } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const certificateId = "CERT-EIP712-EXPIRED";
  const certificateHash = ethers.id("Expired signature test");

  const nonce = 0n;
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
    certificateId,
    certificateHash,
    issuer: institutionA.address,
    nonce,
    deadline,
  };

  const signature = await institutionA.signTypedData(
    domain,
    types,
    value
  );

  await expect(
    registry
      .connect(unauthorizedUser)
      .issueCertificateWithSignature(
        certificateId,
        certificateHash,
        institutionA.address,
        nonce,
        deadline,
        signature
      )
  ).to.be.revertedWith("Signature expired");

  expect(
    await registry.nonces(institutionA.address)
  ).to.equal(0n);
});

it("should reject signature-based issuance by an unauthorized institution", async function () {
  const {
    registry,
    ethers,
    institutionA,
    unauthorizedUser,
  } = await deployRegistry();

  const certificateId = "CERT-EIP712-UNAUTHORIZED";
  const certificateHash = ethers.id("Unauthorized institution test");

  const nonce = 0n;
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
    certificateId,
    certificateHash,
    issuer: institutionA.address,
    nonce,
    deadline,
  };

  const signature = await institutionA.signTypedData(
    domain,
    types,
    value
  );

  await expect(
    registry
      .connect(unauthorizedUser)
      .issueCertificateWithSignature(
        certificateId,
        certificateHash,
        institutionA.address,
        nonce,
        deadline,
        signature
      )
  ).to.be.revertedWith("Not an authorized issuer");

  expect(
    await registry.nonces(institutionA.address)
  ).to.equal(0n);
});

it("should reject an EIP-712 signature with an incorrect nonce", async function () {
  const {
    registry,
    ethers,
    institutionA,
    unauthorizedUser,
  } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const certificateId = "CERT-EIP712-WRONG-NONCE";
  const certificateHash = ethers.id("Incorrect nonce test");

  // Current expected nonce is 0, but the signature uses 1.
  const nonce = 1n;

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
    certificateId,
    certificateHash,
    issuer: institutionA.address,
    nonce,
    deadline,
  };

  const signature = await institutionA.signTypedData(
    domain,
    types,
    value
  );

  await expect(
    registry
      .connect(unauthorizedUser)
      .issueCertificateWithSignature(
        certificateId,
        certificateHash,
        institutionA.address,
        nonce,
        deadline,
        signature
      )
  ).to.be.revertedWith("Invalid nonce");

  expect(
    await registry.nonces(institutionA.address)
  ).to.equal(0n);
});

it("should reject duplicate certificate IDs in signature-based issuance", async function () {
  const {
    registry,
    ethers,
    institutionA,
    unauthorizedUser,
  } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const certificateId = "CERT-EIP712-DUPLICATE";
  const firstHash = ethers.id("Original certificate");
  const secondHash = ethers.id("Different certificate");

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

  // Issue the first certificate directly.
  await registry
    .connect(institutionA)
    .issueCertificate(certificateId, firstHash);

  // Sign a second certificate using the same ID but a new nonce.
  const nonce = await registry.nonces(institutionA.address);

  const value = {
    certificateId,
    certificateHash: secondHash,
    issuer: institutionA.address,
    nonce,
    deadline,
  };

  const signature = await institutionA.signTypedData(
    domain,
    types,
    value
  );

  await expect(
    registry
      .connect(unauthorizedUser)
      .issueCertificateWithSignature(
        certificateId,
        secondHash,
        institutionA.address,
        nonce,
        deadline,
        signature
      )
  ).to.be.revertedWith("Certificate already exists");

  // The original certificate must remain unchanged.
  expect(
    await registry.verifyCertificate(certificateId, firstHash)
  ).to.equal(true);

  expect(
    await registry.verifyCertificate(certificateId, secondHash)
  ).to.equal(false);

  // Failed issuance must not consume the nonce.
  expect(
    await registry.nonces(institutionA.address)
  ).to.equal(0n);
});

it("should reject signatures from a deauthorized institution", async function () {
  const {
    registry,
    ethers,
    institutionA,
    unauthorizedUser,
  } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const certificateId = "CERT-EIP712-DEAUTHORIZED";
  const certificateHash = ethers.id("Deauthorized issuer test");

  const nonce = 0n;
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
    certificateId,
    certificateHash,
    issuer: institutionA.address,
    nonce,
    deadline,
  };

  // Institution signs while it is authorized.
  const signature = await institutionA.signTypedData(
    domain,
    types,
    value
  );

  // Super-admin revokes its authorization before submission.
  await registry.revokeIssuerAuthorization(institutionA.address);

  await expect(
    registry
      .connect(unauthorizedUser)
      .issueCertificateWithSignature(
        certificateId,
        certificateHash,
        institutionA.address,
        nonce,
        deadline,
        signature
      )
  ).to.be.revertedWith("Not an authorized issuer");

  expect(
    await registry.nonces(institutionA.address)
  ).to.equal(0n);
});
it("should reject an EIP-712 signature reused with a different certificate ID", async function () {
  const {
    registry,
    ethers,
    institutionA,
    unauthorizedUser,
  } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const originalCertificateId = "CERT-ORIGINAL-001";
  const tamperedCertificateId = "CERT-TAMPERED-001";

  const certificateHash = ethers.keccak256(
    ethers.toUtf8Bytes("Original certificate")
  );

  const nonce = 0n;

  const latestBlock = await ethers.provider.getBlock("latest");
  const deadline = BigInt(latestBlock!.timestamp + 3600);

  const networkInfo = await ethers.provider.getNetwork();

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
    certificateId: originalCertificateId,
    certificateHash,
    issuer: institutionA.address,
    nonce,
    deadline,
  };

  const signature = await institutionA.signTypedData(
    domain,
    types,
    value
  );

  await expect(
    registry.connect(unauthorizedUser).issueCertificateWithSignature(
      tamperedCertificateId,
      certificateHash,
      institutionA.address,
      nonce,
      deadline,
      signature
    )
  ).to.be.revertedWith("Invalid issuer signature");

  expect(await registry.nonces(institutionA.address)).to.equal(0n);
});
it("should reject an EIP-712 signature when the certificate ID is changed", async function () {
  const {
    registry,
    ethers,
    institutionA,
    unauthorizedUser,
  } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const networkInfo = await ethers.provider.getNetwork();
  const deadline = BigInt(
    (await ethers.provider.getBlock("latest"))!.timestamp + 3600
  );

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

  // Institution signs CERT-001.
  const value = {
    certificateId: "CERT-001",
    certificateHash: ethers.keccak256(
      ethers.toUtf8Bytes("Student Certificate")
    ),
    issuer: institutionA.address,
    nonce: 0,
    deadline,
  };

  const signature = await institutionA.signTypedData(
    domain,
    types,
    value
  );

  // Attacker changes the certificate ID to CERT-002.
  await expect(
    registry.connect(unauthorizedUser).issueCertificateWithSignature(
      "CERT-002",
      value.certificateHash,
      institutionA.address,
      0,
      deadline,
      signature
    )
  ).to.be.revertedWith("Invalid issuer signature");

  expect(await registry.nonces(institutionA.address)).to.equal(0);
});
it("should reject a signature created for a different contract", async function () {
  const {
    registry,
    ethers,
    institutionA,
    unauthorizedUser,
  } = await deployRegistry();

  // Deploy a second contract on the same network.
  const RegistryFactory = await ethers.getContractFactory(
    "CertificateRegistry"
  );

  const secondRegistry = await RegistryFactory.deploy();
  await secondRegistry.waitForDeployment();

  // Authorize the institution in both contracts.
  await registry.authorizeIssuer(institutionA.address);
  await secondRegistry.authorizeIssuer(institutionA.address);

  const networkInfo = await ethers.provider.getNetwork();

  const deadline = BigInt(
    (await ethers.provider.getBlock("latest"))!.timestamp + 3600
  );

  // Signature domain belongs to the FIRST contract.
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
    certificateId: "CERT-REPLAY-001",
    certificateHash: ethers.keccak256(
      ethers.toUtf8Bytes("Student Certificate")
    ),
    issuer: institutionA.address,
    nonce: 0,
    deadline,
  };

  const signature = await institutionA.signTypedData(
    domain,
    types,
    value
  );

  // Attempt to use the signature on the SECOND contract.
  await expect(
    secondRegistry.connect(unauthorizedUser).issueCertificateWithSignature(
      value.certificateId,
      value.certificateHash,
      institutionA.address,
      value.nonce,
      deadline,
      signature
    )
  ).to.be.revertedWith("Invalid issuer signature");

  expect(await secondRegistry.nonces(institutionA.address)).to.equal(0);
});
it("should reject an EIP-712 signature created for a different chain ID", async function () {
  const {
    registry,
    ethers,
    institutionA,
    unauthorizedUser,
  } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const networkInfo = await ethers.provider.getNetwork();

  const deadline = BigInt(
    (await ethers.provider.getBlock("latest"))!.timestamp + 3600
  );

  const domain = {
    name: "CertificateRegistry",
    version: "1",
    // Deliberately use the wrong chain ID.
    chainId: networkInfo.chainId + 1n,
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
    certificateId: "CERT-CHAIN-001",
    certificateHash: ethers.keccak256(
      ethers.toUtf8Bytes("Student Certificate")
    ),
    issuer: institutionA.address,
    nonce: 0,
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
      institutionA.address,
      value.nonce,
      deadline,
      signature
    )
  ).to.be.revertedWith("Invalid issuer signature");

  expect(await registry.nonces(institutionA.address)).to.equal(0);
});
it("should reject a malformed EIP-712 signature", async function () {
  const {
    registry,
    ethers,
    institutionA,
    unauthorizedUser,
  } = await deployRegistry();

  await registry.authorizeIssuer(institutionA.address);

  const networkInfo = await ethers.provider.getNetwork();

  const deadline = BigInt(
    (await ethers.provider.getBlock("latest"))!.timestamp + 3600
  );

  const malformedSignature = "0x1234";

  await expect(
    registry.connect(unauthorizedUser).issueCertificateWithSignature(
      "CERT-MALFORMED-001",
      ethers.keccak256(ethers.toUtf8Bytes("Student Certificate")),
      institutionA.address,
      0,
      deadline,
      malformedSignature
    )
    ).to.be.revert(ethers);

  expect(await registry.nonces(institutionA.address)).to.equal(0);
});
it("should not consume the nonce when signed issuance fails", async function () {
  const {
  registry,
  ethers,
  superAdmin,
  institutionA,
  unauthorizedUser,
  } = await deployRegistry();
  await registry
    .connect(superAdmin)
    .authorizeIssuer(institutionA.address);

  const networkInfo = await ethers.provider.getNetwork();

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

  const latestBlock = await ethers.provider.getBlock("latest");
  const deadline = BigInt(latestBlock!.timestamp + 3600);

  const value = {
    certificateId: "",
    certificateHash: ethers.keccak256(
      ethers.toUtf8Bytes("valid certificate content")
    ),
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
    registry
      .connect(unauthorizedUser)
      .issueCertificateWithSignature(
        value.certificateId,
        value.certificateHash,
        value.issuer,
        value.nonce,
        value.deadline,
        signature
      )
  ).to.be.revertedWith("Certificate ID required");

  expect(await registry.nonces(institutionA.address)).to.equal(0n);
});
it("PROPERTY: changing a signed certificate hash must invalidate the signature", async function () {
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

  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 100 }),
      async (documentContent) => {
        const originalHash = ethers.id(documentContent);
        const modifiedHash = ethers.id(`${documentContent}-modified`);

        const certificateId = `CERT-PROPERTY-${documentContent}`;

        const value = {
          certificateId,
          certificateHash: originalHash,
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
          registry
            .connect(unauthorizedUser)
            .issueCertificateWithSignature(
              certificateId,
              modifiedHash,
              institutionA.address,
              0n,
              deadline,
              signature
            )
        ).to.be.revertedWith("Invalid issuer signature");

        expect(
          await registry.nonces(institutionA.address)
        ).to.equal(0n);
      }
    ),
    { numRuns: 20 }
  );
});
it("should maintain independent nonces for different institutions", async function () {
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

  const valueA = {
    certificateId: "CERT-NONCE-A",
    certificateHash: ethers.id("Institution A certificate"),
    issuer: institutionA.address,
    nonce: 0n,
    deadline,
  };

  const valueB = {
    certificateId: "CERT-NONCE-B",
    certificateHash: ethers.id("Institution B certificate"),
    issuer: institutionB.address,
    nonce: 0n,
    deadline,
  };

  const signatureA = await institutionA.signTypedData(
    domain,
    types,
    valueA
  );

  const signatureB = await institutionB.signTypedData(
    domain,
    types,
    valueB
  );

  await registry.connect(unauthorizedUser).issueCertificateWithSignature(
    valueA.certificateId,
    valueA.certificateHash,
    valueA.issuer,
    valueA.nonce,
    valueA.deadline,
    signatureA
  );

  expect(await registry.nonces(institutionA.address)).to.equal(1n);
  expect(await registry.nonces(institutionB.address)).to.equal(0n);

  await registry.connect(unauthorizedUser).issueCertificateWithSignature(
    valueB.certificateId,
    valueB.certificateHash,
    valueB.issuer,
    valueB.nonce,
    valueB.deadline,
    signatureB
  );

  expect(await registry.nonces(institutionA.address)).to.equal(1n);
  expect(await registry.nonces(institutionB.address)).to.equal(1n);
});
it("should accept a signature when block timestamp equals its deadline", async function () {
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
    certificateId: "CERT-DEADLINE-BOUNDARY",
    certificateHash: ethers.id("Deadline boundary certificate"),
    issuer: institutionA.address,
    nonce: 0n,
    deadline,
  };

  const signature = await institutionA.signTypedData(
    domain,
    types,
    value
  );

  // Set the next transaction's block timestamp to the exact deadline.
  await ethers.provider.send("evm_setNextBlockTimestamp", [
    Number(deadline),
  ]);

  await registry.connect(unauthorizedUser).issueCertificateWithSignature(
    value.certificateId,
    value.certificateHash,
    value.issuer,
    value.nonce,
    value.deadline,
    signature
  );

  expect(
    await registry.verifyCertificate(
      value.certificateId,
      value.certificateHash
    )
  ).to.equal(true);
});
it("should prevent replaying a signature with a different certificate ID", async function () {
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

  const originalValue = {
    certificateId: "CERT-REPLAY-ORIGINAL",
    certificateHash: ethers.id("Original certificate"),
    issuer: institutionA.address,
    nonce: 0n,
    deadline,
  };

  const signature = await institutionA.signTypedData(
    domain,
    types,
    originalValue
  );

  // First submission succeeds.
  await registry.connect(unauthorizedUser).issueCertificateWithSignature(
    originalValue.certificateId,
    originalValue.certificateHash,
    originalValue.issuer,
    originalValue.nonce,
    originalValue.deadline,
    signature
  );

  // Attempt replay with a different certificate ID.
  await expect(
    registry.connect(unauthorizedUser).issueCertificateWithSignature(
      "CERT-REPLAY-MODIFIED",
      originalValue.certificateHash,
      originalValue.issuer,
      originalValue.nonce,
      originalValue.deadline,
      signature
    )
  ).to.be.revertedWith("Invalid nonce");

  expect(await registry.nonces(institutionA.address)).to.equal(1n);

  expect(
    await registry.verifyCertificate(
      originalValue.certificateId,
      originalValue.certificateHash
    )
  ).to.equal(true);

  expect(
    await registry.verifyCertificate(
      "CERT-REPLAY-MODIFIED",
      originalValue.certificateHash
    )
  ).to.equal(false);
});
});