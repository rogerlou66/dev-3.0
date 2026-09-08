# GitHub Copilot CLI

dev3 supports the standalone `copilot` CLI. Install a current stable release and authenticate before starting a task:

```sh
brew install --cask copilot-cli
copilot --version
copilot login
```

For other platforms, follow the [official installation instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli). The in-app installation hint uses `npm install -g @github/copilot`, which requires Node.js 22 or later. The initial integration was checked against CLI 1.0.83.

## Launching tasks

After rebuilding and starting dev3, choose **GitHub Copilot** in the existing task launcher. Its default preset is **Bypass**; **Default** retains Copilot permission prompts and **Plan** starts its planning mode. Selecting Copilot does not change the application's global default agent. Models default to Copilot's own selection; a preset can specify a model and supported reasoning effort. Unsupported permission modes and dollar-budget controls produce a configuration error.

The task description is submitted through interactive mode, so the terminal remains available for follow-up prompts. Each task gets its own session UUID. Resume uses that task's saved ID; a missing ID reports an error instead of selecting another task's recent conversation.

## Instructions and lifecycle

Copilot discovers dev3's shared skills in `~/.agents/skills`. A generated instruction source under the active dev3 home's `data/agent-prompts/copilot/` carries the task protocol; its directory is appended to the effective `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` only for the launched process. Project and preset environment precedence is preserved.

Generated `.github/hooks/dev3.json` hooks send prompt-submission and normal primary-agent-stop events to dev3. They retain existing user hooks. Claude hooks belonging to dev3 are marked so Copilot's cross-tool discovery does not run both sets. User hooks and enterprise policy still apply. See [the isolation decision](../../decisions/2026/09/08/copilot-lifecycle-hook-isolation.md).

## Manual acceptance checks

1. Start a task with **GitHub Copilot → Bypass**. Confirm its description reaches Copilot and a follow-up prompt can be entered after the response.
2. Start another task with a different description. Restart the terminals and use **Resume Session**; each must return to its own conversation.
3. Select **Default**, then **Plan**, in separate launches. Confirm the native permission and planning behavior matches the selected preset.
4. Submit a prompt and finish a normal turn. Confirm the board enters execution and then the configured review stage. Exiting or aborting must not mark the task completed.
5. Enter `/env` in Copilot and inspect its instruction and skill sources. Confirm dev3 is loaded alongside existing user customizations.
6. Repeat the launch and resume checks in a dev3 remote browser terminal. Check the rendered launcher, terminal input, and browser console.
7. Configure an unsupported permission mode or dollar budget in a custom Copilot preset. Confirm a configuration error appears rather than silently ignoring the setting.

Real model requests require a successful GitHub login and account access. Unit tests and CLI help checks alone do not establish authenticated conversation, browser, or Windows runtime correctness.
