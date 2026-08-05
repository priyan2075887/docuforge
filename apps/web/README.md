# DocuForge web workspace

This package contains the React and TypeScript client for DocuForge. The root
[`README.md`](../../README.md) is the canonical project guide and includes the
full feature matrix, architecture, setup instructions, OCR configuration, and
interoperability boundaries.

## Development

```powershell
npm.cmd install
npm.cmd run dev
```

The Vite development server runs at `http://localhost:5173` and proxies `/api`
requests to the local FastAPI service at `http://localhost:8000`.

## Validation

```powershell
npm.cmd run lint
npm.cmd run build
```

The application uses route-level lazy loading. Keep heavy import/export or PDF
dependencies behind dynamic imports so they do not inflate the home-page bundle.
