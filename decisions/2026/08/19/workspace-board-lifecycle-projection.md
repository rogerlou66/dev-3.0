# Workspace board lifecycle projection

## Context

Eight persistent Kanban columns made routine project boards wider than the viewport, and switching projects was required to manage tasks across repositories. Questions, AI Review, and PR Review were especially expensive because they are often empty or represent attention rather than a durable daily-work location.

## Investigation

Agent hooks and CLI flows depend on the existing lifecycle statuses, so removing them from the data model would break automation. The active-only `getAllProjectTasks` RPC also could not serve a complete workspace board because it intentionally omits To Do and terminal tasks.

## Decision

`KanbanBoard` and `WorkspaceBoard` project `user-questions` into Agent is Working while `TaskCard` supplies an amber, text-labelled attention treatment. AI Review mounts only when occupied; PR Review remains visible for peer-reviewed git projects because an open PR is a durable external waiting stage. The workspace board omits Cancelled from its daily-work matrix while project boards retain it as reachable history. The workspace board uses project swimlanes backed by a separate all-status RPC, and cross-project drag is refused.

## Risks

The presentation column can differ from `Task.status`, so every card must retain its real lifecycle menu and accessible attention label. Project-specific custom columns are shown in one non-drop Custom cell because a shared drop target would be ambiguous.

## Alternatives considered

Removing lifecycle statuses was rejected because hooks and stored tasks use them. Mounting one full `KanbanBoard` per project was rejected because it duplicates filters, polling, headers, and horizontal scroll regions.
