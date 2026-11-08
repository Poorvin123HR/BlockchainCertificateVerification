
import json
from pathlib import Path
from typing import Any

from web3 import Web3
from web3.exceptions import Web3Exception

from app.core.config import settings


BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_DIR = BACKEND_DIR.parent

CONTRACT_ARTIFACT_PATH = (
    PROJECT_DIR
    / "blockchain"
    / "artifacts"
    / "contracts"
    / "CertificateRegistry.sol"
    / "CertificateRegistry.json"
)


class BlockchainUnavailableError(Exception):
    """Raised when the backend cannot connect to the blockchain."""


class ContractConfigurationError(Exception):
    """Raised when the contract artifact or configuration is invalid."""


class TransactionNotFoundError(Exception):
    """Raised when a transaction has not been found or mined yet."""


def get_blockchain_contract():
    """
    Connect to the configured blockchain and load the CertificateRegistry
    contract using its compiled ABI.
    """

    if not CONTRACT_ARTIFACT_PATH.exists():
        raise ContractConfigurationError(
            f"Contract artifact not found: {CONTRACT_ARTIFACT_PATH}"
        )

    try:
        artifact = json.loads(
            CONTRACT_ARTIFACT_PATH.read_text(encoding="utf-8")
        )
        contract_abi = artifact["abi"]

    except (json.JSONDecodeError, KeyError, OSError) as exc:
        raise ContractConfigurationError(
            "Could not load the CertificateRegistry contract ABI."
        ) from exc

    try:
        web3 = Web3(
            Web3.HTTPProvider(
                settings.BLOCKCHAIN_RPC_URL,
                request_kwargs={"timeout": 10},
            )
        )

        if not web3.is_connected():
            raise BlockchainUnavailableError(
                "Could not connect to the configured blockchain RPC."
            )

        contract_address = Web3.to_checksum_address(
            settings.CONTRACT_ADDRESS
        )

        contract = web3.eth.contract(
            address=contract_address,
            abi=contract_abi,
        )

        return web3, contract

    except BlockchainUnavailableError:
        raise

    except (ValueError, Web3Exception, OSError) as exc:
        raise BlockchainUnavailableError(
            "Blockchain connection or contract configuration failed."
        ) from exc


def get_batch_status(batch_id: str) -> dict[str, Any]:
    """
    Retrieve registered Merkle batch details from the blockchain.

    CertificateBatch field order:
    0: merkleRoot
    1: issuer
    2: createdAt
    3: totalCertificates
    4: revokedCertificateCount
    5: exists
    6: revoked
    """

    try:
        _, contract = get_blockchain_contract()

        batch = contract.functions.certificateBatches(
            batch_id
        ).call()

        return {
            "batch_id": batch_id,
            "merkle_root": Web3.to_hex(batch[0]),
            "issuer": batch[1],
            "created_at": batch[2],
            "total_certificates": batch[3],
            "revoked_certificate_count": batch[4],
            "exists": batch[5],
            "revoked": batch[6],
        }

    except (BlockchainUnavailableError, ContractConfigurationError):
        raise

    except (Web3Exception, ValueError, TypeError, IndexError) as exc:
        raise BlockchainUnavailableError(
            "Could not retrieve batch information from the blockchain."
        ) from exc


def verify_batch_registration_transaction(
    batch_id: str,
    transaction_hash: str,
    expected_issuer: str,
    expected_merkle_root: str,
    expected_certificate_count: int,
) -> dict[str, Any]:
    """
    Independently verify a MetaMask batch-registration transaction.

    Checks:
    1. The transaction exists and has a successful receipt.
    2. It was sent to the configured CertificateRegistry contract.
    3. The sender is the expected institution.
    4. It called registerBatch with the expected batch ID, root,
       and certificate count.
    5. The receipt contains the matching BatchRegistered event.
    6. The resulting on-chain batch matches the expected values.
    """

    if (
        not isinstance(transaction_hash, str)
        or not transaction_hash.startswith("0x")
        or len(transaction_hash) != 66
    ):
        raise ValueError("Invalid transaction hash format.")

    if (
        not isinstance(expected_certificate_count, int)
        or isinstance(expected_certificate_count, bool)
        or expected_certificate_count <= 0
    ):
        raise ValueError(
            "Expected certificate count must be a positive integer."
        )

    try:
        web3, contract = get_blockchain_contract()

        expected_issuer = Web3.to_checksum_address(expected_issuer)
        expected_contract_address = Web3.to_checksum_address(
            contract.address
        )
        expected_merkle_root_bytes = Web3.to_bytes(
            hexstr=expected_merkle_root
        )

        if len(expected_merkle_root_bytes) != 32:
            raise ValueError("Invalid expected Merkle root.")

        try:
            receipt = web3.eth.get_transaction_receipt(
                transaction_hash
            )

            transaction = web3.eth.get_transaction(
                transaction_hash
            )

        except Exception as exc:
            raise TransactionNotFoundError(
                "The transaction has not been found or mined yet."
            ) from exc

        if receipt["status"] != 1:
            raise ValueError(
                "The blockchain transaction failed."
            )

        transaction_to = transaction.get("to")

        if (
            transaction_to is None
            or Web3.to_checksum_address(transaction_to)
            != expected_contract_address
        ):
            raise ValueError(
                "The transaction was not sent to the configured contract."
            )

        transaction_sender = Web3.to_checksum_address(
            transaction["from"]
        )

        if transaction_sender != expected_issuer:
            raise ValueError(
                "The transaction sender does not match the batch issuer."
            )

        transaction_chain_id = transaction.get("chainId")

        if (
            transaction_chain_id is not None
            and transaction_chain_id != web3.eth.chain_id
        ):
            raise ValueError(
                "The transaction belongs to a different blockchain network."
            )

        called_function, arguments = contract.decode_function_input(
            transaction["input"]
        )

        if called_function.fn_name != "registerBatch":
            raise ValueError(
                "The transaction did not call registerBatch."
            )

        if arguments["batchId"] != batch_id:
            raise ValueError(
                "The transaction contains a different batch ID."
            )

        submitted_root = bytes(arguments["merkleRoot"])

        if submitted_root != expected_merkle_root_bytes:
            raise ValueError(
                "The transaction contains a different Merkle root."
            )

        submitted_count = int(arguments["certificateCount"])

        if submitted_count != expected_certificate_count:
            raise ValueError(
                "The transaction contains a different certificate count."
            )

        expected_event_signature = Web3.keccak(
            text="BatchRegistered(string,bytes32,address)"
        )

        matching_event_found = False

        for log in receipt["logs"]:
            log_address = Web3.to_checksum_address(log["address"])

            if log_address != expected_contract_address:
                continue

            topics = log["topics"]

            if not topics or bytes(topics[0]) != expected_event_signature:
                continue

            if len(topics) != 2:
                continue

            event_batch_id, event_merkle_root = web3.codec.decode(
                ["string", "bytes32"],
                log["data"],
            )

            event_issuer = Web3.to_checksum_address(
                "0x" + Web3.to_hex(topics[1])[-40:]
            )

            if (
                event_batch_id == batch_id
                and bytes(event_merkle_root)
                == expected_merkle_root_bytes
                and event_issuer == expected_issuer
            ):
                matching_event_found = True
                break

        if not matching_event_found:
            raise ValueError(
                "The transaction receipt does not contain the expected "
                "BatchRegistered event from the configured contract."
            )

        on_chain_batch = contract.functions.certificateBatches(
            batch_id
        ).call()

        on_chain_root = bytes(on_chain_batch[0])

        on_chain_issuer = Web3.to_checksum_address(
            on_chain_batch[1]
        )

        # Correct indexes for the updated CertificateBatch struct.
        on_chain_certificate_count = int(on_chain_batch[3])

        if not on_chain_batch[5]:
            raise ValueError(
                "The batch does not exist on the blockchain."
            )

        if on_chain_batch[6]:
            raise ValueError(
                "The registered batch is already revoked."
            )

        if on_chain_root != expected_merkle_root_bytes:
            raise ValueError(
                "The on-chain Merkle root does not match the prepared batch."
            )

        if on_chain_issuer != expected_issuer:
            raise ValueError(
                "The on-chain issuer does not match the prepared batch."
            )

        if on_chain_certificate_count != expected_certificate_count:
            raise ValueError(
                "The on-chain certificate count does not match "
                "the prepared batch."
            )

        return {
            "verified": True,
            "batch_id": batch_id,
            "transaction_hash": Web3.to_hex(
                receipt["transactionHash"]
            ),
            "issuer": on_chain_issuer,
            "merkle_root": Web3.to_hex(on_chain_root),
            "certificate_count": on_chain_certificate_count,
            "block_number": receipt["blockNumber"],
        }

    except (
        BlockchainUnavailableError,
        ContractConfigurationError,
        TransactionNotFoundError,
    ):
        raise

    except (Web3Exception, ValueError, TypeError, KeyError, IndexError) as exc:
        raise ValueError(
            f"Batch registration transaction verification failed: {exc}"
        ) from exc


def verify_merkle_certificate(
    batch_id: str,
    certificate_id: str,
    certificate_hash: str,
    proof: list[str],
) -> dict[str, Any]:
    """
    Verify a certificate's Merkle proof against its registered batch.

    certificate_hash must be the SHA-256 hash represented as hexadecimal.
    Each proof element must be a 32-byte hexadecimal value.
    """

    try:
        _, contract = get_blockchain_contract()

        batch = contract.functions.certificateBatches(
            batch_id
        ).call()

        # Correct indexes for the updated CertificateBatch struct.
        batch_exists = batch[5]
        batch_revoked = batch[6]

        if not batch_exists:
            return {
                "verified": False,
                "status": "NOT_REGISTERED",
                "message": "This batch is not registered on the blockchain.",
            }

        if batch_revoked:
            return {
                "verified": False,
                "status": "REVOKED",
                "revocation_scope": "BATCH",
                "message": "This certificate's batch has been revoked.",
            }

        individually_revoked = (
            contract.functions.revokedBatchCertificates(
                batch_id,
                certificate_id,
            ).call()
        )

        if individually_revoked:
            return {
                "verified": False,
                "status": "REVOKED",
                "revocation_scope": "INDIVIDUAL",
                "message": "This certificate has been individually revoked.",
            }

        hash_bytes = Web3.to_bytes(hexstr=certificate_hash)

        if len(hash_bytes) != 32:
            raise ValueError(
                "Certificate hash must contain exactly 32 bytes."
            )

        proof_bytes = [
            Web3.to_bytes(hexstr=item)
            for item in proof
        ]

        if any(len(item) != 32 for item in proof_bytes):
            raise ValueError(
                "Each Merkle proof element must contain 32 bytes."
            )

        verified = contract.functions.verifyBatchCertificate(
            batch_id,
            certificate_id,
            hash_bytes,
            proof_bytes,
        ).call()

        return {
            "verified": bool(verified),
            "status": "VALID" if verified else "INVALID",
            "message": (
                "Certificate successfully verified on the blockchain."
                if verified
                else (
                    "Certificate verification failed. "
                    "The proof or certificate data does not match."
                )
            ),
        }

    except (BlockchainUnavailableError, ContractConfigurationError):
        raise

    except (Web3Exception, ValueError, TypeError) as exc:
        raise BlockchainUnavailableError(
            "The blockchain verification request could not be completed."
        ) from exc
