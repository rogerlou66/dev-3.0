# Local integration dispatch receipts

## Context

External local assistants need to create a reviewed brief and launch the user's selected agent without parsing CLI tables. A lost create or launch response must not silently duplicate a task or execution.

## Investigation

The existing CLI request ID correlates responses but does not deduplicate mutations. Task creation uses a locked data path, while launch dispatches asynchronous preparation; neither a socket reply nor a board column proves agent success.

## Decision

`src/bun/integration.ts` adds protocol 1 over the existing local CLI transport, with allowlisted metadata and explicit confirmation for launch and context delivery. A new parallel `integration-v1` directory holds atomic receipts: creation reserves a UUID passed through `createTask` and deduplicated inside `data.addTask`'s existing lock; launch records intent before calling `launchTaskWithAgentChoice`, and context updates reuse `message.send` while preserving its delivery status. Neither automatically repeats an uncertain execution.

## Risks

A crash before dispatch can leave an unstarted task or unsent context requiring manual inspection; avoiding duplicate execution takes priority. Message receipts retain the original acceptance outcome, and a held queue lives in memory, so replay does not prove eventual delivery. Existing data paths and schemas remain readable by N-2 versions, which ignore the new receipt directory; there is no sunset or migration of existing paths. Receipts are retained, and this local protocol relies on a trusted caller to authenticate its user and attest confirmation.

## Alternatives considered

A receipt written only after creation leaves a crash window that creates duplicate tasks. Parsing human-readable CLI output or writing tasks.json outside the data layer loses lifecycle guarantees; exposing the full renderer RPC would unnecessarily expose credentials and unrelated operations.
