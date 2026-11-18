# Code signing policy

This project publishes Windows release artifacts from the public repository
[`introduction-to-classical-music/introduction-to-classical-music`](https://github.com/introduction-to-classical-music/introduction-to-classical-music).
Builds are produced by the public GitHub Actions CI and released from GitHub
Releases.

## Windows — SignPath Foundation (application in progress)

We are applying to the SignPath Foundation free code-signing program for
open-source projects.

When approved, the public statement will be:

> Free code signing provided by SignPath.io, certificate by SignPath Foundation.

### What will be signed

- Windows installer: `buquanshu-setup-<version>.exe` (NSIS)
- The Electron application executable contained in the installer, if supported
  by the approved SignPath artifact configuration.

Artifacts are built from this repository by CI. Only CI-built artifacts are
submitted to SignPath for signing. The private key is held by SignPath in its
HSM; this project does not store or receive the private key.

### Team roles (single-maintainer project)

- Author / maintainer: [`@Hektor1277`](https://github.com/Hektor1277)
- Reviewer: [`@Hektor1277`](https://github.com/Hektor1277) — all external pull
  requests are reviewed by the maintainer before merge.
- Approver: [`@Hektor1277`](https://github.com/Hektor1277) — every SignPath
  signing request requires explicit approval by the maintainer.

SignPath and GitHub accounts used for signing must have MFA enabled.

## Artifact verification

Users should obtain installers only from the official GitHub Releases page:

<https://github.com/introduction-to-classical-music/introduction-to-classical-music/releases>

Every release includes `SHA256SUMS.txt`, `checksums.json`, an SBOM, and
third-party notices. After signing is enabled, users can additionally verify
the Authenticode signature with `Get-AuthenticodeSignature` on Windows.

## Distribution locations

- GitHub Releases:
  <https://github.com/introduction-to-classical-music/introduction-to-classical-music/releases>
- Project documentation/site:
  <https://introduction-to-classical-music.github.io/introduction-to-classical-music-sites/>

## Privacy

The application is a local-first desktop application. It does not transfer
user library data to any server unless the user explicitly requests an
external retrieval operation. See `PRIVACY.md` for details.
