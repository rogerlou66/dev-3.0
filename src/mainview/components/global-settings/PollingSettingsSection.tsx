import { useState } from "react";
import type {
	GlobalSettings,
	PollingGroup,
	PollingIntervalKey,
	PollingSecondsKey,
	PollingSettings,
} from "../../../shared/types";
import {
	POLLING_DEFAULT_MINUTES,
	POLLING_DEFAULT_SECONDS,
	POLLING_MAX_MINUTES,
	POLLING_MAX_SECONDS,
	POLLING_MIN_MINUTES,
	POLLING_MIN_SECONDS,
	sanitizePollingSettings,
} from "../../../shared/polling-settings";
import type { TFunction, TranslationKey } from "../../i18n";
import SettingsEntry from "./SettingsEntry";
import SettingsSection from "./SettingsSection";
import SettingsToggle from "./SettingsToggle";

type PollingField =
	| { unit: "minutes"; key: PollingIntervalKey; labelKey: TranslationKey }
	| { unit: "seconds"; key: PollingSecondsKey; labelKey: TranslationKey };

interface PollingGroupDefinition {
	group: PollingGroup;
	anchor: string;
	titleKey: TranslationKey;
	descriptionKey: TranslationKey;
	fields: PollingField[];
}

const UNIT_LIMITS = {
	minutes: { min: POLLING_MIN_MINUTES, max: POLLING_MAX_MINUTES, unitKey: "settings.pollingMinutesUnit" },
	seconds: { min: POLLING_MIN_SECONDS, max: POLLING_MAX_SECONDS, unitKey: "settings.pollingSecondsUnit" },
} as const satisfies Record<PollingField["unit"], { min: number; max: number; unitKey: TranslationKey }>;

function defaultFor(field: PollingField): number {
	return field.unit === "minutes" ? POLLING_DEFAULT_MINUTES[field.key] : POLLING_DEFAULT_SECONDS[field.key];
}

function storedFor(polling: PollingSettings | undefined, field: PollingField): number | undefined {
	return field.unit === "minutes" ? polling?.minutes?.[field.key] : polling?.seconds?.[field.key];
}

/** Anchors match the `polling-*` Settings entries in settings-registry.ts. */
const POLLING_GROUP_DEFINITIONS: PollingGroupDefinition[] = [
	{
		group: "mergeDetection",
		anchor: "polling-merge-detection",
		titleKey: "settings.pollingMergeDetection",
		descriptionKey: "settings.pollingMergeDetectionDesc",
		fields: [
			{ unit: "minutes", key: "mergeActive", labelKey: "settings.pollingOnScreenProject" },
			{ unit: "minutes", key: "mergeBackground", labelKey: "settings.pollingOtherProjects" },
		],
	},
	{
		group: "prStatus",
		anchor: "polling-pr-status",
		titleKey: "settings.pollingPrStatus",
		descriptionKey: "settings.pollingPrStatusDesc",
		fields: [
			{ unit: "minutes", key: "prActive", labelKey: "settings.pollingOnScreenProject" },
			{ unit: "minutes", key: "prBackground", labelKey: "settings.pollingOtherProjects" },
			{ unit: "minutes", key: "prPendingActive", labelKey: "settings.pollingOnScreenCiRunning" },
			{ unit: "minutes", key: "prPendingBackground", labelKey: "settings.pollingOtherCiRunning" },
		],
	},
	{
		group: "projectPrList",
		anchor: "polling-board-prs",
		titleKey: "settings.pollingProjectPrList",
		descriptionKey: "settings.pollingProjectPrListDesc",
		fields: [{ unit: "minutes", key: "projectPrList", labelKey: "settings.pollingEvery" }],
	},
	{
		group: "branchStatusPoll",
		anchor: "polling-branch-status",
		titleKey: "settings.pollingBranchStatus",
		descriptionKey: "settings.pollingBranchStatusDesc",
		fields: [{ unit: "seconds", key: "branchStatusPoll", labelKey: "settings.pollingEvery" }],
	},
	{
		group: "branchStatusFetch",
		anchor: "polling-git-bar",
		titleKey: "settings.pollingGitBar",
		descriptionKey: "settings.pollingGitBarDesc",
		fields: [{ unit: "minutes", key: "branchStatusFetch", labelKey: "settings.pollingEvery" }],
	},
	{
		group: "pullButtonFetch",
		anchor: "polling-pull-button",
		titleKey: "settings.pollingPullButton",
		descriptionKey: "settings.pollingPullButtonDesc",
		fields: [{ unit: "minutes", key: "pullButtonFetch", labelKey: "settings.pollingEvery" }],
	},
];

export default function PollingSettingsSection({
	t,
	globalSettings,
	onChange,
}: {
	t: TFunction;
	globalSettings: GlobalSettings;
	onChange: (polling: PollingSettings | undefined) => void;
}) {
	const polling = globalSettings.polling;
	// Free text while typing; the stored value is clamped, so echoing it back
	// would move digits under the cursor. Dropped on blur.
	const [draft, setDraft] = useState<Partial<Record<PollingField["key"], string>>>({});

	const setGroupOff = (group: PollingGroup, off: boolean) => {
		const nextOff = { ...polling?.off };
		if (off) nextOff[group] = true;
		else delete nextOff[group];
		onChange(sanitizePollingSettings({ ...polling, off: nextOff }));
	};

	const commitInterval = (field: PollingField, raw: string) => {
		const map: Record<string, number> = { ...(field.unit === "minutes" ? polling?.minutes : polling?.seconds) };
		const value = Number(raw);
		if (raw.trim() === "") delete map[field.key];
		else if (Number.isFinite(value)) map[field.key] = value;
		else return;
		onChange(sanitizePollingSettings({ ...polling, [field.unit]: map }));
	};

	return (
		<SettingsSection
			title={t("settings.categoryPolling")}
			description={t("settings.pollingSectionDesc")}
			helpTopicId="settings.polling"
		>
			{POLLING_GROUP_DEFINITIONS.map(({ group, anchor, titleKey, descriptionKey, fields }) => {
				const enabled = polling?.off?.[group] !== true;
				return (
					<SettingsEntry key={group} anchor={anchor}>
						<div>
							<p className="block text-fg text-sm font-semibold mb-2">{t(titleKey)}</p>
							<p className="text-fg-3 text-sm mb-3">{t(descriptionKey)}</p>
							<SettingsToggle
								checked={enabled}
								ariaLabel={t(titleKey)}
								onLabel={t("settings.on")}
								offLabel={t("settings.off")}
								onToggle={() => setGroupOff(group, enabled)}
							/>
							<div className="flex flex-wrap items-end gap-3 mt-3">
								{fields.map((field) => {
									const { key, labelKey, unit } = field;
									const limits = UNIT_LIMITS[unit];
									const stored = storedFor(polling, field);
									return (
										<label key={key} className="flex flex-col gap-1.5">
											<span className="text-fg-3 text-xs">{t(labelKey)}</span>
											<span className="flex items-center gap-2">
												<input
													type="number"
													inputMode="numeric"
													min={limits.min}
													max={limits.max}
													step={1}
													disabled={!enabled}
													placeholder={String(defaultFor(field))}
													value={draft[key] ?? (stored !== undefined ? String(stored) : "")}
													aria-label={`${t(titleKey)}: ${t(labelKey)}`}
													onChange={(e) => {
														setDraft((d) => ({ ...d, [key]: e.target.value }));
														commitInterval(field, e.target.value);
													}}
													onBlur={() => setDraft((d) => ({ ...d, [key]: undefined }))}
													className="w-20 px-3 py-3 bg-raised border border-edge rounded-xl text-fg text-sm text-center tabular-nums outline-none transition-colors duration-150 focus:border-edge-active disabled:opacity-50"
												/>
												<span className="text-fg-3 text-xs">{t(limits.unitKey)}</span>
											</span>
										</label>
									);
								})}
							</div>
						</div>
					</SettingsEntry>
				);
			})}
			{polling ? (
				<button
					type="button"
					onClick={() => {
						setDraft({});
						onChange(undefined);
					}}
					className="text-accent hover:text-accent-emphasis text-sm transition-colors"
				>
					{t("settings.pollingResetDefaults")}
				</button>
			) : null}
		</SettingsSection>
	);
}
