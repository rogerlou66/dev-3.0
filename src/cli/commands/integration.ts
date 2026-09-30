import type { ParsedArgs } from "../args";
import { rejectUnknownFlags } from "../flag-validation";
import { exitError, exitUsage } from "../output";
import { sendRequest } from "../socket-client";
import { readStdin } from "../stdin";

const COMMANDS = ["capabilities", "projects", "agents", "create", "launch", "show", "events"];

export async function handleIntegration(subcommand: string | undefined, args: ParsedArgs, socketPath: string): Promise<void> {
	rejectUnknownFlags(args, ["json"]);
	if (!subcommand || !COMMANDS.includes(subcommand) || args.positional.length) {
		exitUsage("Usage: dev3 integration <capabilities|projects|agents|create|launch|show|events> [--json -]");
	}
	const needsInput = ["create", "launch", "show", "events"].includes(subcommand);
	if (needsInput && args.flags.json !== "-") exitUsage("Pass --json - and provide one JSON object on stdin");
	if (!needsInput && args.flags.json !== undefined) exitUsage("This command takes no input");
	let params: Record<string, unknown> = {};
	if (needsInput) {
		const raw = await readStdin();
		if (raw.length > 110_000) exitUsage("Integration JSON input exceeds 110000 characters");
		try {
			const value: unknown = JSON.parse(raw);
			if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
			params = value as Record<string, unknown>;
		} catch { exitUsage("Integration input must be one valid JSON object"); }
	}
	const response = await sendRequest(socketPath, `integration.${subcommand}`, params);
	if (!response.ok) exitError(response.error || "Integration request failed");
	process.stdout.write(JSON.stringify(response.data) + "\n");
}
