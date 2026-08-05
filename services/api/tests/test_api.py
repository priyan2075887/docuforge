from io import BytesIO

from fastapi.testclient import TestClient
from pypdf import PdfWriter

from app.main import app, paddle_provider


def make_blank_pdf(width: float = 144, height: float = 72) -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=width, height=height)
    buffer = BytesIO()
    writer.write(buffer)
    writer.close()
    return buffer.getvalue()


def test_health() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_store_and_list_document() -> None:
    client = TestClient(app)
    stored = client.post("/api/v1/documents", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert stored.status_code == 200
    payload = stored.json()
    assert payload["name"] == "notes.txt"
    assert payload["size"] == 5
    listed = client.get("/api/v1/documents")
    assert any(item["id"] == payload["id"] for item in listed.json())


def test_inspect_rejects_non_pdf() -> None:
    response = TestClient(app).post("/api/v1/documents/inspect", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert response.status_code == 415


def test_inspect_reports_native_page_size_and_ocr_need() -> None:
    response = TestClient(app).post(
        "/api/v1/documents/inspect",
        files={"file": ("scan.pdf", make_blank_pdf(), "application/pdf")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["page_count"] == 1
    assert payload["ocr_pages"] == 1
    assert payload["pages"][0] == {
        "page": 1,
        "text": "",
        "needs_ocr": True,
        "width": 144.0,
        "height": 72.0,
    }


def test_ocr_rasterizes_with_pdfium_at_requested_dpi(monkeypatch) -> None:
    observed: dict[str, tuple[int, int]] = {}
    monkeypatch.setattr(paddle_provider, "installed", lambda: True)

    def recognize(image):
        observed["size"] = image.size
        return {"text": "Recognized page", "lines": []}

    monkeypatch.setattr(paddle_provider, "recognize", recognize)
    response = TestClient(app).post(
        "/api/v1/ocr/recognize?dpi=144",
        files={"file": ("scan.pdf", make_blank_pdf(), "application/pdf")},
    )
    assert response.status_code == 200
    assert response.json()["pages"][0]["source"] == "paddleocr"
    assert response.json()["text"] == "Recognized page"
    assert observed["size"] == (288, 144)
