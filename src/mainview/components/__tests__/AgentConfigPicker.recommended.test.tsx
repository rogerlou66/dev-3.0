import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENTS, type ModelCatalogView } from "../../../shared/types";
import { I18nProvider } from "../../i18n";
import AgentConfigPicker from "../AgentConfigPicker";

const modelCatalogGet = vi.fn<() => Promise<ModelCatalogView>>();
const modelCatalogSave = vi.fn();
const getAgents = vi.fn();
const saveAgents = vi.fn();

vi.mock("../../rpc", () => ({
	api: {
		request: {
			modelCatalogGet: (...args: []) => modelCatalogGet(...args),
			modelCatalogSave: (...args: unknown[]) => modelCatalogSave(...args),
			getAgents: (...args: unknown[]) => getAgents(...args),
			saveAgents: (...args: unknown[]) => saveAgents(...args),
			// The account pill under the picker renders nothing without it, which is
			// exactly what this file wants.
			listAgentAccounts: () => Promise.reject(new Error("not under test")),
		},
	},
}));

const claude = DEFAULT_AGENTS.find((a) => a.id === "builtin-claude")!;
const gemini = DEFAULT_AGENTS.find((a) => a.baseCommand.endsWith("gemini"))!;

function setup(agent = claude) {
	const onChange = vi.fn();
	render(
		<I18nProvider>
			<AgentConfigPicker
				idPrefix="test"
				agents={[agent]}
				agentId={agent.id}
				configId={agent.defaultConfigId ?? agent.configurations[0].id}
				onChange={onChange}
			/>
		</I18nProvider>,
	);
	return { onChange };
}

describe("AgentConfigPicker — models the user has not connected", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		modelCatalogGet.mockResolvedValue({ providers: [], models: [] });
	});

	it("offers them as locked rows, with what they cost and what they replace", async () => {
		const user = userEvent.setup();
		setup();
		await waitFor(() => expect(modelCatalogGet).toHaveBeenCalled());

		await user.click(screen.getByLabelText("Model"));
		const offered = await screen.findByText("DeepSeek V4 Pro");
		expect(offered.closest("button")).toHaveAttribute("aria-disabled", "true");
		// The number is the whole argument. A row that says only "DeepSeek" asks
		// the user to go and look the price up somewhere else.
		expect(screen.getByText("$0.87/M vs Opus 5")).toBeTruthy();
	});

	it("goes quiet once the user has a provider of their own — any provider", async () => {
		const user = userEvent.setup();
		modelCatalogGet.mockResolvedValue({
			providers: [{ id: "p1", kind: "custom", label: "My box", hasKey: false }],
			models: [],
		});
		setup();
		await waitFor(() => expect(modelCatalogGet).toHaveBeenCalled());

		await user.click(screen.getByLabelText("Model"));
		expect(screen.queryByText("DeepSeek V4 Pro")).toBeNull();
		// The action never depends on the advertising.
		expect(screen.getByText("+ Connect a provider…")).toBeTruthy();
	});

	it("says nothing to an agent dev3 cannot route through the proxy", async () => {
		const user = userEvent.setup();
		setup(gemini);
		await waitFor(() => expect(modelCatalogGet).toHaveBeenCalled());

		await user.click(screen.getByLabelText("Model"));
		expect(screen.queryByText("DeepSeek V4 Pro")).toBeNull();
	});

	it("opens the connect flow from the always-present row, and from a locked one", async () => {
		const user = userEvent.setup();
		const { onChange } = setup();
		await waitFor(() => expect(modelCatalogGet).toHaveBeenCalled());

		await user.click(screen.getByLabelText("Model"));
		await user.click(screen.getByText("+ Connect a provider…"));
		expect(await screen.findByTestId("connect-provider-modal")).toBeTruthy();
		// It is an action, not a model: the launch selection must not move.
		expect(onChange).not.toHaveBeenCalled();
	});

	it("starts the connect flow when a locked model is clicked, instead of dying quietly", async () => {
		const user = userEvent.setup();
		setup();
		await waitFor(() => expect(modelCatalogGet).toHaveBeenCalled());

		await user.click(screen.getByLabelText("Model"));
		await user.click(screen.getByText("Qwen3.8 2.4T"));
		expect(await screen.findByTestId("connect-provider-modal")).toBeTruthy();
	});
});
