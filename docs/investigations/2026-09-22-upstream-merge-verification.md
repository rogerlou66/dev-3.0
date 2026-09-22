# Upstream v1.54.1 integration verification

## Inputs and preservation

Integrated personal remote `4cc48604` and upstream `7f9545b4` onto local `8fedf831`, using merge ancestry. The original checkout stayed untouched during integration. Its 18 modified/untracked files were archived under `.git/merge-backups/20260922-upstream/` and each archived byte stream was verified against its original; the original tracked patch SHA-256 is `3956de18fd312e627fcd0345899919f8c82bb548c088d2c1a07770a14b61a9cf`.

## Automated evidence

- Frozen-lockfile dependency installation and `bun run lint` passed.
- Full suite: renderer 5,900 passed, backend 8,423 passed / 3 skipped, CLI 1,153 passed; total 15,476 passed across 919 files.
- `bun run build` passed, including packaged native host image verification.
- Real isolated tmux guarded-send and native graceful-teardown E2Es reported `ALL CHECKS PASSED`.
- Focused regressions cover overlay review/task context, unconfirmed review delivery, malformed Copilot configuration preservation, stale appearance settings saves, and explicit BiDi opt-out.
- Existing suites cover telemetry removal, manual desktop updates, data compatibility, Blocked lifecycle, Copilot/Antigravity hooks, named development servers, and fork appearance behavior.

Homebrew Node failed to load its llhttp library. Validation used the Codex-bundled Node on the command-local PATH; no system runtime was repaired or replaced.

## Browser evidence

The integration's built renderer and real headless backend ran with a separate QA data root, dedicated fixture project/tasks, and no public tunnel. Screenshots used streamer mode. The fixture task was hibernated so inspecting it did not launch an AI agent.

- Workspace Board rendered its Inbox, task overlay, and separate Blocked column; closing the overlay returned to the retained board.
- `show-artifact` persisted a real HTML artifact. The docked overlay viewer accepted an element comment, and `review list` independently read it from the correct task.
- `review resolve --reply` updated the comment in the browser with a resolved pin and reply; the same reply remained after reload and reopening the overlay.
- Consecutive cmux and Simplified Mode toggles matched disk readback and visible controls after fixing a reproduced stale-settings race. Restoring Default and Full interface restored the palette and advanced controls without reload.
- Browser error collection was empty during these checks.

Local screenshots and raw validation logs are retained in the task artifact directory `01a0c7e4-8007-7d50-acb0-6b9f7913f462` outside the repository. The server log and local test access code are private test-runtime artifacts and must not be published.

## Limits

No actual Copilot/Antigravity model session, Android physical device, or native macOS IME typing was exercised. Their automated regression coverage is not a claim of live-provider/device verification. The original uncommitted terminal-key-bar work remains separate from the merge commit.
