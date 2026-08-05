from __future__ import annotations

from io import BytesIO
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile

from PIL import Image, ImageOps
from pypdf import PdfReader, PdfWriter


class PDFToolError(ValueError):
    pass


MAX_COMPOSE_SOURCES = 50
MAX_COMPOSE_PAGES = 5_000
MIN_BLANK_PAGE_POINTS = 36
MAX_BLANK_PAGE_POINTS = 14_400
VALID_ROTATIONS = {0, 90, 180, 270}


def open_pdf(payload: bytes) -> PdfReader:
    """Open an unencrypted PDF from memory and eagerly validate its page tree."""

    try:
        reader = PdfReader(BytesIO(payload), strict=False)
        if reader.is_encrypted:
            raise PDFToolError("Password-protected PDFs are not supported yet.")
        # A surprising number of damaged files parse their header but fail while
        # resolving the page tree. Resolve it here so all callers get one clear
        # validation error instead of failing halfway through an operation.
        len(reader.pages)
        return reader
    except PDFToolError:
        raise
    except Exception as exc:
        raise PDFToolError("The PDF is invalid, damaged, or encrypted.") from exc


def parse_pages(specification: str, total: int) -> list[int]:
    if not specification.strip():
        raise PDFToolError("Enter at least one page or range, such as 1-3,5.")
    pages: list[int] = []
    for token in specification.replace(" ", "").split(","):
        try:
            if "-" in token:
                start, end = (int(value) for value in token.split("-", 1))
                if end < start:
                    raise PDFToolError(f"Invalid descending range: {token}.")
                pages.extend(range(start - 1, end))
            else:
                pages.append(int(token) - 1)
        except ValueError as exc:
            raise PDFToolError(f"Invalid page expression: {token}.") from exc
    if any(page < 0 or page >= total for page in pages):
        raise PDFToolError(f"Page selection must stay between 1 and {total}.")
    return list(dict.fromkeys(pages))


def _copy_metadata(reader: PdfReader, writer: PdfWriter) -> None:
    """Copy safe document-info strings without leaking pypdf proxy objects."""

    metadata = reader.metadata
    if not metadata:
        return
    safe_metadata = {
        key: value
        for key, value in metadata.items()
        if isinstance(key, str)
        and key.startswith("/")
        and isinstance(value, str)
        and value
    }
    if safe_metadata:
        writer.add_metadata(safe_metadata)


def _write(writer: PdfWriter) -> bytes:
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _add_reader_pages(writer: PdfWriter, reader: PdfReader) -> None:
    for page in reader.pages:
        writer.add_page(page)


def merge_pdfs(payloads: list[bytes]) -> bytes:
    if len(payloads) < 2:
        raise PDFToolError("Select at least two PDFs to merge.")
    sources = [open_pdf(payload) for payload in payloads]
    writer = PdfWriter()
    try:
        for source in sources:
            _add_reader_pages(writer, source)
        _copy_metadata(sources[0], writer)
        return _write(writer)
    except PDFToolError:
        raise
    except Exception as exc:
        raise PDFToolError("The PDFs could not be merged.") from exc
    finally:
        writer.close()


def _integer(value: Any, field: str, item_number: int) -> int:
    if type(value) is not int:
        raise PDFToolError(f'Page item {item_number} field "{field}" must be an integer.')
    return value


def _rotation(item: dict[str, Any], item_number: int) -> int:
    rotation = _integer(item.get("rotation", 0), "rotation", item_number)
    if rotation not in VALID_ROTATIONS:
        raise PDFToolError(
            f"Page item {item_number} rotation must be 0, 90, 180, or 270 degrees."
        )
    return rotation


def _manifest_pages(manifest: Any) -> list[Any]:
    if isinstance(manifest, dict):
        unknown = set(manifest) - {"pages"}
        if unknown:
            raise PDFToolError('The compose manifest object may only contain a "pages" field.')
        manifest = manifest.get("pages")
    if not isinstance(manifest, list):
        raise PDFToolError('The compose manifest must be a JSON array or an object with a "pages" array.')
    if not manifest:
        raise PDFToolError("The compose manifest must contain at least one output page.")
    if len(manifest) > MAX_COMPOSE_PAGES:
        raise PDFToolError(f"The compose manifest cannot exceed {MAX_COMPOSE_PAGES:,} output pages.")
    return manifest


def compose_pdf(payloads: list[bytes], manifest: Any) -> bytes:
    """Build one PDF from an explicit, ordered page manifest.

    Source entries use a zero-based ``source`` index and a one-based ``page``
    number. Repeating an entry duplicates that page. Blank entries use
    ``{"blank": {"width": 595, "height": 842}}``; dimensions are PDF points.
    ``rotation`` is an optional clockwise rotation applied in addition to the
    source page's existing rotation.
    """

    if not payloads:
        raise PDFToolError("Select at least one source PDF to compose.")
    if len(payloads) > MAX_COMPOSE_SOURCES:
        raise PDFToolError(f"A composition can contain at most {MAX_COMPOSE_SOURCES} source PDFs.")

    pages = _manifest_pages(manifest)
    sources = [open_pdf(payload) for payload in payloads]
    writer = PdfWriter()
    try:
        for item_number, raw_item in enumerate(pages, 1):
            if not isinstance(raw_item, dict):
                raise PDFToolError(f"Page item {item_number} must be a JSON object.")
            item: dict[str, Any] = raw_item
            rotation = _rotation(item, item_number)

            if "blank" in item:
                unknown = set(item) - {"blank", "rotation"}
                if unknown:
                    raise PDFToolError(
                        f"Blank page item {item_number} contains unsupported fields: "
                        + ", ".join(sorted(unknown))
                        + "."
                    )
                blank = item["blank"]
                if not isinstance(blank, dict):
                    raise PDFToolError(f'Page item {item_number} field "blank" must be an object.')
                if set(blank) != {"width", "height"}:
                    raise PDFToolError(
                        f'Page item {item_number} blank page must contain exactly "width" and "height".'
                    )
                width = blank["width"]
                height = blank["height"]
                if isinstance(width, bool) or not isinstance(width, (int, float)):
                    raise PDFToolError(f"Page item {item_number} blank width must be a number.")
                if isinstance(height, bool) or not isinstance(height, (int, float)):
                    raise PDFToolError(f"Page item {item_number} blank height must be a number.")
                if not MIN_BLANK_PAGE_POINTS <= width <= MAX_BLANK_PAGE_POINTS:
                    raise PDFToolError(
                        f"Page item {item_number} blank width must be between "
                        f"{MIN_BLANK_PAGE_POINTS} and {MAX_BLANK_PAGE_POINTS} points."
                    )
                if not MIN_BLANK_PAGE_POINTS <= height <= MAX_BLANK_PAGE_POINTS:
                    raise PDFToolError(
                        f"Page item {item_number} blank height must be between "
                        f"{MIN_BLANK_PAGE_POINTS} and {MAX_BLANK_PAGE_POINTS} points."
                    )
                composed_page = writer.add_blank_page(width=float(width), height=float(height))
            else:
                unknown = set(item) - {"source", "page", "rotation"}
                if unknown:
                    raise PDFToolError(
                        f"Page item {item_number} contains unsupported fields: "
                        + ", ".join(sorted(unknown))
                        + "."
                    )
                if "source" not in item or "page" not in item:
                    raise PDFToolError(
                        f'Page item {item_number} must contain "source" and "page", or a "blank" object.'
                    )
                source_index = _integer(item["source"], "source", item_number)
                page_number = _integer(item["page"], "page", item_number)
                if source_index < 0 or source_index >= len(sources):
                    raise PDFToolError(
                        f"Page item {item_number} source must stay between 0 and {len(sources) - 1}."
                    )
                source = sources[source_index]
                if page_number < 1 or page_number > len(source.pages):
                    raise PDFToolError(
                        f"Page item {item_number} page must stay between 1 and {len(source.pages)} "
                        f"for source {source_index}."
                    )
                # PdfWriter returns a distinct page dictionary, even when the
                # same source page is added repeatedly. This keeps duplicate
                # pages' rotations independent while safely sharing resources.
                composed_page = writer.add_page(source.pages[page_number - 1])

            if rotation:
                composed_page.rotate(rotation)

        _copy_metadata(sources[0], writer)
        return _write(writer)
    except PDFToolError:
        raise
    except Exception as exc:
        raise PDFToolError("The PDF composition could not be generated.") from exc
    finally:
        writer.close()


def extract_pages(payload: bytes, specification: str) -> bytes:
    source = open_pdf(payload)
    writer = PdfWriter()
    try:
        for page in parse_pages(specification, len(source.pages)):
            writer.add_page(source.pages[page])
        _copy_metadata(source, writer)
        return _write(writer)
    except PDFToolError:
        raise
    except Exception as exc:
        raise PDFToolError("The selected pages could not be extracted.") from exc
    finally:
        writer.close()


def delete_pages(payload: bytes, specification: str) -> bytes:
    source = open_pdf(payload)
    writer = PdfWriter()
    try:
        pages = set(parse_pages(specification, len(source.pages)))
        if len(pages) == len(source.pages):
            raise PDFToolError("A PDF must retain at least one page.")
        for index, page in enumerate(source.pages):
            if index not in pages:
                writer.add_page(page)
        _copy_metadata(source, writer)
        return _write(writer)
    except PDFToolError:
        raise
    except Exception as exc:
        raise PDFToolError("The selected pages could not be removed.") from exc
    finally:
        writer.close()


def rotate_pages(payload: bytes, specification: str, degrees: int) -> bytes:
    if degrees not in {90, 180, 270}:
        raise PDFToolError("Rotation must be 90, 180, or 270 degrees.")
    source = open_pdf(payload)
    selected = set(parse_pages(specification, len(source.pages)))
    writer = PdfWriter()
    try:
        for index, page in enumerate(source.pages):
            output_page = writer.add_page(page)
            if index in selected:
                output_page.rotate(degrees)
        _copy_metadata(source, writer)
        return _write(writer)
    except PDFToolError:
        raise
    except Exception as exc:
        raise PDFToolError("The selected pages could not be rotated.") from exc
    finally:
        writer.close()


def reorder_pages(payload: bytes, order: str) -> bytes:
    source = open_pdf(payload)
    writer = PdfWriter()
    try:
        pages = parse_pages(order, len(source.pages))
        if len(pages) != len(source.pages):
            raise PDFToolError("The new order must contain every page exactly once.")
        for page in pages:
            writer.add_page(source.pages[page])
        _copy_metadata(source, writer)
        return _write(writer)
    except PDFToolError:
        raise
    except Exception as exc:
        raise PDFToolError("The pages could not be reordered.") from exc
    finally:
        writer.close()


def split_pdf(payload: bytes, mode: str, ranges: str | None = None) -> bytes:
    source = open_pdf(payload)
    archive_buffer = BytesIO()
    selections = (
        [[page] for page in range(len(source.pages))]
        if mode == "pages"
        else [
            parse_pages(item, len(source.pages))
            for item in (ranges or "").split(";")
            if item.strip()
        ]
    )
    if not selections:
        raise PDFToolError("Provide ranges separated by semicolons, such as 1-3;4-6.")
    try:
        with ZipFile(archive_buffer, "w", ZIP_DEFLATED) as archive:
            for index, pages in enumerate(selections, 1):
                writer = PdfWriter()
                try:
                    for page in pages:
                        writer.add_page(source.pages[page])
                    _copy_metadata(source, writer)
                    archive.writestr(f"part-{index:03}.pdf", _write(writer))
                finally:
                    writer.close()
        return archive_buffer.getvalue()
    except PDFToolError:
        raise
    except Exception as exc:
        raise PDFToolError("The PDF could not be split.") from exc


def optimize_pdf(payload: bytes) -> bytes:
    """Perform a lossless structural rewrite and content-stream compression.

    pypdf deliberately does not resample image content. This endpoint therefore
    removes duplicate/orphaned objects and deflates page content streams, but it
    does not promise the lossy image-size reductions of a dedicated optimizer.
    """

    source = open_pdf(payload)
    writer = PdfWriter()
    try:
        writer.clone_document_from_reader(source)
        for page in writer.pages:
            page.compress_content_streams(level=9)
        writer.compress_identical_objects(remove_identicals=True, remove_orphans=True)
        return _write(writer)
    except Exception as exc:
        raise PDFToolError("The PDF could not be optimized.") from exc
    finally:
        writer.close()


def images_to_pdf(images: list[tuple[bytes, str]]) -> bytes:
    if not images:
        raise PDFToolError("Select at least one image.")
    writer = PdfWriter()
    try:
        for payload, _extension in images:
            try:
                with Image.open(BytesIO(payload)) as opened:
                    source_image = ImageOps.exif_transpose(opened)
                    if source_image.mode in {"RGBA", "LA"} or (
                        source_image.mode == "P" and "transparency" in source_image.info
                    ):
                        rgba = source_image.convert("RGBA")
                        rgb = Image.new("RGB", rgba.size, "white")
                        rgb.paste(rgba, mask=rgba.getchannel("A"))
                    else:
                        rgb = source_image.convert("RGB")
                    page_buffer = BytesIO()
                    rgb.save(page_buffer, format="PDF", resolution=72.0)
                image_pdf = open_pdf(page_buffer.getvalue())
                writer.add_page(image_pdf.pages[0])
            except Exception as exc:
                raise PDFToolError("One of the selected images is unsupported or damaged.") from exc
        return _write(writer)
    except PDFToolError:
        raise
    except Exception as exc:
        raise PDFToolError("The images could not be converted to PDF.") from exc
    finally:
        writer.close()
