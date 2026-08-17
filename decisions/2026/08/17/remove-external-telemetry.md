# Remove external telemetry and remote feature flags

## Context

The renderer initialized GA4 on every launch and official builds injected a PostHog client with automatic capture capabilities. The landing page also loaded Google Analytics and Google Ads, while the app had no consent or opt-out control.

## Investigation

Explicit product events did not include task bodies or file contents, but GA4 sent public IP and error details. PostHog defaults permitted automatic element capture and session recording, and the same client supplied the remote terminal latency feature flag.

## Decision

Delete GA4, PostHog, their event call sites, build secrets, website tags, remote flag plumbing, and the Debug feature-flag surface. `src/bun/pty-server.ts` keeps the previously shipped trailing-edge batching path, while `GlobalSettings.analyticsDistinctId` is only round-tripped for N-2 compatibility with older versions sharing `settings.json`.

## Risks

Product usage and renderer errors are no longer visible in external analytics systems, and remote terminal batching can no longer be changed through a server-side rollout. Local logs and diagnostics remain available, and future behavior changes must ship as reviewed code.

## Alternatives considered

An opt-out setting would still initialize third-party SDK code before consent and would retain remote configuration as an outbound dependency. Keeping PostHog only for feature flags was rejected because its browser SDK still carries automatic-capture and remote-loading behavior that is unnecessary for one default-off experiment.
