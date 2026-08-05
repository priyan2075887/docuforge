from io import BytesIO
import json
from zipfile import ZipFile

from PIL import Image
import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    RectangleObject,
)

from app.main import app
from app.pdf_tools import PDFToolError, parse_pages

client = TestClient(app)


def make_named_pdf(
    name: str,
    pages: int,
    title: str = "",
    *,
    width: float = 612,
    height: float = 792,
    link_on_page: int | None = None,
) -> bytes:
    """Create a small, searchable PDF without a second PDF engine dependency."""

    writer = PdfWriter()
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    font_reference = writer._add_object(font)
    for number in range(1, pages + 1):
        page = writer.add_blank_page(width=width, height=height)
        page[NameObject("/Resources")] = DictionaryObject(
            {
                NameObject("/Font"): DictionaryObject(
                    {NameObject("/F1"): font_reference}
                )
            }
        )
        text = f"{name} page {number}".replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = DecodedStreamObject()
        stream.set_data(f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("ascii"))
        page[NameObject("/Contents")] = writer._add_object(stream)
    if link_on_page is not None:
        writer.add_uri(
            link_on_page - 1,
            "https://example.com/docuforge",
            RectangleObject([72, 700, 220, 725]),
        )
    if title:
        writer.add_metadata({"/Title": title, "/Author": "DocuForge test"})
    buffer = BytesIO()
    writer.write(buffer)
    writer.close()
    return buffer.getvalue()


def make_pdf(pages: int) -> bytes:
    return make_named_pdf("Test", pages)


def read_pdf(data: bytes) -> PdfReader:
    return PdfReader(BytesIO(data))


def upload(data: bytes, name: str = "input.pdf") -> tuple[str, bytes, str]:
    return name, data, "application/pdf"


def test_parse_page_ranges() -> None:
    assert parse_pages("1-3,5", 5) == [0, 1, 2, 4]
    with pytest.raises(PDFToolError):
        parse_pages("6", 5)


def test_merge_pdfs() -> None:
    response = client.post(
        "/api/v1/pdf/merge",
        files=[
            ("files", upload(make_pdf(2), "a.pdf")),
            ("files", upload(make_pdf(1), "b.pdf")),
        ],
    )
    assert response.status_code == 200
    assert len(read_pdf(response.content).pages) == 3


def test_compose_mixes_reorders_duplicates_rotates_and_inserts_blank_pages() -> None:
    manifest = {
        "pages": [
            {"source": 0, "page": 2, "rotation": 90},
            {"source": 1, "page": 1},
            {"source": 0, "page": 2, "rotation": 180},
            {"blank": {"width": 300, "height": 400}, "rotation": 90},
            {"source": 0, "page": 1},
        ]
    }
    response = client.post(
        "/api/v1/pdf/compose",
        files=[
            (
                "files",
                upload(
                    make_named_pdf("Alpha", 2, title="Alpha source", link_on_page=2),
                    "alpha.pdf",
                ),
            ),
            ("files", upload(make_named_pdf("Beta", 2), "beta.pdf")),
        ],
        data={"manifest": json.dumps(manifest)},
    )

    assert response.status_code == 200
    result = read_pdf(response.content)
    assert len(result.pages) == 5
    assert "Alpha page 2" in (result.pages[0].extract_text() or "")
    assert result.pages[0].rotation == 90
    assert "/Annots" in result.pages[0]
    assert "Beta page 1" in (result.pages[1].extract_text() or "")
    assert "Alpha page 2" in (result.pages[2].extract_text() or "")
    assert result.pages[2].rotation == 180
    assert "/Annots" in result.pages[2]
    assert (result.pages[3].extract_text() or "") == ""
    assert result.pages[3].rotation == 90
    assert float(result.pages[3].mediabox.width) == 300
    assert float(result.pages[3].mediabox.height) == 400
    assert "Alpha page 1" in (result.pages[4].extract_text() or "")
    assert result.metadata is not None
    assert result.metadata.title == "Alpha source"
    assert result.metadata.author == "DocuForge test"


@pytest.mark.parametrize(
    ("manifest", "message"),
    [
        ("not json", "not valid JSON"),
        (json.dumps({"pages": []}), "at least one output page"),
        (json.dumps([{"source": 2, "page": 1}]), "source must stay between"),
        (json.dumps([{"source": 0, "page": 3}]), "page must stay between"),
        (json.dumps([{"source": 0, "page": 1, "rotation": 45}]), "rotation must be"),
        (json.dumps([{"blank": {"width": 0, "height": 400}}]), "blank width must be between"),
        (json.dumps([{"source": 0}]), 'must contain "source" and "page"'),
        (json.dumps([{"source": True, "page": 1}]), 'field "source" must be an integer'),
        (json.dumps([{"source": 0, "page": 1, "rotation": 90.0}]), 'field "rotation" must be an integer'),
    ],
)
def test_compose_rejects_invalid_manifests(manifest: str, message: str) -> None:
    response = client.post(
        "/api/v1/pdf/compose",
        files=[("files", upload(make_named_pdf("Alpha", 2)))],
        data={"manifest": manifest},
    )

    assert response.status_code == 422
    assert message in response.json()["detail"]


def test_compose_rejects_a_damaged_source_pdf() -> None:
    response = client.post(
        "/api/v1/pdf/compose",
        files=[("files", upload(b"this is not a pdf", "damaged.pdf"))],
        data={"manifest": json.dumps([{"source": 0, "page": 1}])},
    )

    assert response.status_code == 422
    assert "invalid, damaged, or encrypted" in response.json()["detail"]


def test_pdf_tools_reject_encrypted_input() -> None:
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=100)
    writer.encrypt("secret")
    buffer = BytesIO()
    writer.write(buffer)
    response = client.post(
        "/api/v1/pdf/optimize",
        files={"file": upload(buffer.getvalue(), "locked.pdf")},
    )
    assert response.status_code == 422
    assert "Password-protected" in response.json()["detail"]


def test_extract_delete_rotate_and_reorder() -> None:
    original = make_pdf(4)
    extracted = client.post(
        "/api/v1/pdf/extract",
        files={"file": upload(original)},
        data={"pages": "2-3"},
    )
    extracted_pdf = read_pdf(extracted.content)
    assert len(extracted_pdf.pages) == 2
    assert "Test page 2" in (extracted_pdf.pages[0].extract_text() or "")

    deleted = client.post(
        "/api/v1/pdf/delete-pages",
        files={"file": upload(original)},
        data={"pages": "1,4"},
    )
    assert len(read_pdf(deleted.content).pages) == 2

    rotated = client.post(
        "/api/v1/pdf/rotate",
        files={"file": upload(original)},
        data={"pages": "1", "degrees": "90"},
    )
    assert read_pdf(rotated.content).pages[0].rotation == 90

    reordered = client.post(
        "/api/v1/pdf/reorder",
        files={"file": upload(original)},
        data={"order": "4,3,2,1"},
    )
    result = read_pdf(reordered.content)
    assert "Test page 4" in (result.pages[0].extract_text() or "")


def test_split_and_lossless_optimize() -> None:
    original = make_named_pdf("Optimized", 3, title="Keep metadata")
    split = client.post(
        "/api/v1/pdf/split",
        files={"file": upload(original)},
        data={"mode": "pages"},
    )
    assert split.status_code == 200
    with ZipFile(BytesIO(split.content)) as archive:
        assert archive.namelist() == ["part-001.pdf", "part-002.pdf", "part-003.pdf"]
        assert "Optimized page 2" in (
            read_pdf(archive.read("part-002.pdf")).pages[0].extract_text() or ""
        )

    optimized = client.post(
        "/api/v1/pdf/optimize",
        files={"file": upload(original)},
    )
    assert optimized.status_code == 200
    optimized_pdf = read_pdf(optimized.content)
    assert len(optimized_pdf.pages) == 3
    assert "Optimized page 1" in (optimized_pdf.pages[0].extract_text() or "")
    assert optimized_pdf.metadata is not None
    assert optimized_pdf.metadata.title == "Keep metadata"


def test_images_to_pdf_preserves_image_order_and_dimensions() -> None:
    images: list[tuple[str, tuple[int, int], str]] = [
        ("first.png", (64, 32), "red"),
        ("second.png", (20, 50), "blue"),
    ]
    files = []
    for name, size, color in images:
        buffer = BytesIO()
        Image.new("RGB", size, color).save(buffer, format="PNG")
        files.append(("files", (name, buffer.getvalue(), "image/png")))

    response = client.post("/api/v1/pdf/images-to-pdf", files=files)
    assert response.status_code == 200
    result = read_pdf(response.content)
    assert len(result.pages) == 2
    assert (float(result.pages[0].mediabox.width), float(result.pages[0].mediabox.height)) == (64, 32)
    assert (float(result.pages[1].mediabox.width), float(result.pages[1].mediabox.height)) == (20, 50)
