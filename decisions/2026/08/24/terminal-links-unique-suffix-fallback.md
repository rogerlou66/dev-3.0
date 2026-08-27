# Terminal file links: unique-suffix fallback for paths named without their directory

## Context

Agents name files the way prose does — "Docs updated: platform-status.md, architecture.md, components/scout-agent.md, TODO.md" — while the files live under `docs/`. Terminal links resolved a relative candidate only against the worktree root and then the project root, so in that sentence exactly one token underlined: `TODO.md`, the only file that happens to sit at the root. The feature looked broken precisely where agents mention files most.

## Investigation

Reproduced from the reporting screenshot: `docs/platform-status.md` and `docs/architecture.md` exist in the project, `TODO.md` is at the root, and only the root file resolved. The candidate regex in `src/mainview/terminal-file-links.ts` had matched every one of them — the loss happened in `resolveTerminalPaths`, whose `resolvePath(base, candidate)` can only find a file whose printed path is already base-relative.

## Decision

`resolveBySuffix` in `src/bun/rpc-handlers/terminal-paths.ts`: when every base has been tried as-is and failed, look the candidate up as a path **suffix** at a segment boundary in that base's file index, built from `git ls-files --cached --others --exclude-standard` and cached per base for 15s (so one listing serves a whole viewport of candidates). Only a **unique** match becomes a link — `dup.md` in two directories stays unlinked, because opening the wrong file is worse than not offering the link. Explicitly rooted candidates (`./x`, `../x`) and anything containing `..` are excluded: they state where they live. Direct resolution across all bases still runs first, so a file that exists where the output said it does can never lose to a suffix match elsewhere.

## Risks

A suffix match can be unique in a base yet point at a file the output did not mean (a mention of a sibling repo's `architecture.md` opening ours). Bounded by the segment-boundary rule and by the resolve staying inside the existing home-dir + project-root gate. Repos over 50k listed files drop the index entirely and keep the old behavior; git-less bases (`ls-files` fails) do too. The index is 15s stale, so a just-moved file can link to its old path for that window — same staleness class as the existing 10s resolve cache.

## Alternatives considered

Pick the shallowest match when several exist (rejected: silently opens a coin-flip file, and the shallowest is not the likeliest — `docs/` beats the root here). Walk the filesystem instead of asking git (rejected: `ls-files` already honours `.gitignore`, so `node_modules` never enters the index). Resolve against the pane's real cwd (rejected: dev3 does not track a per-pane cwd, and the mentions are relative to the repo, not to wherever the shell happens to sit).
