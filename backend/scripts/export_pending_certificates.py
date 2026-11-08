
import json
import os
import uuid
from pathlib import Path

from dotenv import load_dotenv

from app.core.database import get_connection


# Locate the project folders.
BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent
BLOCKCHAIN_DATA_DIR = PROJECT_DIR / "blockchain" / "data"

# Load environment variables from backend/.env.
load_dotenv(BACKEND_DIR / ".env")

OUTPUT_PATH = BLOCKCHAIN_DATA_DIR / "pending-certificates.json"


def main():
    # Read the institution's blockchain wallet address.
    issuer_address = os.getenv("ISSUER_ADDRESS", "").strip()

    if not issuer_address:
        raise ValueError(
            "ISSUER_ADDRESS is not configured. Set it before running this script."
        )

    if not issuer_address.startswith("0x") or len(issuer_address) != 42:
        raise ValueError("ISSUER_ADDRESS must be a valid 42-character Ethereum address.")

    # Fetch certificates that are not yet assigned to a batch.
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT certificate_id, sha256
            FROM certificates
            WHERE status = 'PENDING'
              AND batch_id IS NULL
            ORDER BY created_at ASC
            """
        ).fetchall()

    if not rows:
        print("No pending certificates found.")
        return

    # Create a unique batch ID.
    batch_id = f"VIT-2026-BATCH-{uuid.uuid4().hex[:8].upper()}"

    certificates = []

    for row in rows:
        sha256_hash = row["sha256"]

        # Convert the 64-character SHA-256 hex string to bytes32 format.
        certificate_hash = (
            sha256_hash if sha256_hash.startswith("0x")
            else f"0x{sha256_hash}"
        )

        if len(certificate_hash) != 66:
            raise ValueError(
                f"Invalid SHA-256 hash for certificate {row['certificate_id']}"
            )

        certificates.append(
            {
                "certificateId": row["certificate_id"],
                "certificateHash": certificate_hash,
            }
        )

    # Prepare the JSON input for the existing Merkle generator.
    export_data = {
        "batchId": batch_id,
        "certificates": certificates,
    }

    BLOCKCHAIN_DATA_DIR.mkdir(parents=True, exist_ok=True)

    OUTPUT_PATH.write_text(
        json.dumps(export_data, indent=2) + "\n",
        encoding="utf-8",
    )

    print("\nPending certificates exported successfully!")
    print("--------------------------------------------")
    print(f"Batch ID: {batch_id}")
    print(f"Issuer: {issuer_address}")
    print(f"Certificate count: {len(certificates)}")
    print(f"Output file: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
