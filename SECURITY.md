# Security Policy

DocuForge processes documents locally and accepts complex, potentially hostile file formats. Security reports are welcome and should be handled privately until a fix or mitigation is available.

## Supported versions

DocuForge does not currently publish versioned stable releases. Security fixes target the latest revision on the repository's default branch.

| Version | Supported |
| --- | --- |
| Latest default-branch revision | Yes |
| Older commits or unofficial builds | No |

This table will be updated when versioned releases are introduced.

## Reporting a vulnerability

Do **not** open a public issue, discussion, or pull request for an undisclosed vulnerability.

Use GitHub's private vulnerability reporting flow for this repository:

1. Open the repository's **Security** tab.
2. Select **Advisories**.
3. Select **Report a vulnerability**.

If private vulnerability reporting is not available, contact the repository owner privately using the contact method on their GitHub profile. Share only enough information in the first message to establish a private reporting channel.

Include, when available:

- the affected commit, feature, route, and platform;
- vulnerability type and realistic impact;
- minimal reproduction steps using synthetic data;
- whether user interaction or local API access is required;
- relevant logs with document contents, recognized text, tokens, usernames, and local paths removed;
- a suggested mitigation, if you have one.

Please do not include confidential documents or exploit a vulnerability beyond what is necessary to demonstrate it. Maintainers will acknowledge reports as capacity allows, coordinate validation and remediation privately, and credit reporters who want attribution. The project does not currently operate a bug-bounty program or guarantee a response deadline.

## In scope

Examples include:

- arbitrary code execution, unsafe file parsing, path traversal, or unintended file access;
- cross-site scripting or unsafe rendering of imported document content;
- API authorization or origin weaknesses that expose locally stored documents;
- server-side request forgery or unexpected external document transmission;
- denial of service that can be triggered by a reasonably sized crafted document;
- unsafe temporary-file handling or leakage of document content;
- malicious dependency, model-weight, or update behavior introduced by this project;
- bypasses of file-type, page-count, size, or PDF manifest validation.

## Usually out of scope

- vulnerabilities that exist only in unsupported, locally modified builds;
- social engineering, physical access, or attacks requiring an already compromised device;
- availability issues caused solely by very large files when documented limits are enforced;
- upstream dependency issues with no demonstrated effect on DocuForge;
- feature requests, OCR accuracy problems, and ordinary malformed-file errors without a security impact.

Upstream vulnerabilities may still be reported privately when DocuForge needs a dependency upgrade or mitigation.

## Security expectations for contributors

- Treat every imported document, image, archive, filename, and manifest as untrusted.
- Keep document contents and OCR results out of logs and telemetry.
- Do not commit real user files, downloaded model weights, secrets, local storage, or generated artifacts.
- Validate type, range, count, and size at trust boundaries.
- Avoid implicit network access; make remote services explicit and opt-in.
- Preserve original documents and require confirmation for destructive actions.
- Review the licenses and provenance of code, models, weights, fonts, and datasets separately.

## Coordinated disclosure

Please allow maintainers a reasonable opportunity to investigate and publish a fix before public disclosure. Once remediation is available, maintainers may publish a GitHub security advisory describing affected versions, impact, mitigations, and reporter credit.

Good-faith research that follows this policy, avoids privacy violations and unnecessary disruption, and respects applicable law will not be intentionally pursued by the project as abusive activity.
