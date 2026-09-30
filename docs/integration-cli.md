# Local integration CLI, protocol 1

`dev3 integration` connects to the existing local CLI transport. It creates no listener,
sends no telemetry, and does not install or update the desktop application. Both the CLI
and the running application must support this protocol. Start with
`dev3 --instance primary integration capabilities`; an unknown command or method means
the installed build needs updating. Do not silently fall back to a different instance.

Successful commands print one JSON object on stdout. Errors use the existing CLI error
exit codes and stderr. Supply JSON via stdin using a subprocess argument array, never
by interpolating a prompt into a shell command. `--instance` can pin another instance.

| Command | Input | Output |
| --- | --- | --- |
| `dev3 integration capabilities` | None | `protocolVersion`, supported `commands`, idempotency and retention guarantees |
| `dev3 integration projects` | None | `{projects:[{id,name,path,kind}]}` |
| `dev3 integration agents` | None | `{agents:[{id,name,defaultConfigId,configurations:[{id,name,model}]}]}` |
| `dev3 integration create --json -` | `{projectId,title,description,idempotencyKey}` | `{task,replayed,operationState:"created"}` |
| `dev3 integration launch --json -` | `{projectId,taskId,agentId,configId,idempotencyKey,confirmed:true}` | `{task,replayed,operationState:"dispatched"\|"uncertain"}` |
| `dev3 integration show --json -` | `{projectId,taskId}` | `{task}` |
| `dev3 integration events --json -` | `{projectId?,cursor?,limit?}` | Existing `EventSelection`: `events`, `cursor`, `droppedNewer`, `olderThanWindow`, `matched`, `from`, `movementsEvicted` |

Use full project and task IDs. The picker metadata excludes shell commands, environment
variables, provider configuration, and credentials. Protocol 1 uses the selected preset
with the existing default account resolution; it does not offer account selection.
`confirmed:true` is the caller's assertion that a person approved the selected task,
agent, and preset. It is not an authentication credential. Only trusted local clients
should use this transport; a web-facing bridge must authenticate its own users and
protect confirmation endpoints against CSRF.

Creation always saves a normal To Do task without a worktree or agent. It uses a durable
receipt under `~/.dev3.0/integration-v1/` and reserves the task UUID before creation.
Repeating the same project/key/content returns the same task, including after a lost
response or process restart. A reused key with different content is rejected. A task
deleted after successful creation is not recreated by replaying its receipt.

Launch is limited to an unstarted, non-draft To Do task. Use a separate stable launch
key and retain the entire request. The launch intent is recorded before invoking the
existing lifecycle and chosen-agent launch implementation. A duplicate returns current
task state without executing again. A different key cannot launch that task again
through this API. If the process stops or throws after recording intent, a replay returns
`uncertain`; inspect the task in dev3 instead of issuing another automatic launch.
This intentionally favors avoiding duplicate execution over automatic crash recovery.

`dispatched` means preparation was requested; it does not prove a worktree or agent is
running. Read back `preparing`, `preparationError`, and `runtimeState`. A persisted runtime
state is a recovery hint, and a Kanban column is not proof of successful execution.

The task projection contains `id`, `projectId`, `seq`, `title`, `description`, `status`,
`runtimeState`, `preparing`, `preparationError`, `blocked`, `hibernated`, `draft`, `agentId`,
`configId`, `prUrl`, `prStatusCache`, `overview`, `notes`, `createdAt`, and `updatedAt`.
Agent notes and PR caches are evidence with their own freshness limits, not assertions
that checks passed or work merged. Persist results in the calling application before a
worktree is cleaned up. This API never completes, cancels, merges, or sends Slack messages.

Events include notes and board movements, not every runtime update. Pass the returned
UTC cursor back verbatim, continue while `droppedNewer > 0`, deduplicate by event ID, and persist events
locally. Without a cursor the default window is 24 hours. There are at most 50 retained
notes and 50 movements per task; inspect reported omissions and reconcile linked tasks
after gaps. `show` is the result snapshot; this protocol does not parse terminal text or
invent a universal agent-success event.
