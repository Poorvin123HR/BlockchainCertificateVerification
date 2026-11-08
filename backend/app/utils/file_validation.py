import hashlib
import re

from fastapi import HTTPException

from app.core.config import settings


def validate_pdf(filename: str, content: bytes) -> str:
    if not filename:
        raise HTTPException(status_code=400, detail="Filename is required.")

    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail="File exceeds the maximum allowed size of 10 MB.",
        )

    if not filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are accepted.",
        )

    if not content.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=400,
            detail="Invalid PDF file signature.",
        )

    safe_filename = re.sub(
        r"[^a-zA-Z0-9._-]",
        "_",
        filename.split("/")[-1].split("\\")[-1],
    )

    return safe_filename


def calculate_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
