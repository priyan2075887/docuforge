# Contributing to DocuForge

Thank you for helping improve DocuForge. The project aims to provide a local-first, open-source document workspace while keeping document handling, privacy, interoperability, and accessibility explicit.

## Before you start

- Search existing issues before opening a new one.
- Use the bug or feature-request issue form when the change needs discussion.
- Keep pull requests focused on one problem or closely related set of changes.
- For a security vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
- Never attach private, confidential, licensed, or personally identifying documents to an issue or pull request. Create a minimal synthetic reproducer instead.

Small fixes may go directly to a pull request. Please propose broad architecture changes, new document models, new OCR providers, and major dependencies in an issue first so their compatibility, maintenance, and licensing implications can be reviewed.

## Development setup

DocuForge currently contains two primary workspaces:

```text
apps/web       React, TypeScript, and Vite client
services/api   FastAPI document, PDF, and OCR service
```

### Web application

From `apps/web`:

```powershell
npm.cmd install
npm.cmd run dev
```

The development server is available at `http://localhost:5173` by default.

### API

From `services/api`:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

API documentation is available at `http://localhost:8000/docs` while the service is running.

PaddleOCR is optional and is not required for the standard API test suite. If your change specifically concerns OCR, install the isolated OCR requirements:

```powershell
.venv\Scripts\python -m pip install -r requirements-ocr-paddle.txt
```

OCR model files may be downloaded on first use. Review the model and dependency licenses before proposing a new provider or redistributed model artifact.

## Making a change

1. Create a branch from the repository's default branch.
2. Reproduce the problem or define the expected behavior.
3. Implement the smallest coherent change.
4. Add or update tests where behavior can be exercised automatically.
5. Run the relevant validation commands.
6. Update user-facing documentation when setup, behavior, limitations, or licensing changes.
7. Open a pull request using the repository template.

Do not commit generated build output, local virtual environments, downloaded model weights, API storage, or real user documents.

## Validation

Run the checks for every workspace you changed.

### Web checks

```powershell
cd apps/web
npm.cmd run lint
npm.cmd run build
```

For UI changes, also exercise the affected workflow in a browser. Check loading, empty, success, failure, keyboard, and narrow-screen states where applicable.

### API and PDF checks

```powershell
cd services/api
.venv\Scripts\python -m pytest -q
```

For PDF changes, use small synthetic files and verify the generated result, not only the HTTP status. Useful checks include page count, order, rotation, text preservation, and invalid-input behavior.

If you cannot run a relevant check, explain why in the pull request. Do not describe a check as passing unless you ran it against the submitted changes.

## Project expectations

### Local-first and private by default

- Keep normal document processing local unless a feature clearly tells the user otherwise.
- Do not add analytics, telemetry, remote inference, or external uploads without prior discussion and explicit user control.
- Avoid logging document contents, recognized text, filenames, access tokens, or full local paths.
- Treat documents and images as untrusted input on both the client and API.

### Document integrity

- Do not overwrite an original document implicitly.
- Make destructive actions explicit and recoverable where practical.
- Preserve content and metadata deliberately; document known losses during format conversion.
- Reject malformed or unsupported inputs with actionable errors rather than silent partial output.

### Dependencies, models, and licensing

- Prefer actively maintained dependencies with clear open-source licenses.
- Include the implementation license, model-weight license, redistribution terms, and expected download size when proposing an OCR or vision model.
- Do not claim that a model, dataset, font, or weight file is open source solely because its code is available.
- Avoid copying proprietary product code, assets, branding, or exact trade dress.
- Explain why a new heavyweight dependency is justified and whether it can be loaded only when needed.

### User interface and accessibility

- Follow the existing interaction and visual language.
- Use semantic controls, visible focus states, useful accessible names, and full keyboard operation for core workflows.
- Respect reduced-motion preferences and maintain sufficient contrast.
- Keep long-running document operations responsive and provide clear progress or processing states.

### Code and API changes

- Keep TypeScript types specific; avoid introducing `any` without a documented boundary.
- Keep API validation close to the input boundary and return safe, actionable error details.
- Close documents, streams, canvases, object URLs, and other resources when they are no longer needed.
- Cover regressions with tests when practical, especially for page transformations and validation rules.
- Preserve backward compatibility unless a breaking change has been discussed and documented.

## Commits and pull requests

Write concise, imperative commit subjects, for example:

```text
Add range validation to split workflow
Fix thumbnail cleanup after PDF removal
```

A useful pull request explains:

- the user problem;
- the chosen approach and important trade-offs;
- how it was validated;
- screenshots or a short recording for visible UI changes;
- privacy, security, performance, compatibility, and licensing effects;
- known limitations or follow-up work.

Maintainers may ask for a change to be split when independent concerns would be easier to review and revert separately.

## Reporting a problem

Use the structured GitHub issue forms and provide a minimal synthetic example when possible. Remove recognized text, metadata, usernames, and local paths from screenshots and logs. Security-sensitive reports belong in the private process described in [SECURITY.md](SECURITY.md).

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
