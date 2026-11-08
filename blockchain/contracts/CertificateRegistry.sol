
// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract CertificateRegistry is EIP712 {
    address public immutable superAdmin;

    bytes32 private constant CERTIFICATE_TYPEHASH =
        keccak256(
            "Certificate(string certificateId,bytes32 certificateHash,address issuer,uint256 nonce,uint256 deadline)"
        );

    struct Certificate {
        bytes32 certificateHash;
        address issuer;
        uint256 issuedAt;
        bool exists;
        bool revoked;
    }

    struct CertificateBatch {
        bytes32 merkleRoot;
        address issuer;
        uint256 createdAt;
        uint256 totalCertificates;
        uint256 revokedCertificateCount;
        bool exists;
        bool revoked;
    }

    mapping(address => bool) public authorizedIssuers;
    mapping(string => Certificate) private certificates;

    mapping(address => uint256) public nonces;

    mapping(string => CertificateBatch) public certificateBatches;

    mapping(string => mapping(string => bool))
        public revokedBatchCertificates;

    event IssuerAuthorized(address indexed institution);
    event IssuerAuthorizationRevoked(address indexed institution);

    event CertificateIssued(
        string certificateId,
        bytes32 certificateHash,
        address indexed issuer
    );

    event CertificateRevoked(
        string certificateId,
        address indexed issuer
    );

    event BatchRegistered(
        string batchId,
        bytes32 merkleRoot,
        address indexed issuer
    );

    event BatchRevoked(
        string batchId,
        address indexed issuer
    );

    event BatchCertificateRevoked(
        string batchId,
        string certificateId,
        address indexed issuer
    );

    constructor() EIP712("CertificateRegistry", "1") {
        superAdmin = msg.sender;
    }

    modifier onlySuperAdmin() {
        require(msg.sender == superAdmin, "Only super-admin");
        _;
    }

    modifier onlyAuthorizedIssuer() {
        require(
            authorizedIssuers[msg.sender],
            "Not an authorized issuer"
        );
        _;
    }

    function authorizeIssuer(address institution)
        external
        onlySuperAdmin
    {
        require(
            institution != address(0),
            "Invalid institution address"
        );

        require(
            !authorizedIssuers[institution],
            "Institution already authorized"
        );

        authorizedIssuers[institution] = true;

        emit IssuerAuthorized(institution);
    }

    function revokeIssuerAuthorization(address institution)
        external
        onlySuperAdmin
    {
        require(
            authorizedIssuers[institution],
            "Institution not authorized"
        );

        authorizedIssuers[institution] = false;

        emit IssuerAuthorizationRevoked(institution);
    }

    // Direct certificate issuance.
    function issueCertificate(
        string calldata certificateId,
        bytes32 certificateHash
    ) external onlyAuthorizedIssuer {
        _issueCertificate(
            certificateId,
            certificateHash,
            msg.sender
        );
    }

    // EIP-712 signature-based issuance.
    function issueCertificateWithSignature(
        string calldata certificateId,
        bytes32 certificateHash,
        address issuer,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(
            authorizedIssuers[issuer],
            "Not an authorized issuer"
        );

        require(
            block.timestamp <= deadline,
            "Signature expired"
        );

        require(
            nonce == nonces[issuer],
            "Invalid nonce"
        );

        bytes32 structHash = keccak256(
            abi.encode(
                CERTIFICATE_TYPEHASH,
                keccak256(bytes(certificateId)),
                certificateHash,
                issuer,
                nonce,
                deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);

        address recoveredSigner = ECDSA.recover(
            digest,
            signature
        );

        require(
            recoveredSigner == issuer,
            "Invalid issuer signature"
        );

        nonces[issuer]++;

        _issueCertificate(
            certificateId,
            certificateHash,
            issuer
        );
    }

    function _issueCertificate(
        string memory certificateId,
        bytes32 certificateHash,
        address issuer
    ) private {
        require(
            bytes(certificateId).length > 0,
            "Certificate ID required"
        );

        require(
            certificateHash != bytes32(0),
            "Invalid certificate hash"
        );

        require(
            !certificates[certificateId].exists,
            "Certificate already exists"
        );

        certificates[certificateId] = Certificate({
            certificateHash: certificateHash,
            issuer: issuer,
            issuedAt: block.timestamp,
            revoked: false,
            exists: true
        });

        emit CertificateIssued(
            certificateId,
            certificateHash,
            issuer
        );
    }

    // Direct certificate verification.
    function verifyCertificate(
        string calldata certificateId,
        bytes32 certificateHash
    ) external view returns (bool) {
        Certificate storage cert = certificates[certificateId];

        return (
            cert.exists &&
            !cert.revoked &&
            cert.certificateHash == certificateHash
        );
    }

    // Direct certificate revocation.
    function revokeCertificate(
        string calldata certificateId
    ) external {
        Certificate storage cert = certificates[certificateId];

        require(
            cert.exists,
            "Certificate does not exist"
        );

        require(
            cert.issuer == msg.sender,
            "Only issuing institution can revoke"
        );

        require(
            !cert.revoked,
            "Certificate already revoked"
        );

        cert.revoked = true;

        emit CertificateRevoked(
            certificateId,
            msg.sender
        );
    }

    // =========================================================
    // MERKLE TREE BATCH MANAGEMENT
    // =========================================================

    // Register a batch with its total certificate count.
    function registerBatch(
        string calldata batchId,
        bytes32 merkleRoot,
        uint256 certificateCount
    ) external onlyAuthorizedIssuer {
        require(
            bytes(batchId).length > 0,
            "Batch ID required"
        );

        require(
            merkleRoot != bytes32(0),
            "Invalid Merkle root"
        );

        require(
            certificateCount > 0,
            "Certificate count must be greater than zero"
        );

        require(
            !certificateBatches[batchId].exists,
            "Batch already exists"
        );

        certificateBatches[batchId] = CertificateBatch({
            merkleRoot: merkleRoot,
            issuer: msg.sender,
            createdAt: block.timestamp,
            totalCertificates: certificateCount,
            revokedCertificateCount: 0,
            exists: true,
            revoked: false
        });

        emit BatchRegistered(
            batchId,
            merkleRoot,
            msg.sender
        );
    }

    // Verify a certificate's Merkle membership and revocation status.
    function verifyBatchCertificate(
        string calldata batchId,
        string calldata certificateId,
        bytes32 certificateHash,
        bytes32[] calldata proof
    ) external view returns (bool) {
        CertificateBatch storage batch = certificateBatches[batchId];

        if (!batch.exists || batch.revoked) {
            return false;
        }

        if (
            bytes(certificateId).length == 0 ||
            certificateHash == bytes32(0)
        ) {
            return false;
        }

        if (revokedBatchCertificates[batchId][certificateId]) {
            return false;
        }

        bytes32 leaf = _getBatchLeaf(
            batchId,
            certificateId,
            certificateHash,
            batch.issuer
        );

        return MerkleProof.verifyCalldata(
            proof,
            batch.merkleRoot,
            leaf
        );
    }

    // Individually revoke a certificate inside a Merkle batch.
    function revokeBatchCertificate(
        string calldata batchId,
        string calldata certificateId,
        bytes32 certificateHash,
        bytes32[] calldata proof
    ) external {
        CertificateBatch storage batch = certificateBatches[batchId];

        require(
            batch.exists,
            "Batch does not exist"
        );

        require(
            !batch.revoked,
            "Batch already revoked"
        );

        require(
            batch.issuer == msg.sender,
            "Only issuing institution can revoke"
        );

        require(
            bytes(certificateId).length > 0,
            "Certificate ID required"
        );

        require(
            certificateHash != bytes32(0),
            "Invalid certificate hash"
        );

        require(
            !revokedBatchCertificates[batchId][certificateId],
            "Certificate already revoked"
        );

        bytes32 leaf = _getBatchLeaf(
            batchId,
            certificateId,
            certificateHash,
            batch.issuer
        );

        require(
            MerkleProof.verifyCalldata(
                proof,
                batch.merkleRoot,
                leaf
            ),
            "Invalid certificate Merkle proof"
        );

        // Record individual revocation.
        revokedBatchCertificates[batchId][certificateId] = true;

        // Increase the batch's revoked certificate count.
        batch.revokedCertificateCount++;

        emit BatchCertificateRevoked(
            batchId,
            certificateId,
            msg.sender
        );

        // Automatically revoke the batch when every certificate
        // has been individually revoked.
        if (
            batch.revokedCertificateCount ==
            batch.totalCertificates
        ) {
            batch.revoked = true;

            emit BatchRevoked(
                batchId,
                msg.sender
            );
        }
    }

    // Generate the same double-hashed leaf used by the Merkle generator.
    function _getBatchLeaf(
        string calldata batchId,
        string calldata certificateId,
        bytes32 certificateHash,
        address issuer
    ) private pure returns (bytes32) {
        bytes32 innerHash = keccak256(
            abi.encode(
                batchId,
                certificateId,
                certificateHash,
                issuer
            )
        );

        return keccak256(bytes.concat(innerHash));
    }

    // Manually revoke every certificate belonging to a batch.
    function revokeBatch(
        string calldata batchId
    ) external {
        CertificateBatch storage batch = certificateBatches[batchId];

        require(
            batch.exists,
            "Batch does not exist"
        );

        require(
            batch.issuer == msg.sender,
            "Only issuing institution can revoke batch"
        );

        require(
            !batch.revoked,
            "Batch already revoked"
        );

        batch.revoked = true;

        emit BatchRevoked(
            batchId,
            msg.sender
        );
    }
}
