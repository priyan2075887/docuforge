## Summary

<!-- What user problem does this change solve? Keep the scope focused. -->

## Approach

<!-- Describe the implementation and any important trade-offs or alternatives. -->

## Validation

<!-- List the commands and manual workflows you actually ran, with results. -->

- [ ] `cd apps/web && npm.cmd run lint` (when web code changed)
- [ ] `cd apps/web && npm.cmd run build` (when web code changed)
- [ ] `cd services/api && .venv\Scripts\python -m pytest -q` (when API/PDF code changed)
- [ ] Affected user workflow tested manually, when applicable

## Visual changes

<!-- Add before/after screenshots or a short recording. Remove private documents, OCR text, usernames, and local paths. Write "Not applicable" when there is no visual change. -->

## Impact review

- [ ] I used only synthetic or redistribution-safe test documents.
- [ ] I did not add secrets, local storage, generated builds, downloaded model weights, or private files.
- [ ] I considered document integrity and whether originals remain unchanged.
- [ ] I considered keyboard access, focus behavior, contrast, and reduced motion for UI changes.
- [ ] I documented new dependencies, model/weight licenses, network access, or interoperability limitations.
- [ ] I added or updated tests for changed behavior where practical.

## Known limitations and follow-up

<!-- Identify limitations explicitly. Link follow-up issues when they exist. -->
