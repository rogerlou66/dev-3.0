Short: Antigravity tasks move automatically

Tasks run with the Google Antigravity CLI (`agy`) now move between board columns on their own, the same way Claude Code and Codex already do. dev-3.0 registers the task's worktree as a trusted Antigravity workspace and installs worktree-local lifecycle hooks that move the task to in-progress when a turn starts and to review when it ends.
