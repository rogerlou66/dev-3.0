# Classify late host ticks by the kernel's sleep/wake stamps

## Context
`renderer-watchdog.ts` and `display-watch.ts` both infer "the machine slept" from a timer tick that arrives several intervals late, because Electrobun has no sleep/wake event. A host starved while awake (heavy memory pressure, v1.60.0 field log of 2026-10-23) produces the same late ticks, so the log called them a "host suspend" and display-watch logged a false `{reason: wake}`.

## Investigation
On macOS `sysctl kern.sleeptime kern.waketime` print wall-clock `{ sec, usec }` stamps of the last sleep entry and the last wake. Checked against `pmset -g log` on a dev machine: `kern.waketime` equals the logged Wake to the second; `kern.sleeptime` lands ~2 s after the logged "Entering Sleep" and is refreshed by maintenance sleeps after dark wakes. Whether Bun's monotonic clocks include sleep on Darwin was not established, so they are not used.

## Decision
`src/bun/host-sleep-probe.ts` reads both stamps only on a late tick (rare) via `spawn`. Either stamp at or after the gap start (1 s slack) → `slept`; both before it → `starved`; no stamps or not macOS → `unknown`. The watchdog still rebases on every late tick and only names the cause in its log line. display-watch reports `wake` unless the cause is `starved` (`unknown` keeps today's behaviour).

## Risks
The stamps are undocumented sysctls; if Apple drops them the parser returns null and the answer degrades to `unknown`, never to a wrong `starved`. A sleep shorter than the slack that ends exactly at the gap start could be mislabelled; it affects only a log label.

## Alternatives considered
Comparing a clock that stops during sleep with wall time (unverified which clock Bun uses on Darwin); `pmset -g log` parsing (slow, large output); Linux `CLOCK_BOOTTIME` vs `CLOCK_MONOTONIC` via FFI — deferred, Linux and Windows label the cause `unknown`.
