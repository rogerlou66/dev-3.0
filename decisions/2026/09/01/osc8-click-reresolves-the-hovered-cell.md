# OSC 8 activation re-resolves the cell under the cursor

## Context

Making OSC 8 `file://` hyperlinks clickable turned a wrong-link click from "opens
the wrong URL in a browser" into "opens the wrong file off the disk", and it made
the hover tooltip load-bearing: OSC 8 lets the visible label differ from the
target, so the tooltip is the only thing on screen that names where a click will
go. That only holds if the click and the tooltip agree.

## Investigation

They did not. In the running app, with four `file://` links on screen, hovering
the first one and then clicking the fourth opened the first one's file — and
reversing the hover order reversed the outcome. Reproduced identically with three
`https` links, so it predates the file-URI work.

The mechanism is in `ghostty-web`'s `LinkDetector` (`dist/ghostty-web.js`,
`cacheLink` / `getLinkAt`): it caches a link under the key `h<hyperlinkId>` when
the range's first cell carries a hyperlink id, and it answers a hit-test from
that cache **before** it scans the clicked row. ghostty assigns the same
hyperlink id to every OSC 8 link on screen — including when the emitter sends
distinct `id=` parameters — so one cache entry serves every link, and the first
row scanned after a write owns all of them until the next write clears the cache.
dev3's own provider is not involved: it resolves each row correctly, which is
exactly why the tooltip and the click disagreed.

## Decision

`ILink.activate` no longer trusts the URI its closure captured. It asks
`cellFromEvent` for the cell under the pointer and re-resolves the link there
(`createOsc8LinkProvider` in `src/mainview/terminal-osc8-links.ts`), falling back
to its own URI when the pointer is off the grid. The cell math is shared with the
hover tooltip through `cellFromMouseEvent` (`src/mainview/terminal-cell-hit.ts`)
so the two surfaces cannot drift apart again. Activation itself moved into
`activateOsc8Uri` (`src/mainview/terminal-path-open.ts`) so the branch is
testable without a terminal.

## Risks

The fallback keeps the stale URI when `cellFromEvent` returns nothing, so a click
whose coordinates do not land on the grid still behaves as before. The
re-resolution costs one row scan per click, which is what a hover already does on
every frame. If a future ghostty-web assigns real per-link ids, this becomes
redundant but stays correct.

## Alternatives considered

Patching the upstream cache key was rejected as it means carrying a fork of
`ghostty-web` for a defect we can neutralise in three lines on our side. Not
registering the provider's ranges at all (handling clicks on the canvas
ourselves) would duplicate ghostty's hit-testing and lose its hover underline.
