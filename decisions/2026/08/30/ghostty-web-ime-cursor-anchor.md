# Anchor ghostty-web IME input to the terminal cursor

## Context

ghostty-web 0.4.0 focuses a contenteditable terminal container while its hidden textarea stays at `(0,0)`. WKWebView anchors CJK composition UI to that DOM input position, so pre-edit text appears in the terminal's top-left corner instead of beside the cursor.

## Investigation

The behavior matches [coder/ghostty-web#97](https://github.com/coder/ghostty-web/issues/97). The upstream fix in [coder/ghostty-web#169](https://github.com/coder/ghostty-web/pull/169) moves the textarea to `cursor column × character width, cursor row × character height`, makes it the sole focus target, and queues a punctuation or space key that terminates composition until `compositionend` delivers the composed text.

## Decision

`TerminalView` applies the focused compatibility fix locally: remove ghostty's `contenteditable`, redirect container and terminal focus to the textarea, synchronize its one-pixel anchor after every successful render, and replay a single-character composition terminator after `compositionend`. The workaround stays outside `node_modules` so installs remain reproducible while the upstream PR is unmerged.

## Risks

Moving from a canvas-sized textarea to a one-pixel input could reintroduce focus scrolling if the anchor leaves the visible grid; cursor and font metrics are clamped or rejected before style updates, and the terminal wrapper clips overflow. Mobile raw input keeps its 16px font and existing focus gating.

## Alternatives considered

Depending on the contributor fork would import dozens of unrelated changes from an unmerged PR. Patching minified dependency output was rejected as brittle, while waiting for an upstream release leaves desktop CJK input visibly broken.
