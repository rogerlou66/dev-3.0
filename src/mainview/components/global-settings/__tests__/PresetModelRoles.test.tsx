import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfiguration, ModelCatalogView } from "../../../../shared/types";
import { I18nProvider, type TFunction } from "../../../i18n";
import PresetModelRoles from "../PresetModelRoles";

vi.mock("../../../rpc", () => ({
	api: { request: { modelCatalogGet: vi.fn() } },
}));

import { api } from "../../../rpc";

const t = ((key: string) => key) as unknown as TFunction;

const CATALOG: ModelCatalogView = {
	providers: [
		{ id: "p-or", kind: "openrouter", label: "OpenRouter", hasKey: true },
		{ id: "p-oai", kind: "openai", label: "OpenAI", hasKey: true },
	],
	models: [
		{ id: "m-fast", providerId: "p-or", name: "fast-gremlin", modelId: "deepseek/flash" },
		{ id: "m-main", providerId: "p-oai", name: "my-main", modelId: "gpt-5.6-sol" },
	],
};

function renderRoles(baseCommand: string, config: Partial<AgentConfiguration> = {}) {
	const onChange = vi.fn();
	render(
		<I18nProvider>
			<PresetModelRoles
				t={t}
				baseCommand={baseCommand}
				config={{ id: "c1", name: "Preset", ...config } as AgentConfiguration}
				onChange={onChange}
			/>
		</I18nProvider>,
	);
	return { onChange };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(api.request.modelCatalogGet).mockResolvedValue(CATALOG);
});

describe("when the block appears at all", () => {
	it("offers Claude Code its own alias slots", async () => {
		renderRoles("claude");
		expect(await screen.findByText("catalog.roleOpus")).toBeTruthy();
		expect(screen.getByText("catalog.roleHaiku")).toBeTruthy();
	});

	it("offers Codex the roles Codex has, and none it does not", async () => {
		renderRoles("codex");
		expect(await screen.findByText("catalog.roleMain")).toBeTruthy();
		expect(screen.queryByText("catalog.roleOpus")).toBeNull();
	});

	it("stays out of the way for an agent dev3 cannot route", async () => {
		const { container } = render(
			<I18nProvider>
				<PresetModelRoles t={t} baseCommand="gemini" config={{ id: "c", name: "n" } as AgentConfiguration} onChange={vi.fn()} />
			</I18nProvider>,
		);
		await waitFor(() => expect(api.request.modelCatalogGet).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});

	it("stays hidden while the catalog is empty, instead of showing a dead control", async () => {
		vi.mocked(api.request.modelCatalogGet).mockResolvedValue({ providers: [], models: [] });
		const { container } = render(
			<I18nProvider>
				<PresetModelRoles t={t} baseCommand="claude" config={{ id: "c", name: "n" } as AgentConfiguration} onChange={vi.fn()} />
			</I18nProvider>,
		);
		await waitFor(() => expect(api.request.modelCatalogGet).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});
});

describe("warnings the user must see before launching", () => {
	it("warns when an OpenRouter model serves a Claude Code role", async () => {
		renderRoles("claude", { modelRoles: { sonnet: "m-fast" } });
		expect(await screen.findByText("catalog.warnOpenRouterTitle")).toBeTruthy();
	});

	it("keeps quiet for a direct provider", async () => {
		renderRoles("claude", { modelRoles: { opus: "m-main" } });
		await screen.findByText("catalog.roleOpus");
		expect(screen.queryByText("catalog.warnOpenRouterTitle")).toBeNull();
	});

	it("names a role left pointing at a deleted model", async () => {
		renderRoles("claude", { modelRoles: { opus: "m-gone" } });
		expect(await screen.findByText("catalog.roleOrphan")).toBeTruthy();
	});
});
