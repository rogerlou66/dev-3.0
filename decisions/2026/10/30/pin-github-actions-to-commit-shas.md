# Pin GitHub Actions to commit SHAs

## Context

Every workflow referenced third-party actions by a movable tag (`@v5`) and the Trivy scan by `@master`. A tag or branch can be re-pointed by whoever controls the action repository, and tag hijacking of popular actions, Trivy's included, has been used to steal CI secrets.

## Decision

Each `uses:` of an external action in `.github/` names the full commit SHA that its tag pointed to when pinned, with the exact version in a trailing comment (`@fbc6f39… # v5.1.0`). The pins are the same commits the major tags resolved to, so behaviour is unchanged; `trivy-action` moved from `master` to its v0.36.0 release. Upgrading an action means resolving the new tag's SHA (`git ls-remote --tags`) and replacing both the SHA and the comment.

## Risks

Pinned actions no longer pick up upstream security fixes automatically; someone has to bump them. `basic-ftp` (under Electrobun's `proxy-agent`) stays on 5.x: its only fixed line is 6.x, which `get-uri` does not accept, and dev3 never lists FTP directories.

## Alternatives considered

Keeping major tags trades supply-chain integrity for zero maintenance. Pinning only `trivy-action` would leave every other job, including release jobs holding signing secrets, on movable references.
