import httpx

from fastapi import HTTPException

from app.core.config import settings


PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files"


async def upload_to_pinata(
    filename: str,
    content: bytes,
) -> dict:

    if not settings.PINATA_JWT or settings.PINATA_JWT == "your_pinata_jwt_here":
        raise HTTPException(
            status_code=503,
            detail="Pinata JWT is not configured.",
        )

    headers = {
        "Authorization": f"Bearer {settings.PINATA_JWT}",
    }

    files = {
        "file": (filename, content, "application/pdf"),
    }

    data = {
        "network": "public",
        "name": filename,
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                PINATA_UPLOAD_URL,
                headers=headers,
                files=files,
                data=data,
            )

        if response.status_code not in (200, 201):
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Pinata upload failed with status "
                    f"{response.status_code}."
                ),
            )

        result = response.json()
        file_data = result.get("data", {})
        cid = file_data.get("cid")

        if not cid:
            raise HTTPException(
                status_code=502,
                detail="Pinata response did not contain a CID.",
            )

        return {
            "cid": cid,
            "file_id": file_data.get("id"),
            "name": file_data.get("name", filename),
            "size": file_data.get("size", len(content)),
            "network": "public",
        }

    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="Pinata upload timed out.",
        )

    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="Could not connect to Pinata.",
        )

    except ValueError:
        raise HTTPException(
            status_code=502,
            detail="Pinata returned an invalid response.",
        )
