# Standalone artifact downloads through file-backed tickets

## Context

Upstream folds referenced artifact assets into standalone HTML downloads. This fork transfers remote downloads through expiring file-backed tickets to avoid large base64 RPC responses.

## Investigation

`planSharedArtifactDownload` in `src/bun/shared-artifacts.ts` decides whether assets can be embedded or require a ZIP. The existing ticket implementation reads a filesystem path, so selecting the original HTML would omit embedded assets and selecting the ZIP would undo upstream's behavior.

## Decision

`sharedArtifactDownloadFile` materializes folded HTML under `DEV3_HOME/cache/artifact-downloads`, keyed by its SHA-256, and reuses it for repeated requests. ZIPs and asset-free HTML keep their existing paths; original artifact records and bundles are preserved for other installed versions.

## Risks

Derived HTML consumes additional disk space until the cache is manually cleared. Expired tickets cannot access files, and clearing the cache during an active transfer may require retrying the download.

## Alternatives considered

Sending the folded page as base64 would restore the large-response bottleneck. Rewriting original artifact files would change shared on-disk state and break the version compatibility requirement.
