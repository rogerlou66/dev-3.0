# Remove PR origin-task links

## Context
PR creation appended local task identifiers and a public redirect URL to descriptions. The user requested removal of this feature.

## Decision
`src/cli/commands/pr.ts` sends only the supplied description to GitHub. Remove the settings control, capability RPC, link builders, agent instructions, and `docs/open.html`; retain local `dev3://` navigation used by task opening.

## Risks
Previously published redirect links stop resolving when the website deploys this removal. Preserve the retired `prOriginTaskLink` opt-out in settings normalization for N-2 readers; this version never uses it to generate a link.

## Alternatives considered
Disabling the default would leave the feature and public endpoint available. Removing local URL navigation would also affect unrelated task, project, space, and new-task navigation, so it stays separate from PR publishing.
