// ---- Remote (headless `dev3 remote`) lifecycle ----

/**
 * On-disk record of a running `dev3 remote` headless server, written to
 * `~/.dev3.0/remote/state.json` by the server on startup and removed on
 * graceful shutdown. Lets a SEPARATE `dev3 remote status/stop/url` process
 * (e.g. a fresh SSH session) discover, query, and stop a backgrounded server
 * without scraping the banner. This is an ADDITIVE path — older app versions
 * never read it, so it does not touch the frozen `~/.dev3.0/` layout invariants.
 */
export interface RemoteServerState {
	/** PID of the headless `dev3-server` process (liveness-checked via signal 0). */
	pid: number;
	/** TCP port the remote-access HTTP/WS server bound to. */
	port: number;
	/** Unix CLI socket path this server is listening on (for `url`/`status`). */
	socketPath: string;
	/** Whether a Cloudflare tunnel was requested for this run. */
	tunnelRequested: boolean;
	/** Static access code if `--static-code` was used, else null. */
	staticCode: string | null;
	/** Log file the detached server's stdout/stderr was redirected to (null if foreground). */
	logFile: string | null;
	/** ISO timestamp of when the server started. */
	startedAt: string;
	/** dev3 build version that wrote this record. */
	version: string;
}

/**
 * Why the remote-access server is not serving. `port` is the port that was asked
 * for — 0 when none was pinned and the random pick itself failed.
 */
export interface RemoteAccessStartFailure {
	port: number;
	reason: "port-in-use" | "other";
	message: string;
}

/** Whether remote access is serving, and on what. `failure` is null while it is. */
export interface RemoteAccessStatus {
	running: boolean;
	port: number;
	failure: RemoteAccessStartFailure | null;
}

/**
 * One IPv4 address the headless server is reachable at, for the Remote Access
 * modal's interface picker. `internal: true` marks loopback (127.0.0.1).
 */
export interface RemoteNetInterface {
	/** Interface name (e.g. "en0", "utun3") or "loopback" for 127.0.0.1. */
	name: string;
	/** The IPv4 address. */
	address: string;
	/** True for loopback / same-machine addresses. */
	internal: boolean;
}

/**
 * Fresh access info for a running remote server, returned by the `remote.accessUrl`
 * CLI-socket method. The URL embeds a one-time QR token minted in the SERVER
 * process (where the JWT secret lives), so a detached `dev3 remote url` can print
 * a scannable URL it could never mint itself.
 */
export interface RemoteAccessInfo {
	/** Full access URL with a fresh one-time `?token=` — never the access code. */
	url: string;
	/** Public Cloudflare tunnel URL, or null if no tunnel is connected. */
	tunnelUrl: string | null;
	/** TCP port the server is bound to. */
	port: number;
	/** The permanent access code, if one is set, else null. */
	staticCode: string | null;
	/**
	 * Bookmarkable sign-in link: the access URL with the code in its FRAGMENT, so
	 * clicking the bookmark signs in with nothing typed. Null when no code is set.
	 */
	signInLink: string | null;
}
