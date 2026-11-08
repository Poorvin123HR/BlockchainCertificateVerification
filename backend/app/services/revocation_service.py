
from typing import Any

from web3 import Web3
from web3.exceptions import Web3Exception

from app.services.blockchain_service import (
    BlockchainUnavailableError,
    ContractConfigurationError,
    TransactionNotFoundError,
    get_blockchain_contract,
)


def verify_individual_revocation_transaction(
    batch_id: str,
    certificate_id: str,
    certificate_hash: str,
    proof: list[str],
    transaction_hash: str,
    expected_issuer: str,
) -> dict[str, Any]:
    """
    Independently verify a MetaMask individual certificate-revocation
    transaction before allowing the backend to update SQLite.

    The final individual revocation may automatically revoke the
    entire batch. Therefore, the current batch revoked status must
    not cause this transaction to be rejected.
    """

    if (
        not isinstance(transaction_hash, str)
        or not transaction_hash.startswith("0x")
        or len(transaction_hash) != 66
    ):
        raise ValueError("Invalid transaction hash format.")

    if not isinstance(proof, list) or not all(
        isinstance(item, str) for item in proof
    ):
        raise ValueError("Invalid Merkle proof format.")

    try:
        web3, contract = get_blockchain_contract()

        expected_issuer = Web3.to_checksum_address(expected_issuer)
        expected_contract_address = Web3.to_checksum_address(
            contract.address
        )

        expected_hash_bytes = Web3.to_bytes(
            hexstr=certificate_hash
        )

        if len(expected_hash_bytes) != 32:
            raise ValueError("Certificate hash must contain 32 bytes.")

        expected_proof_bytes = [
            Web3.to_bytes(hexstr=item)
            for item in proof
        ]

        if any(len(item) != 32 for item in expected_proof_bytes):
            raise ValueError(
                "Each Merkle proof element must contain 32 bytes."
            )

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
            raise ValueError("The blockchain transaction failed.")

        # Confirm the transaction destination.
        transaction_to = transaction.get("to")

        if (
            transaction_to is None
            or Web3.to_checksum_address(transaction_to)
            != expected_contract_address
        ):
            raise ValueError(
                "The transaction was not sent to the configured contract."
            )

        # Confirm the institution that signed the transaction.
        transaction_sender = Web3.to_checksum_address(
            transaction["from"]
        )

        if transaction_sender != expected_issuer:
            raise ValueError(
                "The transaction sender does not match the batch issuer."
            )

        # Confirm the blockchain network.
        transaction_chain_id = transaction.get("chainId")

        if (
            transaction_chain_id is not None
            and transaction_chain_id != web3.eth.chain_id
        ):
            raise ValueError(
                "The transaction belongs to a different blockchain network."
            )

        # Decode the submitted contract function and its arguments.
        called_function, arguments = contract.decode_function_input(
            transaction["input"]
        )

        if called_function.fn_name != "revokeBatchCertificate":
            raise ValueError(
                "The transaction did not call revokeBatchCertificate."
            )

        if arguments["batchId"] != batch_id:
            raise ValueError(
                "The transaction contains a different batch ID."
            )

        if arguments["certificateId"] != certificate_id:
            raise ValueError(
                "The transaction contains a different certificate ID."
            )

        if bytes(arguments["certificateHash"]) != expected_hash_bytes:
            raise ValueError(
                "The transaction contains a different certificate hash."
            )

        submitted_proof = [
            bytes(item) for item in arguments["proof"]
        ]

        if submitted_proof != expected_proof_bytes:
            raise ValueError(
                "The transaction contains a different Merkle proof."
            )

        # Check the batch's current on-chain state.
        on_chain_batch = contract.functions.certificateBatches(
            batch_id
        ).call()

        # CertificateBatch struct indexes:
        # [0] merkleRoot
        # [1] issuer
        # [2] createdAt
        # [3] totalCertificates
        # [4] revokedCertificateCount
        # [5] exists
        # [6] revoked

        if not on_chain_batch[5]:
            raise ValueError(
                "The batch does not exist on the blockchain."
            )

        # IMPORTANT:
        # Do not reject the transaction when on_chain_batch[6] is True.
        # The final individual revocation automatically marks the batch
        # as revoked. We verify the individual revocation and its event
        # below instead.

        on_chain_issuer = Web3.to_checksum_address(
            on_chain_batch[1]
        )

        if on_chain_issuer != expected_issuer:
            raise ValueError(
                "The on-chain batch issuer does not match the expected issuer."
            )

        # Verify the event emitted by this exact transaction.
        expected_event_signature = Web3.keccak(
            text="BatchCertificateRevoked(string,string,address)"
        )

        matching_event_found = False

        for log in receipt["logs"]:
            log_address = Web3.to_checksum_address(log["address"])

            if log_address != expected_contract_address:
                continue

            topics = log["topics"]

            if (
                not topics
                or bytes(topics[0]) != expected_event_signature
            ):
                continue

            if len(topics) != 2:
                continue

            event_batch_id, event_certificate_id = web3.codec.decode(
                ["string", "string"],
                log["data"],
            )

            event_issuer = Web3.to_checksum_address(
                "0x" + Web3.to_hex(topics[1])[-40:]
            )

            if (
                event_batch_id == batch_id
                and event_certificate_id == certificate_id
                and event_issuer == expected_issuer
            ):
                matching_event_found = True
                break

        if not matching_event_found:
            raise ValueError(
                "The receipt does not contain the expected "
                "BatchCertificateRevoked event from the configured contract."
            )

        # Confirm this particular certificate is revoked on-chain.
        individually_revoked = (
            contract.functions.revokedBatchCertificates(
                batch_id,
                certificate_id,
            ).call()
        )

        if not individually_revoked:
            raise ValueError(
                "The certificate is not marked as revoked on the blockchain."
            )

        return {
            "verified": True,
            "batch_id": batch_id,
            "certificate_id": certificate_id,
            "transaction_hash": Web3.to_hex(
                receipt["transactionHash"]
            ),
            "issuer": on_chain_issuer,
            "block_number": receipt["blockNumber"],
        }

    except (
        BlockchainUnavailableError,
        ContractConfigurationError,
        TransactionNotFoundError,
    ):
        raise

    except (Web3Exception, ValueError, TypeError, KeyError) as exc:
        raise ValueError(
            f"Individual revocation transaction verification failed: {exc}"
        ) from exc
