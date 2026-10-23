Short: Antigravity resumes the exact conversation

Antigravity (`agy`) tasks now receive the dev3 protocol and the task's recent notes when a session starts, and dev3 records the conversation id so a recovered task resumes that exact conversation instead of the most recent one. Subagents no longer move the task to review mid-turn or hijack the recorded conversation. The adapter also adds an "Auto" preset (`--mode auto`), passes the `xhigh` effort level through, flags models the signed-in account cannot use via `agy models`, and installs the coordinator and artifact skills for Antigravity.
