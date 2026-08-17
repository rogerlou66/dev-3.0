# Desktop network listeners are local-only

## Context

The desktop app started a LAN-facing Remote Access server on every launch, while its direct PTY bridge accepted connections on every interface. A local desktop build should not expose either service to the company network without an explicit user action.

## Investigation

The Electrobun renderer reaches the PTY bridge on the same machine, so loopback is sufficient. The separate `dev3 remote` entry point owns the intentional browser workflow and can continue starting the authenticated remote server.

## Decision

Bind the direct PTY server to `127.0.0.1` in `src/bun/pty-server.ts`. Remove Remote Access startup and entry points from the desktop process while keeping `src/bun/headless-entry.ts` as the explicit opt-in path.

## Risks

The desktop header and native application menu no longer offer one-click Remote Access. Users who need browser or phone access must run `dev3 remote`, and that explicit process still listens beyond loopback by design.

## Alternatives considered

Keeping the desktop server behind a setting still leaves a dormant network subsystem and adds configuration UI. Binding the remote server to loopback would preserve local browser access but would not satisfy the requirement that Remote Access be explicitly started.
