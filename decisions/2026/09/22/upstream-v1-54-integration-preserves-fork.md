# Integrate upstream v1.54 while preserving fork workflows

## Context

The fork's `rl-main` diverged from upstream v1.53.0 and also lacked two personal-remote commits removing external task deep links. The user requested both remote changes and upstream through `7f9545b4`, explicitly selecting upstream's Copilot implementation and retaining other fork features.

## Investigation

An isolated merge exposed overlapping agent registration, launch hooks, settings, task navigation, terminal, and review surfaces. Git also merged some obsolete Copilot registrations without a textual conflict; these require semantic cleanup rather than accepting the generated tree unchanged.

## Decision

Merge the personal remote first, then upstream, retaining merge ancestry. Replace the fork's Copilot adapter and instruction-directory injection with upstream lifecycle hooks and `sessionStart` context; retain Antigravity and all non-Copilot fork behaviors. Review hosts in `App.tsx` use the effective overlay task, and review submission only marks comments sent after confirmed message delivery.

`setTmuxTheme` owns appearance/theme fields and publishes persisted state before slow tmux updates; ordinary settings saves preserve those fields. Synchronize renderer settings mirrors when settings arrive, rather than replaying a delayed React effect over optimistic control visibility. Browser QA reproduced the stale-save race when switching cmux and Simplified Mode consecutively.

## Risks

An automatically merged file can still duplicate registrations or lose task identity. Regression tests must cover the fork's privacy/manual-update boundaries, Blocked holds, launch behavior, and overlay review context; browser verification is separately required for rendered behavior. Preserve pre-existing uncommitted work outside the merge commit and validate its restoration.

## Alternatives considered

A rebase would replay already merged fork history and was rejected in favor of explicit merge ancestry. Taking upstream files wholesale would discard fork behavior, while retaining both Copilot paths would duplicate hooks and contradict the requested single implementation.
