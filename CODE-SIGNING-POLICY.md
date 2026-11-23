# Code signing policy

This project publishes Windows release artifacts from the public repository
[`introduction-to-classical-music/introduction-to-classical-music`](https://github.com/introduction-to-classical-music/introduction-to-classical-music).
Builds are produced by the public GitHub Actions CI and released from GitHub
Releases.

## Windows — currently unsigned

The 0.1.2 release is **unsigned**. A SignPath Foundation application was
submitted and was not approved at this time because the project does not yet
meet the Foundation's public-visibility threshold. We respect that decision and
may reapply after the project has broader adoption, or use a paid certificate /
paid signing service in a future release.

Current releases are built by the public GitHub Actions CI and published as
GitHub Releases from this public repository. Users should verify
`SHA256SUMS.txt` / `checksums.json`, and may build from source. No private
signing key is stored in this repository.

### Team roles

- Authors / committers: [`@Hektor1277`](https://github.com/Hektor1277),
  [`@z1645444`](https://github.com/z1645444)
- Reviewers: [`@Hektor1277`](https://github.com/Hektor1277),
  [`@z1645444`](https://github.com/z1645444) — external pull requests are
  reviewed by a maintainer before merge.
- Approvers: [`@Hektor1277`](https://github.com/Hektor1277),
  [`@z1645444`](https://github.com/z1645444) — future signing requests require
  explicit approval by one of the listed approvers.

All team members must use MFA for GitHub and any future signing service.

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
