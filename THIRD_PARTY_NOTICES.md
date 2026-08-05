# Third-party notices

DocuForge is distributed under the [MIT License](LICENSE). Third-party
libraries, optional runtimes, and downloaded model files remain subject to
their own licenses. This document is an attribution-oriented inventory of the
project's direct dependencies; it is not a replacement for the license files
shipped by those projects or for a review of transitive dependencies.

The exact JavaScript dependency graph is recorded in
`apps/web/package-lock.json`. Exact Python runtime and optional OCR versions
are recorded in `services/api/requirements*.txt`.

## Web application

| Project or package family | Use in DocuForge | License |
| --- | --- | --- |
| React and React DOM | User interface runtime | MIT |
| Tiptap packages | Rich-text editor | MIT |
| PDF.js (`pdfjs-dist`) | In-browser PDF rendering and previews | Apache-2.0 |
| `docx` | DOCX export | MIT |
| Mammoth | DOCX import | BSD-2-Clause |
| ExcelJS | Spreadsheet import and export | MIT |
| PptxGenJS | Presentation export | MIT |
| `idb` | IndexedDB access | ISC |
| Lucide React | Interface icons | ISC |
| FileSaver.js | Browser downloads | MIT |
| Vite and its React plugin | Build tooling | MIT |
| TypeScript | Type checking and compilation | Apache-2.0 |
| Oxlint | Static analysis | MIT |

The npm dependency tree also contains transitive packages with their own
permissive or weak-copyleft licenses. One legacy transitive package,
`buffers@0.1.1`, does not publish a license field in its package metadata; it
is pulled in by `exceljs > unzipper > binary`. Its upstream provenance reports
MIT licensing, but distributors should re-check that package when producing a
formal binary distribution.

## API and PDF processing

| Project | Use in DocuForge | License |
| --- | --- | --- |
| FastAPI | HTTP API framework | MIT |
| Uvicorn | ASGI development server | BSD-3-Clause |
| python-multipart | Multipart request parsing | Apache-2.0 |
| pypdf | PDF structure, page composition, and writing | BSD-3-Clause |
| pypdfium2 | Python bindings and packaging for PDFium rendering | Apache-2.0 or BSD-3-Clause |
| PDFium | PDF page rendering engine used by pypdfium2 wheels | BSD-style license plus bundled third-party notices |
| Pillow | Image decoding and images-to-PDF conversion | HPND |

Development-only API dependencies include pytest (MIT) and HTTPX
(BSD-3-Clause).

When redistributing pypdfium2 wheels or a packaged application containing
PDFium, preserve the license and third-party notice files included by the
pypdfium2 distribution. See the upstream
[pypdfium2 licensing documentation](https://github.com/pypdfium2-team/pypdfium2#licensing).

## Optional OCR runtime and models

The standard install and CI do not include an OCR engine or model weights.
Users may separately install:

| Project | Use in DocuForge | License |
| --- | --- | --- |
| PaddlePaddle | Optional local inference runtime | Apache-2.0 |
| PaddleOCR | Optional OCR pipeline | Apache-2.0 |

PaddleOCR downloads model artifacts on first use. Model files are not stored
in this repository and are not covered by DocuForge's MIT license. Before
redistributing a model, verify the specific artifact's model card, dataset
terms, attribution requirements, and export restrictions. The same rule
applies to any future Surya, Docling, or vision-language model integration.

## Fonts, artwork, and sample documents

DocuForge uses a system-font stack and does not redistribute web-font files.
The DocuForge favicon and interface artwork in this repository are original
project assets covered by the repository license. No WPS Office or iLovePDF
assets, code, or proprietary branding are included.

No user document is part of the public source tree. Contributors must use
synthetic, redistribution-safe fixtures and must document the provenance and
license of any sample content they add.

## Producing a release

Before publishing a packaged release:

1. Generate a complete license report from the locked JavaScript and Python
   environments.
2. Include all license and notice files required by bundled libraries and
   native binaries.
3. Audit optional model weights separately from the runtime code.
4. Review newly introduced fonts, icons, fixtures, and generated assets.
5. Re-run the secret and personal-document checks described in
   [CONTRIBUTING.md](CONTRIBUTING.md).
