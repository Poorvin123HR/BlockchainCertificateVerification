
import { expect } from "chai";
import { network } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

describe("CertificateRegistry - Merkle Batch Verification", function () {
  async function deployRegistry() {
    const connection = await network.create();
    const { ethers } = connection;

    const [
      superAdmin,
      institutionA,
      institutionB,
      unauthorizedUser,
    ] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory(
      "CertificateRegistry"
    );

    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    await registry
      .connect(superAdmin)
      .authorizeIssuer(institutionA.address);

    await registry
      .connect(superAdmin)
      .authorizeIssuer(institutionB.address);

    return {
      registry,
      ethers,
      superAdmin,
      institutionA,
      institutionB,
      unauthorizedUser,
    };
  }

  function createMerkleTree(
    batchId: string,
    issuer: string,
    certificates: {
      certificateId: string;
      certificateHash: string;
    }[]
  ) {
    const values = certificates.map((cert) => [
      batchId,
      cert.certificateId,
      cert.certificateHash,
      issuer,
    ]);

    return StandardMerkleTree.of(
      values,
      ["string", "string", "bytes32", "address"]
    );
  }

  it("should allow an authorized institution to register a batch", async function () {
    const { registry, institutionA } = await deployRegistry();

    const batchId = "BATCH-001";
    const merkleRoot = "0x" + "11".repeat(32);

    await expect(
      registry
        .connect(institutionA)
        .registerBatch(batchId, merkleRoot, 1)
    ).to.emit(registry, "BatchRegistered");

    const batch = await registry.certificateBatches(batchId);

    expect(batch.merkleRoot).to.equal(merkleRoot);
    expect(batch.issuer).to.equal(institutionA.address);
    expect(batch.exists).to.equal(true);
    expect(batch.revoked).to.equal(false);
  });

  it("should reject batch registration by an unauthorized wallet", async function () {
    const { registry, unauthorizedUser } = await deployRegistry();

    const merkleRoot = "0x" + "22".repeat(32);

    await expect(
      registry
        .connect(unauthorizedUser)
        .registerBatch("BATCH-002", merkleRoot, 1)
    ).to.be.revertedWith("Not an authorized issuer");
  });

  it("should successfully verify a valid Merkle proof", async function () {
    const { registry, institutionA } = await deployRegistry();

    const batchId = "BATCH-003";

    const certificates = [
      {
        certificateId: "CERT-001",
        certificateHash: "0x" + "01".repeat(32),
      },
      {
        certificateId: "CERT-002",
        certificateHash: "0x" + "02".repeat(32),
      },
      {
        certificateId: "CERT-003",
        certificateHash: "0x" + "03".repeat(32),
      },
    ];

    const tree = createMerkleTree(
      batchId,
      institutionA.address,
      certificates
    );

    await registry
      .connect(institutionA)
      .registerBatch(batchId, tree.root, certificates.length);

    const [index, value] = [...tree.entries()][1];
    const proof = tree.getProof(index);

    const result = await registry.verifyBatchCertificate(
      value[0],
      value[1],
      value[2],
      proof
    );

    expect(result).to.equal(true);
  });

  it("should reject an invalid Merkle proof", async function () {
    const { registry, institutionA } = await deployRegistry();

    const batchId = "BATCH-004";

    const certificates = [
      {
        certificateId: "CERT-101",
        certificateHash: "0x" + "11".repeat(32),
      },
      {
        certificateId: "CERT-102",
        certificateHash: "0x" + "22".repeat(32),
      },
    ];

    const tree = createMerkleTree(
      batchId,
      institutionA.address,
      certificates
    );

    await registry
      .connect(institutionA)
      .registerBatch(batchId, tree.root, certificates.length);

    const [index] = [...tree.entries()][0];
    const proof = tree.getProof(index);

    const invalidProof = [
      "0x" + "99".repeat(32),
    ];

    expect(
      await registry.verifyBatchCertificate(
        batchId,
        "CERT-101",
        certificates[0].certificateHash,
        invalidProof
      )
    ).to.equal(false);

    expect(proof.length >= 0).to.equal(true);
  });

  it("should reject incorrect certificate details", async function () {
    const { registry, institutionA } = await deployRegistry();

    const batchId = "BATCH-005";

    const certificates = [
      {
        certificateId: "CERT-201",
        certificateHash: "0x" + "33".repeat(32),
      },
      {
        certificateId: "CERT-202",
        certificateHash: "0x" + "44".repeat(32),
      },
    ];

    const tree = createMerkleTree(
      batchId,
      institutionA.address,
      certificates
    );

    await registry
      .connect(institutionA)
      .registerBatch(batchId, tree.root, certificates.length);

    const [index] = [...tree.entries()][0];
    const proof = tree.getProof(index);

    const result = await registry.verifyBatchCertificate(
      batchId,
      "WRONG-CERTIFICATE",
      certificates[0].certificateHash,
      proof
    );

    expect(result).to.equal(false);
  });

  it("should reject a proof from another batch", async function () {
    const { registry, institutionA } = await deployRegistry();

    const batchA = "BATCH-006-A";
    const batchB = "BATCH-006-B";

    const certificates = [
      {
        certificateId: "CERT-301",
        certificateHash: "0x" + "55".repeat(32),
      },
      {
        certificateId: "CERT-302",
        certificateHash: "0x" + "66".repeat(32),
      },
    ];

    const treeA = createMerkleTree(
      batchA,
      institutionA.address,
      certificates
    );

    const treeB = createMerkleTree(
      batchB,
      institutionA.address,
      certificates
    );

    await registry
      .connect(institutionA)
      .registerBatch(batchA, treeA.root, certificates.length);

    await registry
      .connect(institutionA)
      .registerBatch(batchB, treeB.root, certificates.length);

    const [index] = [...treeA.entries()][0];
    const proofFromA = treeA.getProof(index);

    const result = await registry.verifyBatchCertificate(
      batchB,
      certificates[0].certificateId,
      certificates[0].certificateHash,
      proofFromA
    );

    expect(result).to.equal(false);
  });

  it("should allow only the registering institution to revoke a batch", async function () {
    const {
      registry,
      institutionA,
      institutionB,
    } = await deployRegistry();

    const batchId = "BATCH-007";
    const merkleRoot = "0x" + "77".repeat(32);

    await registry
      .connect(institutionA)
      .registerBatch(batchId, merkleRoot, 1);

    await expect(
      registry
        .connect(institutionB)
        .revokeBatch(batchId)
    ).to.be.revertedWith(
      "Only issuing institution can revoke batch"
    );

    await expect(
      registry
        .connect(institutionA)
        .revokeBatch(batchId)
    ).to.emit(registry, "BatchRevoked");
  });

  it("should reject verification after batch revocation", async function () {
    const { registry, institutionA } = await deployRegistry();

    const batchId = "BATCH-008";

    const certificates = [
      {
        certificateId: "CERT-401",
        certificateHash: "0x" + "88".repeat(32),
      },
      {
        certificateId: "CERT-402",
        certificateHash: "0x" + "99".repeat(32),
      },
    ];

    const tree = createMerkleTree(
      batchId,
      institutionA.address,
      certificates
    );

    await registry
      .connect(institutionA)
      .registerBatch(batchId, tree.root, certificates.length);

    const [index] = [...tree.entries()][0];
    const proof = tree.getProof(index);

    await registry
      .connect(institutionA)
      .revokeBatch(batchId);

    const result = await registry.verifyBatchCertificate(
      batchId,
      certificates[0].certificateId,
      certificates[0].certificateHash,
      proof
    );

    expect(result).to.equal(false);
  });

  it("should reject duplicate batch IDs", async function () {
    const { registry, institutionA } = await deployRegistry();

    const batchId = "BATCH-009";

    await registry
      .connect(institutionA)
      .registerBatch(
        batchId,
        "0x" + "aa".repeat(32),
        1
      );

    await expect(
      registry
        .connect(institutionA)
        .registerBatch(
          batchId,
          "0x" + "bb".repeat(32),
          1
        )
    ).to.be.revertedWith("Batch already exists");
  });

  it("should reject empty batch IDs and zero Merkle roots", async function () {
    const { registry, institutionA } = await deployRegistry();

    await expect(
      registry
        .connect(institutionA)
        .registerBatch(
          "",
          "0x" + "cc".repeat(32),
          1
        )
    ).to.be.revertedWith("Batch ID required");

    await expect(
      registry
        .connect(institutionA)
        .registerBatch(
          "BATCH-010",
          "0x" + "00".repeat(32),
          1
        )
    ).to.be.revertedWith("Invalid Merkle root");
  });

  // INDIVIDUAL CERTIFICATE REVOCATION TESTS

  it("should allow the issuing institution to revoke one certificate without revoking the entire batch", async function () {
    const { registry, institutionA } = await deployRegistry();

    const batchId = "BATCH-011";

    const certificates = [
      {
        certificateId: "CERT-501",
        certificateHash: "0x" + "a1".repeat(32),
      },
      {
        certificateId: "CERT-502",
        certificateHash: "0x" + "a2".repeat(32),
      },
    ];

    const tree = createMerkleTree(
      batchId,
      institutionA.address,
      certificates
    );

    await registry
      .connect(institutionA)
      .registerBatch(batchId, tree.root, certificates.length);

    const entries = [...tree.entries()];

    const [firstIndex] = entries[0];
    const firstProof = tree.getProof(firstIndex);

    const [secondIndex] = entries[1];
    const secondProof = tree.getProof(secondIndex);

    await expect(
      registry
        .connect(institutionA)
        .revokeBatchCertificate(
          batchId,
          certificates[0].certificateId,
          certificates[0].certificateHash,
          firstProof
        )
    ).to.emit(registry, "BatchCertificateRevoked");

    expect(
      await registry.revokedBatchCertificates(
        batchId,
        certificates[0].certificateId
      )
    ).to.equal(true);

    expect(
      await registry.verifyBatchCertificate(
        batchId,
        certificates[0].certificateId,
        certificates[0].certificateHash,
        firstProof
      )
    ).to.equal(false);

    expect(
      await registry.verifyBatchCertificate(
        batchId,
        certificates[1].certificateId,
        certificates[1].certificateHash,
        secondProof
      )
    ).to.equal(true);

    const batch = await registry.certificateBatches(batchId);

    expect(batch.revoked).to.equal(false);
    expect(batch.totalCertificates).to.equal(2n);
    expect(batch.revokedCertificateCount).to.equal(1n);
  });

  it("should automatically revoke a batch when all its certificates are individually revoked", async function () {
    const { registry, institutionA } = await deployRegistry();

    const batchId = "BATCH-AUTO-REVOKE";

    const certificates = [
      {
        certificateId: "CERT-AUTO-001",
        certificateHash: "0x" + "ab".repeat(32),
      },
      {
        certificateId: "CERT-AUTO-002",
        certificateHash: "0x" + "cd".repeat(32),
      },
    ];

    const tree = createMerkleTree(
      batchId,
      institutionA.address,
      certificates
    );

    await registry
      .connect(institutionA)
      .registerBatch(batchId, tree.root, certificates.length);

    const entries = [...tree.entries()];
    const firstProof = tree.getProof(entries[0][0]);
    const secondProof = tree.getProof(entries[1][0]);

    await registry
      .connect(institutionA)
      .revokeBatchCertificate(
        batchId,
        certificates[0].certificateId,
        certificates[0].certificateHash,
        firstProof
      );

    let batch = await registry.certificateBatches(batchId);

    expect(batch.revoked).to.equal(false);
    expect(batch.totalCertificates).to.equal(2n);
    expect(batch.revokedCertificateCount).to.equal(1n);

    await expect(
      registry
        .connect(institutionA)
        .revokeBatchCertificate(
          batchId,
          certificates[1].certificateId,
          certificates[1].certificateHash,
          secondProof
        )
    ).to.emit(registry, "BatchRevoked");

    batch = await registry.certificateBatches(batchId);

    expect(batch.revoked).to.equal(true);
    expect(batch.totalCertificates).to.equal(2n);
    expect(batch.revokedCertificateCount).to.equal(2n);

    expect(
      await registry.verifyBatchCertificate(
        batchId,
        certificates[0].certificateId,
        certificates[0].certificateHash,
        firstProof
      )
    ).to.equal(false);

    expect(
      await registry.verifyBatchCertificate(
        batchId,
        certificates[1].certificateId,
        certificates[1].certificateHash,
        secondProof
      )
    ).to.equal(false);
  });

  it("should reject individual certificate revocation by another institution", async function () {
    const {
      registry,
      ethers,
      institutionA,
      institutionB,
    } = await deployRegistry();

    const batchId = "BATCH-012";

    const certificates = [
      {
        certificateId: "CERT-601",
        certificateHash: "0x" + "b1".repeat(32),
      },
    ];

    const tree = createMerkleTree(
      batchId,
      institutionA.address,
      certificates
    );

    await registry
      .connect(institutionA)
      .registerBatch(batchId, tree.root, certificates.length);

    const [index] = [...tree.entries()][0];
    const proof = tree.getProof(index);

    await expect(
      registry
        .connect(institutionB)
        .revokeBatchCertificate(
          batchId,
          certificates[0].certificateId,
          certificates[0].certificateHash,
          proof
        )
    ).to.be.revert(ethers);
  });

  it("should reject individual certificate revocation by an unauthorized wallet", async function () {
    const {
      registry,
      ethers,
      institutionA,
      unauthorizedUser,
    } = await deployRegistry();

    const batchId = "BATCH-013";

    const certificates = [
      {
        certificateId: "CERT-701",
        certificateHash: "0x" + "c1".repeat(32),
      },
    ];

    const tree = createMerkleTree(
      batchId,
      institutionA.address,
      certificates
    );

    await registry
      .connect(institutionA)
      .registerBatch(batchId, tree.root, certificates.length);

    const [index] = [...tree.entries()][0];
    const proof = tree.getProof(index);

    await expect(
      registry
        .connect(unauthorizedUser)
        .revokeBatchCertificate(
          batchId,
          certificates[0].certificateId,
          certificates[0].certificateHash,
          proof
        )
    ).to.be.revert(ethers);
  });

  it("should reject individual certificate revocation with an invalid Merkle proof", async function () {
    const {
      registry,
      ethers,
      institutionA,
    } = await deployRegistry();

    const batchId = "BATCH-014";

    const certificates = [
      {
        certificateId: "CERT-801",
        certificateHash: "0x" + "d1".repeat(32),
      },
    ];

    const tree = createMerkleTree(
      batchId,
      institutionA.address,
      certificates
    );

    await registry
      .connect(institutionA)
      .registerBatch(batchId, tree.root, certificates.length);

    const invalidProof = [
      "0x" + "ee".repeat(32),
    ];

    await expect(
      registry
        .connect(institutionA)
        .revokeBatchCertificate(
          batchId,
          certificates[0].certificateId,
          certificates[0].certificateHash,
          invalidProof
        )
    ).to.be.revert(ethers);
  });

  it("should reject revoking the same certificate twice", async function () {
    const {
      registry,
      ethers,
      institutionA,
    } = await deployRegistry();

    const batchId = "BATCH-015";

    const certificates = [
      {
        certificateId: "CERT-901",
        certificateHash: "0x" + "f1".repeat(32),
      },
    ];

    const tree = createMerkleTree(
      batchId,
      institutionA.address,
      certificates
    );

    await registry
      .connect(institutionA)
      .registerBatch(batchId, tree.root, certificates.length);

    const [index] = [...tree.entries()][0];
    const proof = tree.getProof(index);

    await registry
      .connect(institutionA)
      .revokeBatchCertificate(
        batchId,
        certificates[0].certificateId,
        certificates[0].certificateHash,
        proof
      );

    await expect(
      registry
        .connect(institutionA)
        .revokeBatchCertificate(
          batchId,
          certificates[0].certificateId,
          certificates[0].certificateHash,
          proof
        )
    ).to.be.revert(ethers);
  });
});
