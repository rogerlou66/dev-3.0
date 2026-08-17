# Pin safe transitive dependencies

## Context

The dependency audit reported Critical and High advisories in both direct packages and compatible transitive versions selected by the lockfile. Updating only the top-level packages left vulnerable copies under Electrobun, Lobe UI, PostCSS, and Vitest.

## Investigation

Each vulnerable transitive package had a patched version compatible with its parent's declared range. Adding those packages as direct dependencies did not deduplicate the old copies and incorrectly implied that the app imported them.

## Decision

Upgrade the affected direct dependencies and use package overrides for the compatible patched transitive versions in `package.json`. Keep the lockfile committed so clean clones resolve the same audited dependency graph.

## Risks

Overrides can reveal an undocumented compatibility assumption in an upstream package. The full test suite, type check, and packaged build must pass whenever these pins change.

## Alternatives considered

Leaving the findings until every upstream package refreshes its lock choices keeps known vulnerabilities in company builds. Declaring every transitive package as a direct dependency produces the same runtime graph with a misleading application manifest.
