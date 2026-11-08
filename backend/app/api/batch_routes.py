
import sqlite3

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.core.database import get_connection
from app.services.blockchain_service import (
    BlockchainUnavailableError,
    ContractConfigurationError,
    TransactionNotFoundError,
    get_batch_status,
    verify_batch_registration_transaction,
)

router = APIRouter(
    prefix="/batches",
    tags=["Batch Management"],
)

BATCH_SIZE = 5


class BatchRegistrationRequest(BaseModel):
    transaction_hash: str = Field(
        min_length=66,
        max_length=66,
        pattern=r"^0x[a-fA-F0-9]{64}$",
    )


def synchronize_revoked_batch(batch_id: str) -> None:
    """
    Synchronize a revoked batch and its certificates with SQLite.
    """

    try:
        with get_connection() as connection:
            result = connection.execute(
                """
                UPDATE batches
                SET status = 'REVOKED'
                WHERE batch_id = ?
                """,
                (batch_id,),
            )

            if result.rowcount == 0:
                raise RuntimeError("Batch not found in database.")

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
            "Could not synchronize revoked batch status."
        ) from exc


async def get_current_batch_status(batch_id: str) -> dict:
    """
    Retrieve the current batch status from the blockchain.

    If the batch is absent from the current contract:
    - Preserve PREPARED status.
    - Preserve historical REVOKED status.
    - Mark a batch REVOKED if all its certificates are revoked.
    - Report other historical registrations as NOT_REGISTERED.

    Synchronize SQLite when revocation is established.
    """

    try:
        blockchain_batch = await run_in_threadpool(
            get_batch_status,
            batch_id,
        )

    except BlockchainUnavailableError:
        raise HTTPException(
            status_code=503,
            detail="Blockchain is currently unavailable.",
        )

    except ContractConfigurationError:
        raise HTTPException(
            status_code=500,
            detail="Blockchain contract configuration is invalid.",
        )

    if not blockchain_batch["exists"]:
        try:
            with get_connection() as connection:
                database_batch = connection.execute(
                    """
                    SELECT
                        b.status,
                        COUNT(c.certificate_id) AS total_certificates,
                        COALESCE(
                            SUM(
                                CASE
                                    WHEN c.status = 'REVOKED' THEN 1
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS revoked_certificate_count
                    FROM batches b
                    LEFT JOIN certificates c
                        ON b.batch_id = c.batch_id
                    WHERE b.batch_id = ?
                    GROUP BY b.batch_id, b.status
                    """,
                    (batch_id,),
                ).fetchone()

        except sqlite3.Error:
            raise HTTPException(
                status_code=500,
                detail="Could not retrieve the database batch status.",
            )

        if database_batch is None:
            return {
                "status": "NOT_REGISTERED",
                "revoked": False,
                "exists": False,
            }

        database_status = database_batch["status"]
        total_certificates = database_batch["total_certificates"]
        revoked_count = database_batch["revoked_certificate_count"]

        if database_status == "PREPARED":
            return {
                "status": "PREPARED",
                "revoked": False,
                "exists": False,
            }

        # A previously revoked batch remains revoked after redeployment.
        # Also detect batches whose every certificate was revoked individually.
        all_certificates_revoked = (
            total_certificates > 0
            and revoked_count == total_certificates
        )

        if database_status == "REVOKED" or all_certificates_revoked:
            try:
                await run_in_threadpool(
                    synchronize_revoked_batch,
                    batch_id,
                )

            except RuntimeError:
                raise HTTPException(
                    status_code=500,
                    detail="Could not synchronize the historical revoked batch.",
                )

            return {
                "status": "REVOKED",
                "revoked": True,
                "exists": False,
                "total_certificates": total_certificates,
                "revoked_certificate_count": revoked_count,
            }

        return {
            "status": "NOT_REGISTERED",
            "revoked": False,
            "exists": False,
        }

    if blockchain_batch["revoked"]:
        try:
            await run_in_threadpool(
                synchronize_revoked_batch,
                batch_id,
            )

        except RuntimeError:
            raise HTTPException(
                status_code=500,
                detail=(
                    "Blockchain confirms revocation, but "
                    "SQLite synchronization failed."
                ),
            )

        return {
            "status": "REVOKED",
            "revoked": True,
            "exists": True,
            "total_certificates": blockchain_batch[
                "total_certificates"
            ],
            "revoked_certificate_count": blockchain_batch[
                "revoked_certificate_count"
            ],
        }

    return {
        "status": "REGISTERED",
        "revoked": False,
        "exists": True,
        "total_certificates": blockchain_batch[
            "total_certificates"
        ],
        "revoked_certificate_count": blockchain_batch[
            "revoked_certificate_count"
        ],
    }


@router.post("/{batch_id}/register")
async def register_prepared_batch(
    batch_id: str,
    request: BatchRegistrationRequest,
):
    """
    Confirm a MetaMask registration transaction and synchronize
    the prepared batch and its certificates with SQLite.
    """

    try:
        with get_connection() as connection:
            batch = connection.execute(
                """
                SELECT
                    batch_id,
                    issuer,
                    merkle_root,
                    transaction_hash,
                    status
                FROM batches
                WHERE batch_id = ?
                """,
                (batch_id,),
            ).fetchone()

            if batch is None:
                raise HTTPException(
                    status_code=404,
                    detail="Batch not found in the database.",
                )

            certificates = connection.execute(
                """
                SELECT certificate_id, status
                FROM certificates
                WHERE batch_id = ?
                """,
                (batch_id,),
            ).fetchall()

    except sqlite3.Error:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve prepared batch information.",
        )

    if batch["status"] == "REGISTERED":
        if (
            batch["transaction_hash"]
            and batch["transaction_hash"].lower()
            == request.transaction_hash.lower()
        ):
            return {
                "success": True,
                "message": "This batch is already registered.",
                "batch_id": batch_id,
                "status": "REGISTERED",
                "transaction_hash": batch["transaction_hash"],
            }

        raise HTTPException(
            status_code=409,
            detail="This batch has already been registered.",
        )

    if batch["status"] != "PREPARED":
        raise HTTPException(
            status_code=409,
            detail=(
                f"Batch cannot be registered from its current status: "
                f"{batch['status']}."
            ),
        )

    if not batch["merkle_root"]:
        raise HTTPException(
            status_code=409,
            detail="The prepared batch has no Merkle root.",
        )

    certificate_count = len(certificates)

    if certificate_count != BATCH_SIZE:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Expected exactly {BATCH_SIZE} certificates, "
                f"but found {certificate_count}."
            ),
        )

    if any(cert["status"] != "PREPARED" for cert in certificates):
        raise HTTPException(
            status_code=409,
            detail="All certificates must have PREPARED status.",
        )

    try:
        verification = await run_in_threadpool(
            verify_batch_registration_transaction,
            batch_id,
            request.transaction_hash,
            batch["issuer"],
            batch["merkle_root"],
            certificate_count,
        )

    except TransactionNotFoundError as exc:
        raise HTTPException(
            status_code=409,
            detail=str(exc),
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    except BlockchainUnavailableError:
        raise HTTPException(
            status_code=503,
            detail="Blockchain is currently unavailable.",
        )

    except ContractConfigurationError:
        raise HTTPException(
            status_code=500,
            detail="Blockchain contract configuration is invalid.",
        )

    if not verification["verified"]:
        raise HTTPException(
            status_code=400,
            detail="Blockchain transaction could not be verified.",
        )

    try:
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")

            current_batch = connection.execute(
                """
                SELECT status, issuer, merkle_root, transaction_hash
                FROM batches
                WHERE batch_id = ?
                """,
                (batch_id,),
            ).fetchone()

            if current_batch is None:
                raise HTTPException(
                    status_code=404,
                    detail="Batch no longer exists in the database.",
                )

            if (
                current_batch["status"] != "PREPARED"
                or current_batch["issuer"].lower()
                != batch["issuer"].lower()
                or current_batch["merkle_root"].lower()
                != batch["merkle_root"].lower()
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Batch information changed during verification. "
                        "Refresh and try again."
                    ),
                )

            if current_batch["transaction_hash"]:
                if (
                    current_batch["transaction_hash"].lower()
                    == request.transaction_hash.lower()
                ):
                    return {
                        "success": True,
                        "message": "This batch is already registered.",
                        "batch_id": batch_id,
                        "status": "REGISTERED",
                        "transaction_hash": request.transaction_hash,
                    }

                raise HTTPException(
                    status_code=409,
                    detail="A different transaction is already recorded.",
                )

            batch_update = connection.execute(
                """
                UPDATE batches
                SET transaction_hash = ?,
                    status = 'REGISTERED'
                WHERE batch_id = ?
                  AND status = 'PREPARED'
                """,
                (
                    verification["transaction_hash"],
                    batch_id,
                ),
            )

            if batch_update.rowcount != 1:
                raise HTTPException(
                    status_code=409,
                    detail="Could not update the batch registration status.",
                )

            certificate_update = connection.execute(
                """
                UPDATE certificates
                SET status = 'REGISTERED'
                WHERE batch_id = ?
                  AND status = 'PREPARED'
                """,
                (batch_id,),
            )

            if certificate_update.rowcount != certificate_count:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "The expected certificates could not "
                        "be synchronized."
                    ),
                )

    except sqlite3.Error:
        raise HTTPException(
            status_code=500,
            detail="Could not synchronize the registered batch with SQLite.",
        )

    return {
        "success": True,
        "message": "Batch successfully verified and registered.",
        "batch_id": batch_id,
        "status": "REGISTERED",
        "certificate_count": certificate_count,
        "transaction_hash": verification["transaction_hash"],
        "block_number": verification["block_number"],
    }


@router.get("/")
async def list_batches():
    """
    List all batches stored in SQLite with their
    current blockchain status and certificate counts.
    """

    try:
        with get_connection() as connection:
            rows = connection.execute(
                """
                SELECT
                    b.batch_id,
                    b.issuer,
                    b.merkle_root,
                    b.transaction_hash,
                    b.status,
                    b.created_at,
                    COUNT(c.certificate_id) AS certificate_count
                FROM batches b
                LEFT JOIN certificates c
                    ON b.batch_id = c.batch_id
                GROUP BY
                    b.batch_id,
                    b.issuer,
                    b.merkle_root,
                    b.transaction_hash,
                    b.status,
                    b.created_at
                ORDER BY b.created_at DESC
                """
            ).fetchall()

    except sqlite3.Error:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve batches from the database.",
        )

    batches = []

    for row in rows:
        batch = dict(row)

        current_status = await get_current_batch_status(
            batch["batch_id"]
        )

        batch["status"] = current_status["status"]
        batch["revoked"] = current_status["revoked"]
        batch["exists_on_blockchain"] = current_status["exists"]

        if "total_certificates" in current_status:
            batch["total_certificates"] = current_status[
                "total_certificates"
            ]
            batch["revoked_certificate_count"] = current_status[
                "revoked_certificate_count"
            ]

        batches.append(batch)

    return {
        "success": True,
        "count": len(batches),
        "batches": batches,
    }


@router.get("/{batch_id}")
async def get_batch_details(batch_id: str):
    """
    Retrieve details of one batch and its current
    blockchain status.
    """

    try:
        with get_connection() as connection:
            row = connection.execute(
                """
                SELECT
                    b.batch_id,
                    b.issuer,
                    b.merkle_root,
                    b.transaction_hash,
                    b.status,
                    b.created_at,
                    COUNT(c.certificate_id) AS certificate_count
                FROM batches b
                LEFT JOIN certificates c
                    ON b.batch_id = c.batch_id
                WHERE b.batch_id = ?
                GROUP BY
                    b.batch_id,
                    b.issuer,
                    b.merkle_root,
                    b.transaction_hash,
                    b.status,
                    b.created_at
                """,
                (batch_id,),
            ).fetchone()

    except sqlite3.Error:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve batch information.",
        )

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Batch not found in the database.",
        )

    batch = dict(row)

    current_status = await get_current_batch_status(batch_id)

    batch["status"] = current_status["status"]
    batch["revoked"] = current_status["revoked"]
    batch["exists_on_blockchain"] = current_status["exists"]

    if "total_certificates" in current_status:
        batch["total_certificates"] = current_status[
            "total_certificates"
        ]
        batch["revoked_certificate_count"] = current_status[
            "revoked_certificate_count"
        ]

    return {
        "success": True,
        "batch": batch,
    }


@router.get("/{batch_id}/certificates")
async def list_batch_certificates(batch_id: str):
    """
    List all certificates belonging to a particular batch.
    """

    try:
        with get_connection() as connection:
            batch = connection.execute(
                """
                SELECT batch_id
                FROM batches
                WHERE batch_id = ?
                """,
                (batch_id,),
            ).fetchone()

            if batch is None:
                raise HTTPException(
                    status_code=404,
                    detail="Batch not found in the database.",
                )

            rows = connection.execute(
                """
                SELECT
                    certificate_id,
                    filename,
                    sha256,
                    ipfs_cid,
                    status,
                    created_at
                FROM certificates
                WHERE batch_id = ?
                ORDER BY created_at DESC
                """,
                (batch_id,),
            ).fetchall()

    except sqlite3.Error:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve batch certificates.",
        )

    current_status = await get_current_batch_status(batch_id)

    certificates = [dict(row) for row in rows]

    return {
        "success": True,
        "batch_id": batch_id,
        "batch_status": current_status["status"],
        "count": len(certificates),
        "certificates": certificates,
    }
