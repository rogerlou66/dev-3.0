# Model catalog and model roles: a dev3-managed proxy sidecar for any provider

Status: design agreed in a grilling session, not yet implemented. The code change that
implements it ships with this record's follow-ups, not with the record itself.

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
  and then builds named **catalog models** ("fast gremlin" → OpenRouter `deepseek-flash").
  Each entry belongs to exactly one provider, so it maps one-to-one onto a static alias on that
  provider's key in the sidecar's config. dev3 generates the config skeleton (loopback bind,
  isolated app dir, file-only config store, per-run local session key, secrets only as `env.*`
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
- **A pinned bundled binary makes upgrading it a dev3 release**, and grows every platform build.

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
