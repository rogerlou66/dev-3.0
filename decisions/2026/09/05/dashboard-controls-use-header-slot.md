# Dashboard controls share its main header

## Context

Board/Projects and one search field occupied a dedicated 48px row below the global header. The user wants that vertical space for tasks while preserving project and task titles.

## Decision

GlobalHeader exposes a Dashboard-only DOM slot beside its breadcrumbs. Dashboard renders DashboardHeaderControls into it through a React portal, retaining ownership of the view and search state; App wires the slot and disables search when the workspace overlay opens. On tight widths search becomes a magnifier with an inline header popover; closing it preserves the filter.

## Risks

The slot must disappear on other routes and remain within the header's inert boundary. Expanded search unregisters its Escape/Back handlers when disabled; outside pointer dismissal must not steal focus from a task. Container width, not tab content overflow, determines the input/icon switch.

## Alternatives considered

Lifting view and query state into App would change their lifetime beyond this layout request. Keeping a shorter second row still spends vertical space; moving controls onto project/task headers would compete with the titles the user explicitly wants preserved.
