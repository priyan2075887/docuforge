from pathlib import Path
import json
from uuid import uuid4
from typing import Annotated

import pypdfium2 as pdfium
from PIL import Image
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from .ocr import PaddleOCRProvider
from .pdf_tools import PDFToolError, open_pdf
from .routers.pdf import router as pdf_router

app = FastAPI(title="DocuForge API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(pdf_router)

STORAGE = Path(__file__).resolve().parents[3] / "storage" / "documents"
STORAGE.mkdir(parents=True, exist_ok=True)
MAX_FILE_SIZE = 100 * 1024 * 1024
paddle_provider = PaddleOCRProvider()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "docuforge-api"}


@app.post("/api/v1/documents")
async def store_document(file: Annotated[UploadFile, File()]) -> dict:
    """Store an original document locally; no cloud service is involved."""
    payload = await file.read()
    if len(payload) > MAX_FILE_SIZE:
        raise HTTPException(413, "File exceeds the 100 MB limit.")
    document_id = uuid4().hex
    safe_name = Path(file.filename or "document").name
    file_path = STORAGE / f"{document_id}.bin"
    metadata_path = STORAGE / f"{document_id}.json"
    file_path.write_bytes(payload)
    metadata = {"id": document_id, "name": safe_name, "mime_type": file.content_type or "application/octet-stream", "size": len(payload)}
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    return metadata


@app.get("/api/v1/documents")
def list_stored_documents() -> list[dict]:
    documents = []
    for path in STORAGE.glob("*.json"):
        try:
            documents.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return documents


@app.get("/api/v1/documents/{document_id}/download")
def download_document(document_id: str) -> FileResponse:
    metadata_path = STORAGE / f"{document_id}.json"
    file_path = STORAGE / f"{document_id}.bin"
    if not metadata_path.exists() or not file_path.exists():
        raise HTTPException(404, "Document not found.")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    return FileResponse(file_path, filename=metadata["name"], media_type=metadata["mime_type"])


@app.post("/api/v1/documents/inspect")
async def inspect_document(file: Annotated[UploadFile, File()]) -> dict:
    """Extract the embedded text layer now; scanned pages are queued for OCR."""
    if file.content_type != "application/pdf" and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(415, "The first milestone currently accepts PDF files.")
    payload = await file.read()
    if len(payload) > MAX_FILE_SIZE:
        raise HTTPException(413, "File exceeds the 100 MB limit.")
    try:
        document = open_pdf(payload)
    except PDFToolError as exc:
        raise HTTPException(422, "The PDF is invalid or encrypted.") from exc

    pages = []
    for number, page in enumerate(document.pages):
        try:
            text = (page.extract_text() or "").strip()
            width = float(page.cropbox.width)
            height = float(page.cropbox.height)
            if page.rotation % 180:
                width, height = height, width
        except Exception as exc:
            raise HTTPException(422, "The PDF is invalid or encrypted.") from exc
        pages.append({
            "page": number + 1,
            "text": text,
            "needs_ocr": len(text) < 24,
            "width": round(width, 2),
            "height": round(height, 2),
        })
    return {
        "filename": Path(file.filename or "document.pdf").name,
        "page_count": len(document.pages),
        "ocr_pages": sum(page["needs_ocr"] for page in pages),
        "pages": pages,
    }


@app.get("/api/v1/ocr/engines")
def ocr_engines() -> dict:
    return {
        "default": "paddleocr",
        "engines": [
            {"id": "paddleocr", "model": paddle_provider.model, "best_for": "permissive multilingual OCR and production deployment", "ready": paddle_provider.installed(), "install_hint": None if paddle_provider.installed() else paddle_provider.install_hint()},
            {"id": "surya", "best_for": "optional high-ranked document parsing; weights have commercial restrictions", "ready": False},
            {"id": "docling", "best_for": "PDF structure, tables and Markdown", "ready": False},
            {"id": "vision-language", "best_for": "difficult pages via a local VLM", "ready": False},
        ],
    }


@app.post("/api/v1/ocr/recognize")
async def recognize_pdf(file: Annotated[UploadFile, File()], dpi: int = 200) -> dict:
    if not paddle_provider.installed():
        raise HTTPException(503, {"message": "PaddleOCR is not installed.", "install_hint": paddle_provider.install_hint()})
    if not 120 <= dpi <= 300:
        raise HTTPException(422, "DPI must be between 120 and 300.")
    payload = await file.read()
    if len(payload) > MAX_FILE_SIZE:
        raise HTTPException(413, "File exceeds the 100 MB limit.")
    try:
        document = open_pdf(payload)
    except PDFToolError as exc:
        raise HTTPException(422, "The PDF is invalid or encrypted.") from exc
    pages = []
    scale = dpi / 72
    render_document: pdfium.PdfDocument | None = None
    try:
        for index, page in enumerate(document.pages):
            try:
                native_text = (page.extract_text() or "").strip()
            except Exception as exc:
                raise HTTPException(422, "The PDF is invalid or encrypted.") from exc
            if len(native_text) >= 24:
                pages.append({"page": index + 1, "source": "embedded", "text": native_text, "lines": []})
                continue
            try:
                if render_document is None:
                    render_document = pdfium.PdfDocument(payload)
                render_page = render_document[index]
                try:
                    bitmap = render_page.render(scale=scale)
                    try:
                        image: Image.Image = bitmap.to_pil().convert("RGB")
                    finally:
                        bitmap.close()
                finally:
                    render_page.close()
            except Exception as exc:
                raise HTTPException(422, f"Page {index + 1} could not be rendered for OCR.") from exc
            result = paddle_provider.recognize(image)
            pages.append({"page": index + 1, "source": "paddleocr", **result})
    finally:
        if render_document is not None:
            render_document.close()
    return {"engine": paddle_provider.id, "model": paddle_provider.model, "page_count": len(pages), "pages": pages, "text": "\n\n".join(page["text"] for page in pages)}
