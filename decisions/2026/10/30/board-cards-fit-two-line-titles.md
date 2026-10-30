# Board cards fit two-line titles

## Context

The compact board card (`TaskCard` with `compact`, used by `KanbanColumn` and `WorkspaceBoard`) was fixed at 52px with a single truncated title line, a choice kept through the v1.51.3 merge. Long titles, especially CJK ones, lost almost all of their meaning, and the user asked for cards tall enough for two title lines.

## Decision

The card is `h-16` (64px) and the title uses `line-clamp-2 break-words`. The height stays fixed so columns keep a uniform rhythm; single-line titles simply centre in the extra space. The title row aligns `items-start`, so the state badge, hover actions and priority pill sit on the first title line instead of floating between two. Measured in the browser: a two-line title (33px) plus the meta row (12.6px) fits with about 6px to spare, the same headroom the meta row had at 52px.

## Risks

Each card is 12px taller, so a column shows fewer cards before scrolling. The hidden hover actions still reserve their width, so a card carrying a state badge (DISCONNECTED, DRAFT) can still squeeze its title very narrow; that predates this change.

## Alternatives considered

A `min-h` card that grows with its title was rejected: mixed heights break the board's scan line. Keeping one line and relying on the hover summary was the status quo the user asked to change.
