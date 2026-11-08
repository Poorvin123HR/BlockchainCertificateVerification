
import json
import os
import sqlite3
from pathlib import Path

from app.core.database import get_connection


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent

BATCH_FILE = (
    PROJECT_DIR
    / "blockchain"
    / "data"
    / "pending-merkle-batch-output.json"
)

EXPECTED_TRANSACTION_HASH = os.getenv(
    "BATCH_TRANSACTION_HASH", ""
).strip()


def main():
    if not EXPECTED_TRANSACTION_HASH.startswith("0x") or len(
        EXPECTED_TRANSACTION_HASH
    ) != 66:
        raise ValueError(
            "Set BATCH_TRANSACTION_HASH to the confirmed transaction hash."
        )

    if not BATCH_FILE.exists():
        raise FileNotFoundError(
            f"Merkle batch file not found: {BATCH_FILE}"
        )

    batch = json.loads(BATCH_FILE.read_text(encoding="utf-8"))

    batch_id = batch["batchId"]
    issuer = batch["issuer"]
    merkle_root = batch["merkleRoot"]
    certificates = batch["certificates"]

    if len(certificates) != batch["certificateCount"]:
        raise ValueError("Certificate count does not match the batch file.")

    if not certificates:
        raise ValueError("The batch contains no certificates.")

    if len({cert["certificateId"] for cert in certificates}) != len(certificates):
        raise ValueError("Duplicate certificate IDs found in the batch.")

    print("Synchronizing registered batch with SQLite...")
    print("---------------------------------------------")
    print("Batch ID:", batch_id)
    print("Certificate count:", len(certificates))
    print("Merkle root:", merkle_root)
    print("Transaction hash:", EXPECTED_TRANSACTION_HASH)

    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")

        existing_batch = connection.execute(
            """
            SELECT issuer, merkle_root, transaction_hash, status
            FROM batches
            WHERE batch_id = ?
            """,
            (batch_id,),
        ).fetchone()

        if existing_batch:
            if (
                existing_batch["issuer"].lower() != issuer.lower()
                or existing_batch["merkle_root"].lower() != merkle_root.lower()
                or existing_batch["transaction_hash"].lower()
                != EXPECTED_TRANSACTION_HASH.lower()
            ):
                raise ValueError(
                    "This batch ID already exists with different registration data."
                )
        else:
            connection.execute(
                """
                INSERT INTO batches (
                    batch_id,
                    issuer,
                    merkle_root,
                    transaction_hash,
                    status
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    batch_id,
                    issuer,
                    merkle_root,
                    EXPECTED_TRANSACTION_HASH,
                    "REGISTERED",
                ),
            )

        for cert in certificates:
            certificate_id = cert["certificateId"]
            certificate_hash = cert["certificateHash"].lower()

            if not certificate_hash.startswith("0x"):
                raise ValueError(
                    f"Invalid certificate hash: {certificate_id}"
                )

            if len(certificate_hash) != 66:
                raise ValueError(
                    f"Invalid certificate hash length: {certificate_id}"
                )

            proof = cert["proof"]

            if not isinstance(proof, list):
                raise ValueError(
                    f"Invalid Merkle proof for {certificate_id}"
                )

            proof_json = json.dumps(proof)

            database_cert = connection.execute(
                """
                SELECT sha256, batch_id, merkle_proof, status
                FROM certificates
                WHERE certificate_id = ?
                """,
                (certificate_id,),
            ).fetchone()

            if not database_cert:
                raise ValueError(
                    f"Certificate not found in SQLite: {certificate_id}"
                )

            stored_hash = database_cert["sha256"].lower().removeprefix("0x")

            if stored_hash != certificate_hash.removeprefix("0x"):
                raise ValueError(
                    f"SHA-256 mismatch for certificate {certificate_id}"
                )

            if database_cert["batch_id"] is None:
                if database_cert["status"] != "PENDING":
                    raise ValueError(
                        f"Unexpected certificate status for {certificate_id}: "
                        f"{database_cert['status']}"
                    )

                connection.execute(
                    """
                    UPDATE certificates
                    SET batch_id = ?,
                        merkle_proof = ?,
                        status = ?
                    WHERE certificate_id = ?
                    """,
                    (
                        batch_id,
                        proof_json,
                        "REGISTERED",
                        certificate_id,
                    ),
                )

            elif (
                database_cert["batch_id"] == batch_id
                and database_cert["merkle_proof"] == proof_json
                and database_cert["status"] == "REGISTERED"
            ):
                print(
                    f"{certificate_id}: already synchronized; skipping."
                )

            else:
                raise ValueError(
                    f"Certificate {certificate_id} is already linked "
                    "to another batch or has conflicting data."
                )

            print(f"{certificate_id}: synchronized.")

    print("---------------------------------------------")
    print("SUCCESS: SQLite synchronization completed!")
    print("Batch status: REGISTERED")
    print("Certificate status: REGISTERED")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, sqlite3.Error, OSError) as error:
        print("Database synchronization failed:", error)
        raise
