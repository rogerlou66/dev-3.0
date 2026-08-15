import { useCallback, useEffect, useMemo, useState } from "react";
import type { CodingAgent, ModelCatalogView, ModelSidecarStatus } from "../../../shared/types";
import {
	CATALOG_PROVIDER_KINDS,
	isValidCatalogModelName,
	sidecarProviderKey,
	validateCatalog,
	type CatalogProviderKind,
} from "../../../shared/model-catalog";
import { randomUUID } from "../../uuid";
import Select, { type SelectOption } from "../Select";
import { confirm } from "../../confirm";
import { toast } from "../../toast";
import { api } from "../../rpc";
import type { TFunction } from "../../i18n";
import SettingsEntry from "./SettingsEntry";
import SettingsSection from "./SettingsSection";

const EMPTY: ModelCatalogView = { providers: [], models: [] };

const INPUT_CLASS =
	"w-full px-3 py-1.5 bg-base border border-edge rounded-lg text-fg text-sm placeholder-fg-muted outline-none focus:border-accent/40 transition-colors";
const BUTTON_CLASS =
	"px-2.5 py-1 rounded-lg bg-elevated border border-edge text-fg-2 text-xs hover:text-fg hover:border-edge-active transition-colors disabled:opacity-50";

/** A labelled control. The id association is explicit because the value editor
 *  is often a custom listbox, which a wrapping <label> would not reach. */
function Field({
	label,
	htmlFor,
	hint,
	children,
}: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
	return (
		<div className="min-w-0">
			<label htmlFor={htmlFor} className="block text-fg-2 text-xs font-semibold mb-1">
				{label}
			</label>
			{children}
			{hint ? <span className="block text-fg-3 text-xs mt-1">{hint}</span> : null}
		</div>
	);
}

function StatusRow({ tone, children }: { tone: "success" | "warning" | "danger" | "muted"; children: React.ReactNode }) {
	const dot = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", muted: "bg-fg-muted" }[tone];
	return (
		<div className="flex items-center gap-2 text-sm text-fg-2">
			<span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} aria-hidden />
			<span className="min-w-0">{children}</span>
		</div>
	);
}

/**
 * The model catalog: providers dev3 may reach and the named models on top of
 * them. Credentials go in and never come back. Edits stay local until saved,
 * because saving restarts the proxy and that interrupts running sessions.
 */
export default function ModelCatalogSection({ t }: { t: TFunction }) {
	const [saved, setSaved] = useState<ModelCatalogView>(EMPTY);
	const [draft, setDraft] = useState<ModelCatalogView>(EMPTY);
	const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
	const [status, setStatus] = useState<ModelSidecarStatus | null>(null);
	const [available, setAvailable] = useState<string[] | null>(null);
	const [listError, setListError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	/** Only to count which presets a deletion would break — never edited here. */
	const [agents, setAgents] = useState<CodingAgent[]>([]);

	const load = useCallback(async () => {
		try {
			const view = await api.request.modelCatalogGet();
			setSaved(view);
			setDraft(view);
		} catch (err) {
			toast.error(t("catalog.loadError", { error: String(err) }), { source: "settings" });
		}
	}, [t]);

	const refreshStatus = useCallback(async () => {
		try {
			setStatus(await api.request.modelSidecarStatus());
		} catch {
			/* transient — keep the last known status */
		}
	}, []);

	useEffect(() => {
		void load();
		void refreshStatus();
		void api.request.getAgents().then(setAgents).catch(() => setAgents([]));
		const timer = setInterval(() => void refreshStatus(), 4000);
		return () => clearInterval(timer);
	}, [load, refreshStatus]);

	const dirty = useMemo(
		() => JSON.stringify(draft) !== JSON.stringify(saved) || Object.keys(keyDrafts).length > 0,
		[draft, saved, keyDrafts],
	);

	const issues = useMemo(
		() => validateCatalog({ providers: draft.providers, models: draft.models }),
		[draft],
	);

	const patchProvider = (id: string, patch: Partial<ModelCatalogView["providers"][number]>) =>
		setDraft((d) => ({ ...d, providers: d.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));

	const patchModel = (id: string, patch: Partial<ModelCatalogView["models"][number]>) =>
		setDraft((d) => ({ ...d, models: d.models.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));

	/** Presets that would stop working if these catalog models disappeared. */
	const presetsUsing = (modelIds: string[]): number =>
		agents.reduce(
			(sum, agent) =>
				sum + agent.configurations.filter((c) => Object.values(c.modelRoles ?? {}).some((id) => modelIds.includes(id))).length,
			0,
		);

	const providerLabel = useCallback(
		(id: string) => draft.providers.find((p) => p.id === id)?.label ?? t("catalog.providerGone"),
		[draft.providers, t],
	);

	const kindOptions: SelectOption[] = CATALOG_PROVIDER_KINDS.map((kind) => ({
		value: kind,
		label: t(`catalog.kind.${kind}` as Parameters<TFunction>[0]),
	}));

	const providerOptions: SelectOption[] = draft.providers.map((p) => ({ value: p.id, label: p.label }));

	const kindLabel = (kind: CatalogProviderKind) => t(`catalog.kind.${kind}` as Parameters<TFunction>[0]);

	const addProvider = () => {
		const kind: CatalogProviderKind = CATALOG_PROVIDER_KINDS.find(
			(k) => k !== "custom" && !draft.providers.some((p) => p.kind === k),
		) ?? "custom";
		setDraft({
			...draft,
			providers: [...draft.providers, { id: randomUUID(), kind, label: kindLabel(kind), hasKey: false }],
		});
	};

	/** Switching the kind renames the provider too, unless the user typed a name
	 *  of their own — a row reading "Anthropic" while it talks to OpenRouter is
	 *  the name every model picker then shows. */
	const changeProviderKind = (id: string, kind: CatalogProviderKind) => {
		const current = draft.providers.find((p) => p.id === id);
		const untouched = !current || CATALOG_PROVIDER_KINDS.some((k) => current.label === kindLabel(k));
		patchProvider(id, untouched ? { kind, label: kindLabel(kind) } : { kind });
	};

	const removeProvider = async (id: string) => {
		const orphans = draft.models.filter((m) => m.providerId === id);
		const presets = presetsUsing(orphans.map((m) => m.id));
		const ok = await confirm({
			title: t("catalog.removeProviderTitle"),
			message: presets > 0
				? t("catalog.removeProviderInUse", { models: String(orphans.length), presets: String(presets) })
				: orphans.length > 0
					? t("catalog.removeProviderOrphans", { count: String(orphans.length) })
					: t("catalog.removeProviderBody"),
			confirmLabel: t("catalog.removeProvider"),
			danger: true,
		});
		if (!ok) return;
		setDraft({
			providers: draft.providers.filter((p) => p.id !== id),
			models: draft.models.filter((m) => m.providerId !== id),
		});
		setKeyDrafts((prev) => {
			const next = { ...prev };
			delete next[id];
			return next;
		});
	};

	const addModel = () => {
		const providerId = draft.providers[0]?.id;
		if (!providerId) return;
		setDraft({ ...draft, models: [...draft.models, { id: randomUUID(), providerId, name: "", modelId: "" }] });
	};

	const removeModel = async (id: string) => {
		const presets = presetsUsing([id]);
		const ok = await confirm({
			title: t("catalog.removeModelTitle"),
			message: presets > 0 ? t("catalog.removeModelInUse", { presets: String(presets) }) : t("catalog.removeModelBody"),
			confirmLabel: t("catalog.removeModel"),
			danger: true,
		});
		if (!ok) return;
		setDraft({ ...draft, models: draft.models.filter((m) => m.id !== id) });
	};

	const duplicateModel = (id: string) => {
		const source = draft.models.find((m) => m.id === id);
		if (!source) return;
		setDraft({ ...draft, models: [...draft.models, { ...source, id: randomUUID(), name: `${source.name}-2` }] });
	};

	const save = async () => {
		setBusy(true);
		try {
			const view = await api.request.modelCatalogSave({ catalog: draft, providerKeys: keyDrafts });
			setSaved(view);
			setDraft(view);
			setKeyDrafts({});
			toast.success(t("catalog.saved"), { source: "settings" });
			void refreshStatus();
		} catch (err) {
			toast.error(t("catalog.saveError", { error: String(err) }), { source: "settings" });
		} finally {
			setBusy(false);
		}
	};

	const startProxy = async () => {
		setBusy(true);
		setListError(null);
		try {
			setStatus(await api.request.modelSidecarStart());
		} catch (err) {
			toast.error(t("catalog.startError", { error: String(err) }), { source: "settings" });
			void refreshStatus();
		} finally {
			setBusy(false);
		}
	};

	const stopProxy = async () => {
		setBusy(true);
		try {
			setStatus(await api.request.modelSidecarStop());
			setAvailable(null);
		} finally {
			setBusy(false);
		}
	};

	/** Live model ids, so the id field is a choice rather than a guess. Only a
	 *  successful listing counts — an error must never look like "no models". */
	const loadAvailable = async () => {
		setListError(null);
		try {
			const { models } = await api.request.modelCatalogListModels({});
			setAvailable(models);
		} catch (err) {
			setAvailable(null);
			setListError(String(err));
		}
	};

	const idOptions = (providerId: string): SelectOption[] => {
		const provider = draft.providers.find((p) => p.id === providerId);
		if (!available || !provider) return [];
		const prefix = `${sidecarProviderKey(provider)}/`;
		return available
			.filter((id) => id.startsWith(prefix))
			.map((id) => ({ value: id.slice(prefix.length), label: id.slice(prefix.length) }));
	};

	return (
		<SettingsEntry anchor="model-catalog">
			<SettingsSection title={t("catalog.section")} description={t("catalog.sectionDesc")}>
				{/* Proxy state — one place that answers "is it me or the proxy". */}
				<div className="space-y-3 rounded-xl border border-edge bg-raised p-4">
					{!status?.binaryAvailable ? (
						<StatusRow tone="danger">{t("catalog.binaryMissing")}</StatusRow>
					) : status?.running ? (
						<StatusRow tone="success">
							{t("catalog.proxyRunning", { port: String(status.port ?? "?") })} · {status.version}
						</StatusRow>
					) : status?.starting ? (
						<StatusRow tone="warning">{t("catalog.proxyStarting")}</StatusRow>
					) : (
						<StatusRow tone="muted">{t("catalog.proxyStopped")}</StatusRow>
					)}

					{status?.lastError ? (
						<pre className="text-xs text-danger whitespace-pre-wrap break-words max-h-40 overflow-auto">
							{status.lastError}
						</pre>
					) : null}

					<div className="flex flex-wrap items-center gap-2">
						{status?.running ? (
							<button type="button" onClick={stopProxy} disabled={busy} className={BUTTON_CLASS}>
								{t("catalog.stopProxy")}
							</button>
						) : (
							<button
								type="button"
								onClick={startProxy}
								disabled={busy || !status?.binaryAvailable || draft.models.length === 0}
								className={BUTTON_CLASS}
							>
								{t("catalog.startProxy")}
							</button>
						)}
						<button
							type="button"
							onClick={loadAvailable}
							disabled={busy || !status?.binaryAvailable}
							className={BUTTON_CLASS}
						>
							{t("catalog.refreshModels")}
						</button>
						{listError ? <span className="text-xs text-warning">{t("catalog.listUnavailable")}</span> : null}
					</div>
				</div>

				{/* Providers */}
				<div className="space-y-3">
					<p className="text-fg text-sm font-semibold">{t("catalog.providers")}</p>
					{draft.providers.length === 0 ? (
						<p className="text-fg-3 text-sm">{t("catalog.noProviders")}</p>
					) : null}
					{draft.providers.map((provider) => (
						<div key={provider.id} className="rounded-xl border border-edge bg-raised p-3 space-y-3">
							<div className="grid gap-3 sm:grid-cols-2">
								<Field label={t("catalog.providerKind")} htmlFor={`provider-kind-${provider.id}`}>
									<Select
										id={`provider-kind-${provider.id}`}
										value={provider.kind}
										options={kindOptions}
										onChange={(value) => changeProviderKind(provider.id, value as CatalogProviderKind)}
									/>
								</Field>
								<Field label={t("catalog.providerLabel")} htmlFor={`provider-label-${provider.id}`} hint={t("catalog.providerLabelHint")}>
									<input
										id={`provider-label-${provider.id}`}
										type="text"
										value={provider.label}
										onChange={(event) => patchProvider(provider.id, { label: event.target.value })}
										className={INPUT_CLASS}
									/>
								</Field>
								{provider.kind === "custom" ? (
									<Field label={t("catalog.providerBaseUrl")} htmlFor={`provider-url-${provider.id}`} hint={t("catalog.providerBaseUrlHint")}>
										<input
											id={`provider-url-${provider.id}`}
											type="url"
											value={provider.baseUrl ?? ""}
											placeholder="https://llm.example.com/v1"
											onChange={(event) => patchProvider(provider.id, { baseUrl: event.target.value })}
											className={`${INPUT_CLASS} font-mono`}
										/>
									</Field>
								) : null}
								<Field
									label={t("catalog.providerKey")}
									htmlFor={`provider-key-${provider.id}`}
									hint={provider.hasKey ? t("catalog.providerKeyStored") : t("catalog.providerKeyMissing")}
								>
									<input
										id={`provider-key-${provider.id}`}
										type="password"
										value={keyDrafts[provider.id] ?? ""}
										placeholder={provider.hasKey ? "••••••••" : "sk-…"}
										autoComplete="off"
										spellCheck={false}
										onChange={(event) => setKeyDrafts({ ...keyDrafts, [provider.id]: event.target.value })}
										className={`${INPUT_CLASS} font-mono`}
									/>
								</Field>
							</div>
							<div className="flex items-center justify-between gap-2">
								<span className="text-fg-muted text-xs font-mono truncate">
									{sidecarProviderKey(provider)}/…
								</span>
								<button
									type="button"
									onClick={() => void removeProvider(provider.id)}
									className="px-2.5 py-1 rounded-lg text-danger text-xs hover:bg-danger/10 border border-transparent hover:border-danger/30 transition-colors"
								>
									{t("catalog.removeProvider")}
								</button>
							</div>
						</div>
					))}
					<button type="button" onClick={addProvider} className={BUTTON_CLASS}>
						{t("catalog.addProvider")}
					</button>
				</div>

				{/* Named models */}
				<div className="space-y-3">
					<p className="text-fg text-sm font-semibold">{t("catalog.models")}</p>
					{draft.models.length === 0 ? <p className="text-fg-3 text-sm">{t("catalog.noModels")}</p> : null}
					{draft.models.map((model) => {
						const nameBad = model.name.length > 0 && !isValidCatalogModelName(model.name);
						return (
							<div key={model.id} className="rounded-xl border border-edge bg-raised p-3 space-y-3">
								<div className="grid gap-3 sm:grid-cols-3">
									<Field label={t("catalog.modelName")} htmlFor={`model-name-${model.id}`} hint={nameBad ? t("catalog.modelNameInvalid") : undefined}>
										<input
											id={`model-name-${model.id}`}
											type="text"
											value={model.name}
											placeholder="fast-gremlin"
											onChange={(event) => patchModel(model.id, { name: event.target.value })}
											className={`${INPUT_CLASS} font-mono ${nameBad ? "border-danger/50" : ""}`}
										/>
									</Field>
									<Field label={t("catalog.modelProvider")} htmlFor={`model-provider-${model.id}`}>
										<Select
											id={`model-provider-${model.id}`}
											value={model.providerId}
											options={providerOptions}
											onChange={(value) => patchModel(model.id, { providerId: value })}
										/>
									</Field>
									<Field label={t("catalog.modelId")} htmlFor={`model-id-${model.id}`} hint={available ? undefined : t("catalog.modelIdManual")}>
										<Select
											id={`model-id-${model.id}`}
											value={model.modelId}
											options={idOptions(model.providerId)}
											allowCustom
											searchPlaceholder={t("catalog.modelIdPlaceholder")}
											searchLabel={t("catalog.modelId")}
											customOptionLabel={(query) => query}
											emptyLabel={t("catalog.modelIdEmpty")}
											onChange={(value) => patchModel(model.id, { modelId: value })}
										/>
									</Field>
								</div>
								<div className="flex items-center justify-between gap-2">
									<span className="text-fg-muted text-xs font-mono truncate">{providerLabel(model.providerId)}</span>
									<div className="flex items-center gap-1.5">
										<button type="button" onClick={() => duplicateModel(model.id)} className={BUTTON_CLASS}>
											{t("catalog.duplicateModel")}
										</button>
										<button
											type="button"
											onClick={() => void removeModel(model.id)}
											className="px-2.5 py-1 rounded-lg text-danger text-xs hover:bg-danger/10 border border-transparent hover:border-danger/30 transition-colors"
										>
											{t("catalog.removeModel")}
										</button>
									</div>
								</div>
							</div>
						);
					})}
					<button
						type="button"
						onClick={addModel}
						disabled={draft.providers.length === 0}
						className={BUTTON_CLASS}
						title={draft.providers.length === 0 ? t("catalog.addModelNeedsProvider") : undefined}
					>
						{t("catalog.addModel")}
					</button>
				</div>

				{/* Save — an edit costs a proxy restart, so it is explicit and announced. */}
				{dirty ? (
					<div className="rounded-xl border border-warning/30 bg-warning/10 p-3 space-y-2">
						<p className="text-fg-2 text-xs leading-relaxed">{t("catalog.restartWarning")}</p>
						{issues.length > 0 ? (
							<p className="text-danger text-xs">{t(`catalog.issue.${issues[0].code}` as Parameters<TFunction>[0])}</p>
						) : null}
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={save}
								disabled={busy || issues.length > 0}
								className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
							>
								{t("catalog.save")}
							</button>
							<button
								type="button"
								onClick={() => {
									setDraft(saved);
									setKeyDrafts({});
								}}
								disabled={busy}
								className={BUTTON_CLASS}
							>
								{t("catalog.discard")}
							</button>
						</div>
					</div>
				) : null}
			</SettingsSection>
		</SettingsEntry>
	);
}
