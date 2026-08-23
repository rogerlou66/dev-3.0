# Android hybrid client with a native prompt bridge

## Context

The browser remote client already reaches the full product through authenticated RPC and PTY WebSockets, but Android tablet users report slow rendering, broken browser controls, and laggy coding-agent prompt entry. A useful Android client must preserve the computer as the authority while removing WebView main-thread and IME work from the latency-critical prompt path.

## Investigation

`remote-access-server.ts` exposes the complete UI plus `/rpc` and `/pty`, and the renderer already owns reconnect, terminal resume, touch navigation, and the action taxonomy. The audit also found that the same-origin `/p/` dev-port proxy could forward the dev3 session cookie to arbitrary localhost apps, so proxy credentials must be stripped independently of the Android bridge.

## Decision

Build a Kotlin Android shell that loads the existing client, while a native multiline prompt dock exchanges whole committed prompts through `WebViewCompat.addWebMessageListener`. Inject a document-start shell marker so Android tablet layout is available before the asynchronous message port exists; restrict the bridge to the paired exact origin, trusted root path and main frame; preserve tri-state delivery, route device-local handoffs through capability requests, and stream large artifact bundles through a short-lived same-origin ticket plus the trusted session cookie. Revocation uses the additive `~/.dev3.0/remote-revoked-sessions.json` parallel path; entries expire with their 24-hour session and no existing path is renamed or migrated.

## Risks

The shared UI still pays React and terminal-rendering costs outside prompt entry. Dynamic private LAN endpoints require broad manifest cleartext permission, so code gates public HTTP, warns before private unencrypted LAN, disables sensitive native actions there, cancels SSL errors, and strips all credentials from the separate dev-port proxy. Stream tickets expire after ten minutes so the system picker can stay open, require the trusted cookie, never enter logs, stay same-origin in Android, and cap writes at 128 MB; older app versions ignore the revocation file, so device revocation is guaranteed only while a version containing this registry serves remote access.

## Alternatives considered

A plain WebView wrapper was rejected because it preserves the reported input bottleneck and browser capability gaps. A fully native Compose rewrite was rejected because it duplicates project/task state, action taxonomy, terminal semantics, i18n, and hundreds of evolving RPC calls before proving the Android workflow.
