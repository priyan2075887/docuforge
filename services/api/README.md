# DocuForge local API

The DocuForge API is a FastAPI service for local PDF transformation, embedded-text inspection, optional OCR, and early development document storage. It is the processing companion to the browser workspace in `apps/web`.

> [!WARNING]
> This is an **active-alpha, trusted single-user localhost service**. It has no authentication, authorization, tenant isolation, job isolation, rate limiting, or hostile-file sandbox. Run it on `127.0.0.1` only. Do not bind it to `0.0.0.0`, expose it to a LAN or the internet, place it behind a public reverse proxy, or process untrusted documents.

## Responsibilities

The base API provides:

- health reporting;
- local development upload, listing, and download endpoints;
- PDF embedded-text and page-dimension inspection;
- merge, compose, extract, delete, rotate, reorder, split, structural optimization, and image-to-PDF operations;
- OCR-engine capability reporting;
- optional PDF-page recognition with PaddleOCR/PP-OCRv5.

The permissive PDF backend uses pypdf for structural transformations, metadata, and native text extraction. pypdfium2 rasterizes only the low/no-text pages routed to OCR, and Pillow supplies image normalization. PaddleOCR is deliberately kept in a separate optional requirements file.

## Requirements

- Python 3.11 or 3.12
- A supported Windows, Linux, or macOS environment for the base Python dependencies
- Additional platform-specific support and disk space if PaddleOCR is installed

Commands below are shown for Windows PowerShell. On Linux or macOS, use the equivalent `.venv/bin/python` path.

## Install

```powershell
cd services/api
python -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install -r requirements.txt
```

Install development/test dependencies separately:

```powershell
.venv\Scripts\python -m pip install -r requirements-dev.txt
```

The base install does not download an OCR model.

## Run locally

```powershell
.venv\Scripts\python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Useful local URLs:

- Health: `http://127.0.0.1:8000/health`
- OpenAPI UI: `http://127.0.0.1:8000/docs`
- OpenAPI JSON: `http://127.0.0.1:8000/openapi.json`

The web development server runs on `http://localhost:5173` and proxies browser paths beginning with `/api` to this service. FastAPI routes themselves begin with `/api/v1`.

Do not treat the configured CORS origin as a security boundary. CORS controls cooperating browsers; it does not authenticate a caller or prevent direct HTTP requests.

## Optional PaddleOCR

Install OCR only when scanned-page recognition is needed:

```powershell
.venv\Scripts\python -m pip install -r requirements-ocr-paddle.txt
```

The optional requirements currently pin:

```text
paddlepaddle==3.2.2
paddleocr==3.7.0
```

The provider uses PP-OCRv5 with `lang="en"`, document-orientation classification, document unwarping, and text-line orientation. Model files are not stored in the repository and may be downloaded into Paddle's user cache the first time inference runs.

Check readiness before starting a long OCR request:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/v1/ocr/engines
```

If PaddleOCR is absent, `/api/v1/ocr/recognize` returns `503` with an installation hint. Recognition accepts a `dpi` query parameter between 120 and 300, defaults to 200, and processes pages synchronously. Pages with at least 24 trimmed embedded-text characters bypass OCR. This is a routing heuristic, not a confidence guarantee.

The current response contains text and line metadata. It does not create a searchable-PDF text layer, preserve page geometry in an export format, translate text, or perform asynchronous/background processing.

## Endpoint summary

All upload routes use `multipart/form-data`.

| Method | Route | Main input | Output |
| --- | --- | --- | --- |
| `GET` | `/health` | None | Service status JSON |
| `POST` | `/api/v1/documents` | `file` | Local storage metadata JSON |
| `GET` | `/api/v1/documents` | None | Stored metadata array |
| `GET` | `/api/v1/documents/{document_id}/download` | Path ID | Original stored bytes |
| `POST` | `/api/v1/documents/inspect` | PDF `file` | Page sizes, embedded text, and OCR-routing flags |
| `GET` | `/api/v1/ocr/engines` | None | Provider availability and install hints |
| `POST` | `/api/v1/ocr/recognize?dpi=200` | PDF `file` | Embedded/OCR text and line metadata JSON |
| `POST` | `/api/v1/pdf/merge` | Repeated `files` | `merged.pdf` |
| `POST` | `/api/v1/pdf/compose` | Repeated `files`, JSON `manifest` form field | `organized.pdf` |
| `POST` | `/api/v1/pdf/extract` | PDF `file`, `pages` | `extracted-pages.pdf` |
| `POST` | `/api/v1/pdf/delete-pages` | PDF `file`, `pages` | `pages-removed.pdf` |
| `POST` | `/api/v1/pdf/rotate` | PDF `file`, `pages`, `degrees` | `rotated.pdf` |
| `POST` | `/api/v1/pdf/reorder` | PDF `file`, `order` | `reordered.pdf` |
| `POST` | `/api/v1/pdf/split` | PDF `file`, `mode`, optional `ranges` | `split-pdf.zip` |
| `POST` | `/api/v1/pdf/optimize` | PDF `file` | `optimized.pdf` |
| `POST` | `/api/v1/pdf/images-to-pdf` | Repeated image `files` | `images.pdf` |

### Page expressions

Page expressions are one-based comma-separated pages and inclusive ranges:

```text
1-3,5,8-10
```

Descending ranges and pages outside the source document are rejected. Duplicate values are normalized for selection-based operations. Reordering must contain every source page exactly once.

Split mode `pages` produces one PDF per page. Range mode accepts semicolon-separated outputs, for example:

```text
1-3;4-6;7,9
```

### Compose manifest

`POST /api/v1/pdf/compose` builds one PDF atomically from an ordered JSON manifest and one or more source PDFs. Source indexes are zero-based; page numbers are one-based.

```json
{
  "pages": [
    { "source": 0, "page": 2, "rotation": 90 },
    { "source": 1, "page": 1 },
    { "source": 0, "page": 2, "rotation": 180 },
    { "blank": { "width": 595, "height": 842 }, "rotation": 0 }
  ]
}
```

- Repeating a source/page entry duplicates it.
- Rotation is clockwise and must be `0`, `90`, `180`, or `270`.
- Blank dimensions are PDF points and must each be between 36 and 14,400.
- A composition accepts at most 50 source PDFs and 5,000 output pages.
- Unknown manifest fields, missing source/page fields, booleans used as numbers, invalid dimensions, and out-of-range references are rejected.
- Password-protected, damaged, or unsupported PDFs are rejected.

Example with PowerShell's native `curl.exe`:

```powershell
curl.exe -X POST http://127.0.0.1:8000/api/v1/pdf/compose `
  -F "files=@first.pdf;type=application/pdf" `
  -F "files=@second.pdf;type=application/pdf" `
  -F 'manifest={"pages":[{"source":0,"page":1},{"source":1,"page":1,"rotation":90}]}' `
  --output organized.pdf
```

## Storage behavior

`POST /api/v1/documents` stores the uploaded bytes as a UUID-named `.bin` file and writes a neighboring JSON metadata record under:

```text
<repository>/storage/documents/
```

The original client filename is reduced to its basename before it is placed in metadata. The storage directory is ignored by Git.

This filesystem store is separate from the web application's IndexedDB **My files** library. It has no user accounts, encryption, quota, expiration, cleanup worker, or deletion endpoint. Do not use it as a shared or durable production repository. Remove development data deliberately according to your own retention requirements; never commit it.

PDF transformation and OCR endpoints read uploads into memory. Generated PDFs and ZIP archives are assembled in memory before being returned. The current 100 MiB check applies to each uploaded file/part, not aggregate request memory, decompressed PDF complexity, output size, or concurrent work.

## Errors and current limits

Expected client-facing statuses include:

| Status | Meaning |
| --- | --- |
| `413` | An uploaded part exceeds 100 MiB |
| `415` | Document inspection received a non-PDF |
| `422` | Invalid PDF, manifest, page expression, rotation, dimensions, or mode |
| `503` | PaddleOCR recognition was requested but the optional runtime is unavailable |

Additional alpha limitations:

- PDF operations are synchronous and do not expose jobs, progress, cancellation, deadlines, or bounded concurrency.
- Password-protected PDFs are unsupported.
- Structural transforms do not promise preservation of signatures, forms, annotations, outlines, attachments, page labels, optional content, structure trees, or every metadata field.
- Optimization performs structural/lossless cleanup where the backend supports it; it is not aggressive image downsampling.
- OCR currently recognizes English, uses a simple embedded-text threshold, and does not generate searchable PDFs.
- The process has no parser sandbox, malware scanner, tenant isolation, or production logging/audit policy.

## Validation

Install the development dependencies, then run:

```powershell
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest -q
```

The tests use generated synthetic documents; OCR model installation is not required for the standard suite. Current coverage includes:

- health and development-storage behavior;
- non-PDF inspection rejection;
- page-expression parsing and range validation;
- merge and mixed-source atomic composition;
- duplication, independent rotations, blank pages, and metadata/annotation carryover;
- malformed manifests and damaged-source rejection;
- encrypted-input rejection, native text/page dimensions, and PDFium OCR rasterization;
- extract, delete, reorder, split, optimize, and image-to-PDF operations.

For a PDF change, inspect the generated document properties—page count, order, rotation, text, dimensions, and expected metadata—not only the HTTP response code. Add synthetic fixtures for regressions and never commit real user documents.

The frontend has its own validation commands in [`apps/web/README.md`](../../apps/web/README.md). Repository-wide contribution expectations are in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## Security and privacy

- Keep Uvicorn bound to `127.0.0.1`.
- Do not put the service behind a public proxy or tunnel.
- Treat PDFs and images as hostile parser input even when they appear ordinary.
- Do not log document contents, OCR text, filenames, access tokens, or full local paths.
- Do not commit uploads, OCR caches, virtual environments, model weights, or generated outputs.
- Review implementation, runtime, model-weight, font, and dataset licenses separately.
- Report vulnerabilities through the private process in [`SECURITY.md`](../../SECURITY.md).

## Internal modules

```text
app/main.py          application, CORS, health, storage, inspection, OCR routes
app/routers/pdf.py   multipart HTTP boundary and response filenames
app/pdf_tools.py     PDF validation and structural operations
app/ocr/paddle.py    lazy, cached PaddleOCR provider
tests/               synthetic API and PDF regression tests
```

The broader data flow and trust model are documented in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

## License and independence

DocuForge application code is available under the repository's [MIT License](../../LICENSE). Dependencies and optional model artifacts retain their own licenses. See the repository's [third-party notices](../../THIRD_PARTY_NOTICES.md), especially the requirement to preserve license and notice files when redistributing pypdfium2 wheels or their bundled PDFium binary.

DocuForge is independently implemented and is not affiliated with WPS Office, Microsoft Office, iLovePDF, or their owners. It does not use their proprietary source code, assets, branding, or exact trade dress.
