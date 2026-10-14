# Collapsible touch terminal keys

## Context

The touch-only terminal shortcut bar always occupied a full row and used viewport-width sizing. On landscape tablets its 11vw button height consumed over 100 pixels while the composer remained visible below it.

## Decision

`ExtraKeyBar` defaults collapsed with a local disclosure that remains reachable. `useExtraKeysExpanded` stores the preference in localStorage, synchronizes mounted terminals and same-origin tabs, and falls back to memory when storage is unavailable. Keys use 44 visible CSS pixels with visual-viewport scale compensation; the composer and compose/raw mode remain independent.

## Risks

The initial viewport metadata can scale a phone's layout before the responsive hook updates it, so the bar observes viewport and window resize events. Collapsing stops held-key timers and clears sticky Ctrl; file inputs stay mounted so pending uploads retain their existing completion path. Browser origins and the Android WebView keep separate preferences.

## Alternatives considered

Removing the controls entirely would make Escape and raw keyboard mode hard to reach. Leaving them permanently visible at a smaller size would still spend terminal space by default. A server-side preference would change other devices and require unnecessary shared-state changes.
