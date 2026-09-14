# Remove PR links and URL navigation

## Context
PR creation appended local task identifiers and a public redirect URL to descriptions. The user requested removal of PR links and all application URL deep links.

## Decision
`src/cli/commands/pr.ts` sends only the supplied description to GitHub. Remove the settings control, capability RPC, URL builders and resolvers, protocol registration, Copy Deep Link action, and `docs/open.html`. `src/bun/task-navigation.ts` and `openTaskNavigation` retain internal CLI task opening without accepting URLs.

## Risks
Previously published links stop opening tasks after this release; the redirect page disappears when the website deploys. Preserve the retired `prOriginTaskLink` opt-out in settings normalization for N-2 readers; this version never uses it to generate a link. CLI requests queued while no window exists must still be consumed once after the renderer mounts.

## Alternatives considered
Disabling the default would leave the feature and public endpoint available. Deleting the shared navigation event without replacing its CLI caller would break `dev3 task open`, so internal task navigation remains separate from the removed URL protocol.
