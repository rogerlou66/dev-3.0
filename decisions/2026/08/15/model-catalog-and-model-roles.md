# Model catalog and model roles: a dev3-managed proxy sidecar for any provider

Status: implemented. The pure core is `src/shared/model-catalog.ts` (catalog types, sidecar
config generation, role resolution per agent, validation, warnings); the process lives in
`src/bun/model-sidecar.ts` with its state in `src/bun/model-catalog-store.ts`; launches route
through `applyModelRoleLaunch` in `src/bun/agents.ts`; the surfaces are
`ModelCatalogSection.tsx` and `PresetModelRoles.tsx`. The binary is fetched by
`scripts/fetch-bifrost.ts` against a recorded SHA-256 pin and staged by
`scripts/stage-bifrost.ts`.

Two deviations from the plan, both deliberate. The stored API key has no reveal toggle: keys
never travel back to the renderer at all, so the UI says a key is stored and offers to replace
it rather than pretending it can show it. And release CI gates on the pin only when
`vendor/bifrost/pinned.json` exists — a pinned target that 404s or drifts fails the build,
while an unpinned one ships with the catalog disabled and says so, instead of blocking every
release until someone records the first hash.

## Context

dev3 already had three partial answers to "run this agent against something other than its
native API", and none of them could express a mix of providers inside a single agent session:

- `src/shared/llm-provider.ts` — a provider registry (Bedrock for `claude` and `codex`) that
  pins one backend per launch and derives the model id from the preset's alias.
- Claude API profiles (`auth: "api"` in `src/bun/agent-accounts.ts`) — one base URL, one key,
  per-slot model overrides, Claude-only, activated globally through the account switcher.
- The pxpipe proxy (`src/bun/rpc-handlers/pxpipe-proxy.ts`) — a managed local sidecar on a
  fixed port behind an explicit settings toggle, downloaded at runtime via `npx`.

The goal that none of them reaches: launch Claude Code with its Opus slot served by an OpenAI
model and its Sonnet slot served by DeepSeek through OpenRouter, and give Codex CLI the same
treatment.

## Investigation

Two facts reshaped the design mid-session.

**The model string is decided by the client, not the proxy.** A gateway only sees the `model`
field the CLI put in the request. dev3's presets launch with a concrete `--model`, and that flag
beats every model env var — which is why `applyModelOverride` (`src/bun/agents.ts`) already
rewrites the flag rather than relying on `ANTHROPIC_DEFAULT_*_MODEL`. Any routing scheme must
therefore decide what dev3 writes into the launch command.

**Codex CLI has roles too.** As of 2026-08, Codex supports a main model, a default subagent
model (`agents.default_subagent_model`), a `/review` model, and per-named-agent models in TOML
files, with `-c` accepting dotted keys. The earlier assumption "Codex is one model per session,
so a mix is impossible there" was wrong. Codex additionally requires a custom provider to speak
the OpenAI Responses API (`wire_api = "responses"`) — Chat Completions alone is not enough.

Those two facts split the problem into layers that had been conflated: a provider/credential
layer and an agent-role layer.

## Decision

Two separate concepts, defined in AGENTS.md § Model routing glossary:

- **Model catalog** (app-wide, not switchable): the user registers providers with credentials
  and then builds named **catalog models** (`fast-gremlin` → OpenRouter `deepseek-flash`).
  Each entry belongs to exactly one provider, so it maps one-to-one onto a static alias on that
  provider's key in the sidecar's config. dev3 generates the config skeleton (loopback bind,
  isolated app dir, file-only config store, a local session key remembered across restarts, secrets only as `env.*`
  references); the user owns the contents. The model id field is a combobox fed by the sidecar's
  live model listing, with free text still allowed for models a provider does not list.
- **Model roles** (per preset): a preset binds catalog models to the roles its own CLI exposes.
  No common dev3 role vocabulary — Claude Code shows its alias slots, Codex shows main /
  default-subagent / review. Such a preset becomes its own picker group via the existing
  `groupLabel` mechanism, since its "model" is a set. Users build these presets by hand in the
  preset editor; dev3 does not auto-generate them.

Delivery: dev3 writes the catalog model's name into the launch command (rewriting `--model`,
setting the CLI's role env vars, and for Codex passing `-c` dotted keys only — no writes to
`~/.codex`). The sidecar resolves names to upstream models.

Operations: the binary is pinned by version and SHA-256 and bundled into the app (never
downloaded at runtime); one sidecar per app, started on demand and dying with the app; upstream
keys stored in a 0600 file under `~/.dev3.0` and passed only through the sidecar's child
environment. A preflight before agent spawn checks sidecar health and that every catalog model
the preset's roles reference is actually reachable, failing with a dialog instead of a dead
terminal. Metadata-only request logging is enabled (token counts and cost) with content logging
off, so a task's spend is answerable when subscription quotas do not apply.

## What the live binary changed

Running the pinned binary against a dev3-generated config (`scripts/smoke-bifrost.ts`)
contradicted the vendor cheat sheet on four points, each of which would have shipped as a
dead launch:

- **`logs_store.enabled: true` needs `type` and a payload.** Without them the process exits
  during bootstrap.
- **A relative store path resolves against the process's CWD**, not `-app-dir` — the first
  smoke run dropped a 25 MB `config.db` into the repo root. Both paths are absolute now.
- **`governance.virtual_keys` requires the config store**, so the recommended file-only mode
  (`config_store.enabled: false`) and the local session key are mutually exclusive. The store
  is on; the generated file stays authoritative because the sidecar updates the store from it
  on every boot.
- **The store encrypts what it persists**, so a fresh encryption key per start makes the
  *second* start die on decrypt. The key is generated once and kept beside the provider keys
  (`loadOrCreateEncryptionKey`).

Also learned: an `env.` reference is honoured for key values only. A custom endpoint's base URL
is written literally — it is a URL, not a credential.

## Risks

- **Reversal of the vendor guidance on log storage.** The vendor cheat sheet recommends
  disabling the sidecar's log store for desktop use; enabling it for cost accounting adds a
  SQLite database under the app's runtime dir. Content logging stays off, so prompts and code
  are never written, but disk growth and retention now need an owner.
- **Two mechanisms with overlapping meaning survive, but only for now.** Direct Claude API
  profiles stay alongside the catalog for the "one key, no processes" case (Bedrock via AWS
  credentials, a corporate proxy). This is explicitly a temporary state: once the catalog proves
  itself in real use, the direct profile gets removed and its users rewritten, in its own change
  and its own record. Until then AGENTS.md § No deprecation is satisfied only by the claim that
  these are different things — a claim that expires the moment the catalog can also serve the
  no-process case.
- **OpenRouter tool-call streaming with Claude Code is documented as broken** (empty tool
  arguments, then failing file edits). Nobody on this side has reproduced it: the claim comes
  from the vendor's own documentation as of 2026-08-14, and the mechanism below is a
  reconstruction from the symptom, not a read of the failing code. Streamed tool arguments
  arrive in fragments that the translation layer must reassemble; on this path they reportedly
  arrive empty, so the tool name survives and the arguments do not, and every file edit fails
  while plain text answers keep working. It is allowed and warned about in the form rather than
  blocked. Verification is deliberately deferred to implementation, when real keys are at hand —
  which means the user's headline scenario (Claude Code, Sonnet slot, DeepSeek via OpenRouter)
  may turn out to be unusable and will look like a dev3 bug when it does.
- **Live tool-loop verification is manual.** Automated coverage stops at pure functions
  (config generation, port selection, preflight, command assembly); real agent runs against real
  keys are the user's own pass. A green suite here genuinely does not mean the integration works.
- **A pinned bundled binary makes upgrading it a dev3 release**, and grows every platform build
  by **113 MB** — the measured size of `bifrost-http` v1.6.10 for darwin/arm64. That is the
  largest single thing dev3 ships; if it proves unacceptable, the alternatives are a separate
  optional download (which the update-channel rules make risky) or a smaller gateway.
- **Both SQLite stores live under `~/.dev3.0/model-catalog-runtime/`** and grow with use. Only
  the log store is wanted; the config store exists because governance demands it. Nothing
  prunes either yet.

## Follow-up: the endpoint is remembered, not fresh per start

The first implementation picked a fresh ephemeral port and a fresh session key on every start,
described as a per-run secret. That is wrong for a sidecar other processes talk to: an agent's
`ANTHROPIC_BASE_URL` and token are baked into its launch environment, so restarting the app —
or merely saving the catalog, which restarts the proxy — stranded every running agent on a dead
port (`ConnectionRefused`, then Claude Code retrying a permanent failure ten times). Both values
are now written to `endpoint.json` (0600) in the runtime dir and reused on the next start;
the port only when it is still bindable, so a squatter costs a new address instead of a failed
start. The key gains no new exposure — it already lives in every agent's process environment and
in the sidecar's own config store.

## Follow-up: the proxy is infrastructure, not a machine the user operates

Hands-on use turned up a second framing error. The proxy started lazily, on a port chosen fresh
each time, and the catalog screen offered a `Start proxy` button — so the user was operating a
process to configure a setting. It is now brought up ~1.5s after boot whenever the catalog has a
provider (`autostartModelSidecar`, called from `index.ts`), on one fixed port
(`DEFAULT_SIDECAR_PORT = 32123`, below every platform's ephemeral floor so the OS never hands it
out behind our back), falling back to the last run's port and then to any free one. The button
stays, for the one case it is honest about: restarting after a failure.

The same pass fixed the order of the work. `buildSidecarConfig` used to omit a provider that had
no models, which made "add a provider, then ask it what it offers" impossible — the only way to
learn a provider's model ids was through the proxy, and the proxy did not know the provider
existed until a model was already named. A provider is now declared as soon as it exists;
verified against the live `bifrost-http` 1.6.10 that a provider with no aliases starts fine and
still answers `/v1/models`, and that a provider with no key logs a warning instead of killing the
process. On screen the proxy panel moved between the two tables, matching the real order:
providers → ask them what they offer → name what you want.

## Alternatives considered

- **Extend the provider registry with a "bifrost" provider.** Rejected: the registry is shaped
  as one backend plus a family-mapping function; per-role mixes and credentials do not fit.
- **Extend Claude API profiles.** Rejected: it ties the mix to the account switcher, whose
  semantics are billing identity and "exactly one active", which a routing choice is not.
- **Let the sidecar own its own state (its config database and web UI).** Rejected: dev3 would
  not know which models exist and could not render a meaningful picker or preflight.
- **Express the mix as cross-provider routing rules inside the sidecar.** Rejected: aliases hang
  off a single provider key, so cross-provider indirection needs routing features that are not
  verified; naming each entry per provider avoids the need entirely.
- **Bind roles globally instead of per preset.** Rejected: two tasks could not run different
  mixes at the same time, which is the normal case in a multi-task board.
- **Auto-generate one preset per catalog model.** Rejected: that is always "one model for
  everything", which is exactly not a mix, and it floods the picker.
