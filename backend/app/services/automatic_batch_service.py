
import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path

from dotenv import load_dotenv

from app.core.database import get_connection


BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_DIR = BACKEND_DIR.parent
BLOCKCHAIN_DIR = PROJECT_DIR / "blockchain"
BLOCKCHAIN_DATA_DIR = BLOCKCHAIN_DIR / "data"

BATCH_SIZE = 5

load_dotenv(BACKEND_DIR / ".env")


def prepare_batch_if_ready():
    """
    Prepare a Merkle batch when five pending certificates are available.
    Reserve certificates before generation and save them as PREPARED
    only after successful validation.
    """

    issuer_address = os.getenv("ISSUER_ADDRESS", "").strip()

    if not issuer_address.startswith("0x") or len(issuer_address) != 42:
        return {
            "prepared": False,
            "error": "ISSUER_ADDRESS is missing or invalid.",
        }

    npx_path = shutil.which("npx.cmd")

    if not npx_path:
        return {
            "prepared": False,
            "error": "Could not locate npx.cmd. Check Node.js PATH.",
        }

    batch_id = f"VIT-2026-BATCH-{uuid.uuid4().hex[:8].upper()}"

    input_filename = f"auto-input-{batch_id}.json"
    output_filename = f"auto-output-{batch_id}.json"

    input_path = BLOCKCHAIN_DATA_DIR / input_filename
    output_path = BLOCKCHAIN_DATA_DIR / output_filename

    certificate_ids = []

    try:
        # Reserve exactly five pending certificates.
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")

            rows = connection.execute(
                """
                SELECT certificate_id, sha256
                FROM certificates
                WHERE status = 'PENDING'
                  AND batch_id IS NULL
                ORDER BY created_at ASC, certificate_id ASC
                LIMIT ?
                """,
                (BATCH_SIZE,),
            ).fetchall()

            if len(rows) < BATCH_SIZE:
                return {
                    "prepared": False,
                    "reason": "Not enough pending certificates.",
                    "pending_required": BATCH_SIZE,
                    "pending_found": len(rows),
                }

            certificate_ids = [
                row["certificate_id"] for row in rows
            ]

            certificates = []

            for row in rows:
                certificate_hash = row["sha256"].lower()

                if not certificate_hash.startswith("0x"):
                    certificate_hash = f"0x{certificate_hash}"

                if len(certificate_hash) != 66:
                    raise ValueError(
                        f"Invalid SHA-256 hash for {row['certificate_id']}"
                    )

                certificates.append(
                    {
                        "certificateId": row["certificate_id"],
                        "certificateHash": certificate_hash,
                    }
                )

            connection.execute(
                """
                INSERT INTO batches (batch_id, issuer, status)
                VALUES (?, ?, ?)
                """,
                (batch_id, issuer_address, "PREPARING"),
            )

            for certificate_id in certificate_ids:
                result = connection.execute(
                    """
                    UPDATE certificates
                    SET batch_id = ?,
                        status = 'PREPARING'
                    WHERE certificate_id = ?
                      AND status = 'PENDING'
                      AND batch_id IS NULL
                    """,
                    (batch_id, certificate_id),
                )

                if result.rowcount != 1:
                    raise RuntimeError(
                        f"Could not reserve certificate {certificate_id}"
                    )

        # Write input for the Merkle generator.
        BLOCKCHAIN_DATA_DIR.mkdir(parents=True, exist_ok=True)

        input_path.write_text(
            json.dumps(
                {
                    "batchId": batch_id,
                    "certificates": certificates,
                },
                indent=2,
            ) + "\n",
            encoding="utf-8",
        )

        environment = os.environ.copy()
        environment["ISSUER_ADDRESS"] = issuer_address
        environment["MERKLE_INPUT_FILE"] = input_filename
        environment["MERKLE_OUTPUT_FILE"] = output_filename

        # Execute the Windows .cmd file through the shell.
        command = (
            f'call "{npx_path}" hardhat run '
            f'scripts/generateMerkleBatch.ts --network localhost'
        )

        result = subprocess.run(
            command,
            cwd=BLOCKCHAIN_DIR,
            env=environment,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
            shell=True,
        )

        if result.stdout:
            print(result.stdout)

        if result.returncode != 0:
            raise RuntimeError(
                "Hardhat Merkle generation failed.\n"
                f"Exit code: {result.returncode}\n"
                f"Output: {result.stderr or result.stdout}"
            )

        # Validate generated output.
        if not output_path.exists():
            raise RuntimeError(
                "Merkle output file was not created."
            )

        merkle_batch = json.loads(
            output_path.read_text(encoding="utf-8")
        )

        if merkle_batch.get("batchId") != batch_id:
            raise RuntimeError("Generated batch ID mismatch.")

        if merkle_batch.get("issuer", "").lower() != issuer_address.lower():
            raise RuntimeError("Generated batch issuer mismatch.")

        if merkle_batch.get("certificateCount") != BATCH_SIZE:
            raise RuntimeError("Generated certificate count mismatch.")

        merkle_root = merkle_batch.get("merkleRoot", "")

        if (
            not isinstance(merkle_root, str)
            or not merkle_root.startswith("0x")
            or len(merkle_root) != 66
        ):
            raise RuntimeError("Generated Merkle root is invalid.")

        generated_certificates = merkle_batch.get("certificates")

        if not isinstance(generated_certificates, list):
            raise RuntimeError("Generated certificate list is invalid.")

        proofs_by_id = {}

        for cert in generated_certificates:
            certificate_id = cert.get("certificateId")
            proof = cert.get("proof")

            if not isinstance(certificate_id, str):
                raise RuntimeError("Generated certificate ID is invalid.")

            if certificate_id in proofs_by_id:
                raise RuntimeError(
                    f"Duplicate generated certificate: {certificate_id}"
                )

            if not isinstance(proof, list) or not all(
                isinstance(item, str)
                and item.startswith("0x")
                and len(item) == 66
                for item in proof
            ):
                raise RuntimeError(
                    f"Invalid Merkle proof for {certificate_id}"
                )

            proofs_by_id[certificate_id] = proof

        if set(proofs_by_id) != set(certificate_ids):
            raise RuntimeError(
                "Generated proofs do not match reserved certificates."
            )

        # Save the root and proofs atomically.
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")

            batch_update = connection.execute(
                """
                UPDATE batches
                SET merkle_root = ?,
                    status = 'PREPARED'
                WHERE batch_id = ?
                  AND status = 'PREPARING'
                """,
                (merkle_root, batch_id),
            )

            if batch_update.rowcount != 1:
                raise RuntimeError("Could not prepare the batch.")

            for certificate_id in certificate_ids:
                cert_update = connection.execute(
                    """
                    UPDATE certificates
                    SET merkle_proof = ?,
                        status = 'PREPARED'
                    WHERE certificate_id = ?
                      AND batch_id = ?
                      AND status = 'PREPARING'
                    """,
                    (
                        json.dumps(proofs_by_id[certificate_id]),
                        certificate_id,
                        batch_id,
                    ),
                )

                if cert_update.rowcount != 1:
                    raise RuntimeError(
                        f"Could not prepare certificate {certificate_id}"
                    )

        return {
            "prepared": True,
            "batch_id": batch_id,
            "certificate_count": BATCH_SIZE,
            "merkle_root": merkle_root,
            "issuer": issuer_address,
        }

    except Exception as error:
        # Roll back reservations if preparation fails.
        try:
            with get_connection() as connection:
                connection.execute("BEGIN IMMEDIATE")

                connection.execute(
                    """
                    UPDATE certificates
                    SET batch_id = NULL,
                        merkle_proof = NULL,
                        status = 'PENDING'
                    WHERE batch_id = ?
                      AND status = 'PREPARING'
                    """,
                    (batch_id,),
                )

                connection.execute(
                    """
                    DELETE FROM batches
                    WHERE batch_id = ?
                      AND status = 'PREPARING'
                    """,
                    (batch_id,),
                )

        except Exception as cleanup_error:
            print("WARNING: Batch rollback failed:", cleanup_error)

        print(f"Automatic batch preparation failed: {error}")

        return {
            "prepared": False,
            "error": str(error),
        }
