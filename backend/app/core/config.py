
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    # Pinata / IPFS configuration
    PINATA_JWT: str = ""
    PINATA_GATEWAY: str = ""

    # PDF upload configuration
    MAX_UPLOAD_SIZE: int = 10 * 1024 * 1024

    # Blockchain configuration
    BLOCKCHAIN_RPC_URL: str = "http://127.0.0.1:8545"

    CONTRACT_ADDRESS: str = (
    "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707"
)
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
