Short: Clickable links for nested file paths

Terminal file links now resolve a file named without its directory — "architecture.md" for `docs/architecture.md` — by matching it as a unique path suffix in the task's git file index, so an agent listing several docs no longer underlines only the one that happens to sit at the repo root. Ambiguous names stay unlinked rather than opening a guessed file.
