# Streamdown owns Markdown and Mermaid rendering

## Context

Markdown previews and PR comments used a custom `marked` plus `sanitize-html` pipeline. Adding Mermaid to that HTML-string pipeline would also require custom lifecycle, loading, error, and theme handling.

## Investigation

Streamdown 2.5 provides GFM and raw HTML parsing, hardened sanitization, React component overrides, and an official `@streamdown/mermaid` plugin. Its sanitizer behaves consistently under the app's happy-dom tests, while source-backed React rendering also removes the old HTML rewriting used for repo-relative images.

## Decision

Use Streamdown for all shared Markdown rendering and its official Mermaid plugin with Mermaid 11.16.0. Dev3 continues to own external-link behavior, repo-relative URL handling (see [relative-markdown-urls-are-nonce-tokens](../17/relative-markdown-urls-are-nonce-tokens.md)), theme token mapping, and rich-diff chunking; wide sequence diagrams retain readable SVG dimensions and scroll horizontally instead of shrinking, while `marked` remains only for splitting Markdown diffs into source blocks.

Mermaid is pinned through `overrides` as well as `dependencies`, because Streamdown and `@streamdown/mermaid` both depend on `mermaid` by range: without the override the tree carries a second copy, and an internal npm mirror that lacks that exact version fails `bun install` outright. `cytoscape` is pinned for the same reason. The override also keeps one Mermaid in the bundle instead of two.

## Risks

The renderer adds bundle weight, and both `tailwind.config.js` (scanning `node_modules/streamdown/dist`) and `TaskDiffViewer.css` (`[data-streamdown="…"]` selectors) are deliberately coupled to Streamdown's distributed output — a minor bump can shift layout with no test catching it, which is why the version is pinned exactly.

Every test mocks `@streamdown/mermaid`, so no test exercises Mermaid's own label sanitization: real `mermaid.render` returns an empty SVG under happy-dom, which has no SVG layout. Diagram-label safety rests on Mermaid's DOMPurify pass under `securityLevel: "strict"`, checked in a browser instead: a label holding `<img onerror>`, `<script>` and a `javascript:` anchor renders with the handler, the script and the href gone and nothing executed. A bare `<img src>` tag does survive as an inert element, which is the exposure a plain markdown image already carries here. Our own sanitization and the invalid-diagram fallback are pinned by component tests.

## Alternatives considered

A custom Mermaid hook would duplicate rendering and visibility lifecycle already maintained by Streamdown. Keeping HTML strings and post-processing them would preserve two rendering models and make image and diagram behavior harder to test.
