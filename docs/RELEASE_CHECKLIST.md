# Release checklist

Use this checklist for every DocuForge source or packaged release. It is
deliberately stricter than the normal development workflow because document
workspaces can accumulate private files, OCR output, downloaded models, and
large generated artifacts.

## 1. Confirm the release scope

- [ ] The release version and user-visible changes are documented.
- [ ] The exact commit being released has passed review.
- [ ] Known limitations and any migration steps are current in `README.md`.
- [ ] No experimental feature is described as production-ready.

## 2. Protect user data

- [ ] `git status --short --ignored` shows document storage, virtual
      environments, dependency directories, and builds as ignored.
- [ ] `git ls-files` contains no real document, OCR output, user filename,
      local database, downloaded model, secret, or machine-specific path.
- [ ] Screenshots use an empty profile or deliberately synthetic documents.
- [ ] Test fixtures are synthetic, redistribution-safe, and documented.
- [ ] The staged diff has been scanned for tokens, credentials, private keys,
      email addresses, and absolute local paths.

Never rely on `.gitignore` to remove data that has already been committed.
If sensitive content enters Git history or a published release, stop the
release and rotate exposed credentials before rewriting history or replacing
the artifact.

## 3. Validate the web application

From `apps/web`:

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run build
```

- [ ] Core create, import, edit, save, reopen, and export flows were exercised
      in a browser.
- [ ] PDF tools were checked with small synthetic multi-page PDFs.
- [ ] Empty, loading, success, failure, keyboard, and narrow-screen states were
      considered for changed workflows.
- [ ] The production build has no unexpected external network dependency.

## 4. Validate the API

From `services/api`:

```powershell
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest -q
```

- [ ] Generated PDFs were opened again and checked for page count, order,
      rotation, and expected text or image content.
- [ ] Invalid ranges, oversized requests, encrypted PDFs, and malformed inputs
      return safe and useful errors where relevant.
- [ ] Standard tests do not install OCR runtimes or download model weights.

## 5. Review dependencies and licenses

- [ ] JavaScript and Python lock/pin files are current.
- [ ] Dependency vulnerability reports have been reviewed.
- [ ] `THIRD_PARTY_NOTICES.md` covers newly bundled direct dependencies,
      native libraries, fonts, artwork, and fixtures.
- [ ] Every redistributed OCR or vision model has been reviewed separately for
      code, weights, training-data, attribution, and redistribution terms.
- [ ] Required license and notice files are included in packaged artifacts.

## 6. Review security and deployment boundaries

- [ ] The local API still binds to loopback in documented development paths.
- [ ] No documentation suggests exposing the current unauthenticated API to
      the public internet.
- [ ] File parsing, temporary-file handling, logs, and error messages have been
      reviewed for data leakage.
- [ ] GitHub private vulnerability reporting is enabled.

## 7. Publish and verify

- [ ] CI passes on the release commit.
- [ ] The tag and release title match the documented version.
- [ ] Source archives contain only tracked, reviewed files.
- [ ] Packaged artifacts open successfully on every claimed platform.
- [ ] Repository links, setup commands, badges, and profile links resolve.
- [ ] Release notes distinguish implemented behavior from roadmap items.
