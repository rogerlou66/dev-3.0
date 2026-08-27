# Workspace Board focused task overlay

## Context

Opening a task from Dashboard Board navigated to a project or task route, replacing the cross-project board the user was scanning. The requested workflow needs the full coding workspace while preserving the board's search, scroll, carousel, and disclosure state.

## Investigation

`TaskWorkspaceView` already composes the full inspector and terminal workspace, while `WorkspaceBoard` owns a separate cross-project task cache. A normal focus trap cannot wrap a terminal because capture-phase Tab and Escape handling would steal keys from the TUI.

## Decision

`WorkspaceTaskOverlay` is one ephemeral App-owned modal layer over the still-mounted Dashboard Board, initialized from the board cache and refreshed through the existing task RPC. Its focus scope contains ordinary controls but passes Tab and Escape through while `[data-terminal="true"]` owns focus; explicit full-page navigation remains available.

## Risks

The overlay introduces a second presentation of the task workspace and must keep menu context, shared outputs, lifecycle updates, dirty-review guards, and immersive fullscreen aligned. Focus and Back-layer tests protect the terminal-specific exceptions.

## Alternatives considered

Route navigation lost board context, a drawer constrained both board and terminal, and a popover was too shallow for a long-lived coding surface. A non-modal or draggable window was rejected because it would allow simultaneous board mutation or create a new window-management model while the terminal is active.
