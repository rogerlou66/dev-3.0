# Repo-relative markdown URLs survive sanitization as nonce tokens

## Context

Markdown in this app names files in the checkout: `[guide](docs/guide.md)`, `![board](shots/board.png)`. The webview has no base URL pointing at the checkout, and Streamdown's `rehype-harden` pass drops any URL it cannot parse — a bare relative path parses only when a `defaultOrigin` is set, which would rewrite it into an absolute URL. So a relative path cannot reach our component overrides as itself, and the overrides are where dev3 resolves it (external-link behavior, or a `readFilePreview` disk read).

## Investigation

The first implementation swapped the path for `https://dev3.invalid/__markdown_link__/<encoded>` and unwrapped that prefix in the `a`/`img` overrides. A comment author can type the prefix, so `[x](https://dev3.invalid/__markdown_link__/<encoded>)` put an arbitrary URL into `href` after hardening had already run — `data:`, `vbscript:`, `file:`, `views://` all landed verbatim, and the image variant drove a disk read from a third-party comment (reported by @h0x91b on h0x91b/dev-3.0#1343). `javascript:` was stopped only by React.

A per-render registry of issued URLs was tried first and does not work: Streamdown reuses its unified processor across component instances, so the remark plugin captured by the first mount keeps running for later ones, and a second registry never sees the tokens.

## Decision

`src/mainview/components/pr-review/markdown-urls.ts` owns the whole mechanism. The token prefix carries a nonce drawn once per session from `crypto.getRandomValues`, so only URLs this module protected can be unwrapped. `protect` accepts nothing but a scheme-less relative URL and `unprotect` re-checks that after decoding, which makes "a token can only ever yield a path, never a scheme" an invariant of the module rather than a property of the call sites. `safeLinkHref` then restates the sanitizer's scheme allowlist at the point the `a` override writes `href`, because that value is one `rehype-sanitize` never inspected.

## Risks

The nonce lives for the session, so it is not a defense against code running inside the renderer — only against authored markdown, which is the actual threat. `crypto.getRandomValues` is used rather than `randomUUID` because the latter needs a secure context and the desktop shell serves from a custom `views://` scheme.

## Alternatives considered

`urlTransform` is the natural extension point but runs after `rehype-harden` has already replaced the blocked link node, so it cannot restore anything. Replacing Streamdown's default `harden` entry with our own configuration would mean importing `rehype-harden` (a transitive dependency) and pinning ourselves to their plugin list. Setting `defaultOrigin` would make relative paths parse, at the cost of rewriting every one of them into an absolute URL.
