# Learned hostname stability for custom tunnels

## Context

The self-update handoff deliberately leaks a live `cloudflared` to its successor
(`RemoteHandoff`, see `self-update-handoff-and-quiet-window`) for exactly one reason: a
quick tunnel's hostname is random per process, so killing it would change the public URL
and invalidate the host-bound `dev3_session` cookie on the device the user is holding.
Bring-your-own-tunnel providers are not all like that — a `--name`-style suffix or an
ngrok reserved domain returns the same hostname every time. For those, the leak buys
nothing and costs something: an abandoned restart can orphan the process, and the
successor inherits a pid it cannot scrape output from or await.

## Investigation

Measured against a real third-party tunnel CLI: three separate processes with the same
`--name` produced the identical hostname, a different `--name` produced a different one,
and omitting the name produced a random suffix per process. So stability is a property of
the provider *and* how it is invoked — it cannot be read off the binary name, and dev3
must not assume either answer.

## Decision

Stability is **observed, not declared**. `src/bun/tunnel-host-memory.ts` remembers the
last `(command, url)` pair in `~/.dev3.0/remote/tunnel-hosts.json`; a command that
produces the same URL again is marked stable, and any different URL revokes the mark.
`startEntry` records the observation on every custom connect and logs
`hostname: "stable" | "unproven"`.

A stable provider then skips the leak entirely: `stopMainTunnelForStableHandoff()`
(`cloudflare-tunnel.ts`) stops the tunnel and `prepareHandoff` (`self-update.ts`) records
`stableTunnelUrl` instead of a pid. The successor spawns its own tunnel and compares the
new URL against that record in `headless-entry.ts`, saying plainly whether sessions
survived. An abandoned restart restarts the tunnel rather than re-adopting a process that
no longer exists. Adopted custom tunnels also gain the public-URL health probe, since they
have neither a metrics endpoint nor an exit promise.

Per-task port tunnels also run through the custom provider, but they do **not**
participate in the learning: the memory holds a single `(command, url)` pair, so
concurrent port tunnels producing different URLs would flip-flop the record and
destroy the main tunnel's proof; and the stability bit exists only for the main
tunnel's self-update handoff, which port tunnels never take part in. `startEntry`
records the observation only for `kind === "main"`. A fixed-hostname command that
lands two live tunnels on one URL is logged as a warning — dev3 cannot arbitrate
that collision, only name it.

## Risks

A provider that is stable for two runs and rotates on the third loses its sessions across
one update: the successor logs the mismatch and tells the operator to re-scan, rather than
pretending the URL held. Deleting the memory file only costs one restart of re-learning.
The stable path stops a working tunnel before the successor exists, so the abandoned-restart
recovery in `clearHandoff` is load-bearing, not a nicety.

## Alternatives considered

**A user setting ("my hostname is fixed").** Rejected: a wrong declaration makes dev3
publish a URL that does not route, which is the failure mode the readiness probe exists to
prevent. A wrong observation can only fall back to the conservative leak.

**Parsing the command for `--name`/`--domain` flags.** Rejected as provider-specific
guessing that breaks on the next tool.

**Always leak, as before.** Rejected: it forfeits the one case where respawning is
strictly safer, and leaves an orphan risk for providers that never needed the leak.
