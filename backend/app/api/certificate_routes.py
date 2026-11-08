
import json
import sqlite3
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.core.database import get_connection
from app.services.automatic_batch_service import prepare_batch_if_ready
from app.services.blockchain_service import (
    BlockchainUnavailableError,
    ContractConfigurationError,
    TransactionNotFoundError,
    get_batch_status,
    verify_merkle_certificate,
)
from app.services.revocation_service import (
    verify_individual_revocation_transaction,
)
from app.services.ipfs_service import upload_to_pinata
from app.utils.file_validation import calculate_sha256, validate_pdf


router = APIRouter(prefix="/certificates", tags=["Certificates"])


class IndividualRevocationRequest(BaseModel):
    transaction_hash: str = Field(
        pattern=r"^0x[a-fA-F0-9]{64}$"
    )


def synchronize_revoked_certificate(certificate_id: str) -> None:
    """Update one certificate confirmed as individually revoked."""

    try:
        with get_connection() as connection:
            result = connection.execute(
                """
                UPDATE certificates
                SET status = 'REVOKED'
                WHERE certificate_id = ?
                """,
                (certificate_id,),
            )

            if result.rowcount == 0:
                raise RuntimeError(
                    "The revoked certificate was not found in the database."
                )

    except sqlite3.Error as exc:
        raise RuntimeError(
            "Could not synchronize certificate revocation with SQLite."
        ) from exc


def synchronize_revoked_batch(batch_id: str) -> None:
    """Synchronize a blockchain-confirmed revoked batch with SQLite."""

    try:
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")

            batch_result = connection.execute(
                """
                UPDATE batches
                SET status = 'REVOKED'
                WHERE batch_id = ?
                """,
                (batch_id,),
            )

            if batch_result.rowcount == 0:
                raise RuntimeError(
                    "The revoked batch was not found in the database."
                )

            connection.execute(
                """
                UPDATE certificates
                SET status = 'REVOKED'
                WHERE batch_id = ?
                """,
                (batch_id,),
            )

    except sqlite3.Error as exc:
        raise RuntimeError(
            "Could not synchronize the revoked batch with SQLite."
        ) from exc


@router.post("/upload")
async def upload_certificate(file: UploadFile = File(...)):
    content = await file.read()

    try:
        filename = validate_pdf(file.filename or "", content)
        certificate_hash = calculate_sha256(content)

        ipfs_result = await upload_to_pinata(filename, content)
        certificate_id = f"CERT-{uuid.uuid4().hex[:12].upper()}"

        try:
            with get_connection() as connection:
                connection.execute(
                    """
                    INSERT INTO certificates (
                        certificate_id, sha256, ipfs_cid, filename, status
                    )
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        certificate_id,
                        certificate_hash,
                        ipfs_result["cid"],
                        filename,
                        "PENDING",
                    ),
                )

        except sqlite3.Error:
            raise HTTPException(
                status_code=500,
                detail=(
                    "Certificate was uploaded to IPFS but "
                    "could not be saved in the database."
                ),
            )

        # Try to prepare a batch automatically.
        try:
            batch_result = await run_in_threadpool(
                prepare_batch_if_ready,
            )
        except Exception as exc:
            print("Automatic batch preparation failed:", exc)
            batch_result = {
                "prepared": False,
                "error": "Automatic batch preparation failed.",
            }

        # Read the actual status of THIS uploaded certificate.
        with get_connection() as connection:
            uploaded_certificate = connection.execute(
                """
                SELECT status, batch_id
                FROM certificates
                WHERE certificate_id = ?
                """,
                (certificate_id,),
            ).fetchone()

        certificate_status = uploaded_certificate["status"]
        certificate_batch_id = uploaded_certificate["batch_id"]

        response = {
            "success": True,
            "message": "Certificate uploaded successfully.",
            "certificate_id": certificate_id,
            "filename": filename,
            "file_size": len(content),
            "sha256": certificate_hash,
            "ipfs": ipfs_result,
            "database": {
                "saved": True,
                "status": certificate_status,
                "batch_id": certificate_batch_id,
            },
            "automatic_batch": batch_result,
        }

        if batch_result.get("prepared"):
            response["message"] = (
                "Certificate uploaded successfully. "
                "A Merkle batch was automatically prepared "
                "and is awaiting blockchain registration."
            )

        return response

    finally:
        await file.close()


@router.get("/{certificate_id}/revocation-details")
async def get_certificate_revocation_details(certificate_id: str):
    """
    Return the database information needed by MetaMask to revoke
    one certificate from a registered batch.
    """

    try:
        with get_connection() as connection:
            certificate = connection.execute(
                """
                SELECT
                    c.certificate_id,
                    c.sha256,
                    c.merkle_proof,
                    c.batch_id,
                    c.status AS certificate_status,
                    b.issuer,
                    b.status AS batch_status
                FROM certificates AS c
                JOIN batches AS b
                    ON c.batch_id = b.batch_id
                WHERE c.certificate_id = ?
                """,
                (certificate_id,),
            ).fetchone()

    except sqlite3.Error:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve certificate revocation details.",
        )

    if certificate is None:
        raise HTTPException(
            status_code=404,
            detail="Certificate was not found in a registered batch.",
        )

    certificate = dict(certificate)

    if certificate["certificate_status"] == "REVOKED":
        raise HTTPException(
            status_code=409,
            detail="This certificate has already been revoked.",
        )

    if certificate["certificate_status"] != "REGISTERED":
        raise HTTPException(
            status_code=409,
            detail="Only registered certificates can be revoked.",
        )

    if certificate["batch_status"] != "REGISTERED":
        raise HTTPException(
            status_code=409,
            detail="The certificate's batch is not registered.",
        )

    try:
        proof = json.loads(certificate["merkle_proof"] or "[]")

        if not isinstance(proof, list) or not all(
            isinstance(item, str) for item in proof
        ):
            raise ValueError("Invalid Merkle proof format.")

    except (json.JSONDecodeError, ValueError, TypeError):
        raise HTTPException(
            status_code=500,
            detail="The stored Merkle proof is invalid.",
        )

    return {
        "success": True,
        "certificate_id": certificate["certificate_id"],
        "batch_id": certificate["batch_id"],
        "certificate_hash": "0x" + certificate["sha256"],
        "proof": proof,
        "issuer": certificate["issuer"],
    }


@router.post("/{certificate_id}/revoke")
async def revoke_individual_certificate(
    certificate_id: str,
    request: IndividualRevocationRequest,
):
    """
    Verify a MetaMask transaction and synchronize individual
    and automatic batch revocation with SQLite.
    """

    try:
        with get_connection() as connection:
            certificate = connection.execute(
                """
                SELECT
                    c.certificate_id,
                    c.sha256,
                    c.merkle_proof,
                    c.batch_id,
                    c.status AS certificate_status,
                    b.issuer,
                    b.status AS batch_status
                FROM certificates AS c
                JOIN batches AS b
                    ON c.batch_id = b.batch_id
                WHERE c.certificate_id = ?
                """,
                (certificate_id,),
            ).fetchone()

    except sqlite3.Error:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve certificate information.",
        )

    if certificate is None:
        raise HTTPException(
            status_code=404,
            detail="Certificate was not found.",
        )

    certificate = dict(certificate)

    if certificate["certificate_status"] == "REVOKED":
        raise HTTPException(
            status_code=409,
            detail="This certificate has already been revoked.",
        )

    if certificate["certificate_status"] != "REGISTERED":
        raise HTTPException(
            status_code=409,
            detail="Only registered certificates can be revoked.",
        )

    if certificate["batch_status"] != "REGISTERED":
        raise HTTPException(
            status_code=409,
            detail="The certificate's batch is not registered.",
        )

    try:
        proof = json.loads(certificate["merkle_proof"] or "[]")

        if not isinstance(proof, list) or not all(
            isinstance(item, str) for item in proof
        ):
            raise ValueError("Invalid Merkle proof format.")

    except (json.JSONDecodeError, ValueError, TypeError):
        raise HTTPException(
            status_code=500,
            detail="The stored Merkle proof is invalid.",
        )

    # Step 1: Verify the MetaMask transaction.
    try:
        verification_result = await run_in_threadpool(
            verify_individual_revocation_transaction,
            certificate["batch_id"],
            certificate["certificate_id"],
            "0x" + certificate["sha256"],
            proof,
            request.transaction_hash,
            certificate["issuer"],
        )

    except TransactionNotFoundError:
        raise HTTPException(
            status_code=409,
            detail=(
                "The revocation transaction could not be found yet. "
                "Please wait for blockchain confirmation and try again."
            ),
        )

    except BlockchainUnavailableError:
        raise HTTPException(
            status_code=503,
            detail="Blockchain is currently unavailable.",
        )

    except ContractConfigurationError:
        raise HTTPException(
            status_code=500,
            detail="The blockchain contract configuration is invalid.",
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    if not verification_result.get("verified"):
        raise HTTPException(
            status_code=400,
            detail="The revocation transaction could not be verified.",
        )

    # Step 2: Check the latest batch status on the blockchain.
    try:
        blockchain_batch = await run_in_threadpool(
            get_batch_status,
            certificate["batch_id"],
        )

    except BlockchainUnavailableError:
        raise HTTPException(
            status_code=503,
            detail=(
                "The individual revocation transaction was confirmed, "
                "but the latest batch status could not be retrieved. "
                "Please retry after checking the blockchain."
            ),
        )

    except ContractConfigurationError:
        raise HTTPException(
            status_code=500,
            detail="The blockchain contract configuration is invalid.",
        )

    if not blockchain_batch["exists"]:
        raise HTTPException(
            status_code=409,
            detail=(
                "The batch does not exist on the currently configured "
                "blockchain contract."
            ),
        )

    batch_is_revoked = blockchain_batch["revoked"]

    # Step 3: Synchronize SQLite in one database transaction.
    try:
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")

            current_certificate = connection.execute(
                """
                SELECT status, batch_id
                FROM certificates
                WHERE certificate_id = ?
                """,
                (certificate_id,),
            ).fetchone()

            if current_certificate is None:
                raise HTTPException(
                    status_code=404,
                    detail="Certificate was not found during synchronization.",
                )

            if (
                current_certificate["status"] != "REGISTERED"
                or current_certificate["batch_id"]
                != certificate["batch_id"]
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Certificate status changed while the revocation "
                        "was being processed. Please refresh and check it."
                    ),
                )

            connection.execute(
                """
                UPDATE certificates
                SET status = 'REVOKED'
                WHERE certificate_id = ?
                """,
                (certificate_id,),
            )

            if batch_is_revoked:
                batch_update = connection.execute(
                    """
                    UPDATE batches
                    SET status = 'REVOKED'
                    WHERE batch_id = ?
                    """,
                    (certificate["batch_id"],),
                )

                if batch_update.rowcount == 0:
                    raise HTTPException(
                        status_code=404,
                        detail=(
                            "The revoked batch was not found "
                            "during synchronization."
                        ),
                    )

                connection.execute(
                    """
                    UPDATE certificates
                    SET status = 'REVOKED'
                    WHERE batch_id = ?
                    """,
                    (certificate["batch_id"],),
                )

    except HTTPException:
        raise

    except sqlite3.Error:
        raise HTTPException(
            status_code=500,
            detail=(
                "Blockchain confirmed revocation, but the certificate "
                "and batch statuses could not be synchronized with SQLite."
            ),
        )

    # Step 4: Return the confirmed result.
    if batch_is_revoked:
        message = (
            "Certificate revoked successfully. All certificates in "
            "the batch have now been revoked, and the batch status "
            "has automatically changed to REVOKED."
        )
        batch_status = "REVOKED"
    else:
        message = (
            "Certificate was individually revoked successfully. "
            "The remaining certificates in the batch are unaffected."
        )
        batch_status = "REGISTERED"

    return {
        "success": True,
        "message": message,
        "certificate_id": certificate_id,
        "batch_id": certificate["batch_id"],
        "status": "REVOKED",
        "batch_status": batch_status,
        "revoked_certificate_count": blockchain_batch[
            "revoked_certificate_count"
        ],
        "total_certificates": blockchain_batch[
            "total_certificates"
        ],
        "transaction_hash": verification_result["transaction_hash"],
        "block_number": verification_result["block_number"],
    }


@router.post("/verify")
async def verify_certificate(
    certificate_id: str = Form(...),
    file: UploadFile = File(...),
):
    content = await file.read()

    try:
        filename = validate_pdf(file.filename or "", content)
        certificate_hash = calculate_sha256(content)

        certificate_id = certificate_id.strip()

        try:
            with get_connection() as connection:
                certificate = connection.execute(
                    """
                    SELECT
                        certificate_id, sha256, ipfs_cid, filename,
                        batch_id, merkle_proof, status
                    FROM certificates
                    WHERE certificate_id = ?
                    """,
                    (certificate_id,),
                ).fetchone()

        except sqlite3.Error:
            raise HTTPException(
                status_code=500,
                detail="Could not retrieve certificate information.",
            )

        if certificate is None:
            return {
                "success": True,
                "verified": False,
                "status": "INVALID",
                "message": "The supplied certificate ID does not exist.",
                "certificate_id": certificate_id,
                "sha256": certificate_hash,
            }

        certificate = dict(certificate)

        # The uploaded file must match the hash stored
        # against the exact certificate ID supplied.
        if certificate["sha256"].lower() != certificate_hash.lower():
            return {
                "success": True,
                "verified": False,
                "status": "INVALID",
                "message": (
                    "The uploaded file does not belong to the "
                    "supplied certificate ID."
                ),
                "certificate_id": certificate_id,
                "sha256": certificate_hash,
            }

        if not certificate["batch_id"]:
            return {
                "success": True,
                "verified": False,
                "status": "NOT_REGISTERED",
                "message": (
                    "This certificate has not yet been registered "
                    "in a blockchain batch."
                ),
                "certificate_id": certificate_id,
                "sha256": certificate_hash,
            }

        if certificate["status"] == "REVOKED":
            return {
                "success": True,
                "verified": False,
                "status": "REVOKED",
                "message": (
                    "This certificate has been revoked and is no longer valid."
                ),
                "certificate": {
                    "certificate_id": certificate["certificate_id"],
                    "filename": filename,
                    "sha256": certificate_hash,
                    "ipfs_cid": certificate["ipfs_cid"],
                    "batch_id": certificate["batch_id"],
                },
            }

        if certificate["status"] != "REGISTERED":
            return {
                "success": True,
                "verified": False,
                "status": "NOT_REGISTERED",
                "message": (
                    "This certificate has not yet been registered "
                    "in a blockchain batch."
                ),
                "certificate_id": certificate_id,
                "sha256": certificate_hash,
            }

        try:
            proof = json.loads(certificate["merkle_proof"] or "[]")

            if not isinstance(proof, list) or not all(
                isinstance(item, str) for item in proof
            ):
                raise ValueError("Invalid Merkle proof format.")

        except (json.JSONDecodeError, ValueError, TypeError):
            raise HTTPException(
                status_code=500,
                detail="The stored Merkle proof is invalid.",
            )

        try:
            blockchain_result = await run_in_threadpool(
                verify_merkle_certificate,
                certificate["batch_id"],
                certificate["certificate_id"],
                "0x" + certificate_hash,
                proof,
            )

        except BlockchainUnavailableError:
            raise HTTPException(
                status_code=503,
                detail="Blockchain verification is currently unavailable.",
            )

        except ContractConfigurationError:
            raise HTTPException(
                status_code=500,
                detail="The blockchain contract configuration is invalid.",
            )

        if blockchain_result["status"] == "REVOKED":
            try:
                if blockchain_result.get("revocation_scope") == "BATCH":
                    await run_in_threadpool(
                        synchronize_revoked_batch,
                        certificate["batch_id"],
                    )
                else:
                    await run_in_threadpool(
                        synchronize_revoked_certificate,
                        certificate["certificate_id"],
                    )

            except RuntimeError:
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Blockchain confirmed revocation, but the "
                        "database status could not be synchronized."
                    ),
                )

        return {
            "success": True,
            "verified": blockchain_result["verified"],
            "status": blockchain_result["status"],
            "message": blockchain_result["message"],
            "certificate": {
                "certificate_id": certificate["certificate_id"],
                "filename": filename,
                "sha256": certificate_hash,
                "ipfs_cid": certificate["ipfs_cid"],
                "batch_id": certificate["batch_id"],
            },
        }

    finally:
        await file.close()
