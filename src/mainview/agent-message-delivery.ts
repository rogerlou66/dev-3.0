import type { AgentPromptDeliveryStatus } from "../shared/agent-prompt-delivery";

export interface AgentMessageResult {
	spilledPath: string | null;
	status: AgentPromptDeliveryStatus;
}

/** Only a confirmed host verdict may clear or mark user-authored text as sent. */
export function requireDeliveredAgentMessage(result: AgentMessageResult): AgentMessageResult {
	if (result.status !== "delivered") throw new Error(`Agent message delivery ${result.status}`);
	return result;
}
