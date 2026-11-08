
import sqlite3
from pathlib import Path

# Locate the backend directory.
BACKEND_DIR = Path(__file__).resolve().parents[2]

# Store the database inside backend/data.
DATA_DIR = BACKEND_DIR / "data"
DATABASE_PATH = DATA_DIR / "certificates.db"


def get_connection():
    """Create and return a SQLite database connection."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")

    return connection


def initialize_database():
    """Create the required database tables if they do not exist."""

    with get_connection() as connection:

        connection.execute("""
            CREATE TABLE IF NOT EXISTS batches (
                batch_id TEXT PRIMARY KEY,
                issuer TEXT NOT NULL,
                merkle_root TEXT,
                transaction_hash TEXT,
                status TEXT NOT NULL DEFAULT 'PENDING',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS certificates (
                certificate_id TEXT PRIMARY KEY,
                sha256 TEXT NOT NULL,
                ipfs_cid TEXT NOT NULL,
                filename TEXT NOT NULL,
                batch_id TEXT,
                merkle_proof TEXT,
                status TEXT NOT NULL DEFAULT 'PENDING',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY (batch_id)
                    REFERENCES batches(batch_id)
            )
        """)


if __name__ == "__main__":
    initialize_database()
    print("SQLite database initialized successfully!")
    print(f"Database location: {DATABASE_PATH}")
