import { useState } from "react";
import type { GlobalSettings, PollingGroup, PollingIntervalKey, PollingSettings } from "../../../shared/types";
import {
	POLLING_DEFAULT_MINUTES,
	POLLING_MAX_MINUTES,
	POLLING_MIN_MINUTES,
	sanitizePollingSettings,
} from "../../../shared/polling-settings";
import type { TFunction, TranslationKey } from "../../i18n";
import SettingsEntry from "./SettingsEntry";
import SettingsSection from "./SettingsSection";
import SettingsToggle from "./SettingsToggle";

interface PollingGroupDefinition {
	group: PollingGroup;
	anchor: string;
	titleKey: TranslationKey;
	descriptionKey: TranslationKey;
	fields: { key: PollingIntervalKey; labelKey: TranslationKey }[];
}

/** Anchors match the `polling-*` Settings entries in settings-registry.ts. */
const POLLING_GROUP_DEFINITIONS: PollingGroupDefinition[] = [
	{
		group: "mergeDetection",
		anchor: "polling-merge-detection",
		titleKey: "settings.pollingMergeDetection",
		descriptionKey: "settings.pollingMergeDetectionDesc",
		fields: [
			{ key: "mergeActive", labelKey: "settings.pollingOnScreenProject" },
			{ key: "mergeBackground", labelKey: "settings.pollingOtherProjects" },
		],
	},
	{
		group: "prStatus",
		anchor: "polling-pr-status",
		titleKey: "settings.pollingPrStatus",
		descriptionKey: "settings.pollingPrStatusDesc",
		fields: [
			{ key: "prActive", labelKey: "settings.pollingOnScreenProject" },
			{ key: "prBackground", labelKey: "settings.pollingOtherProjects" },
			{ key: "prPendingActive", labelKey: "settings.pollingOnScreenCiRunning" },
			{ key: "prPendingBackground", labelKey: "settings.pollingOtherCiRunning" },
		],
	},
	{
		group: "branchStatusFetch",
		anchor: "polling-git-bar",
		titleKey: "settings.pollingGitBar",
		descriptionKey: "settings.pollingGitBarDesc",
		fields: [{ key: "branchStatusFetch", labelKey: "settings.pollingEvery" }],
	},
	{
		group: "pullButtonFetch",
		anchor: "polling-pull-button",
		titleKey: "settings.pollingPullButton",
		descriptionKey: "settings.pollingPullButtonDesc",
		fields: [{ key: "pullButtonFetch", labelKey: "settings.pollingEvery" }],
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
	const [draft, setDraft] = useState<Partial<Record<PollingIntervalKey, string>>>({});

	const setGroupOff = (group: PollingGroup, off: boolean) => {
		const nextOff = { ...polling?.off };
		if (off) nextOff[group] = true;
		else delete nextOff[group];
		onChange(sanitizePollingSettings({ ...polling, off: nextOff }));
	};

	const commitMinutes = (key: PollingIntervalKey, raw: string) => {
		const nextMinutes = { ...polling?.minutes };
		const value = Number(raw);
		if (raw.trim() === "") delete nextMinutes[key];
		else if (Number.isFinite(value)) nextMinutes[key] = value;
		else return;
		onChange(sanitizePollingSettings({ ...polling, minutes: nextMinutes }));
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
								{fields.map(({ key, labelKey }) => (
									<label key={key} className="flex flex-col gap-1.5">
										<span className="text-fg-3 text-xs">{t(labelKey)}</span>
										<span className="flex items-center gap-2">
											<input
												type="number"
												inputMode="numeric"
												min={POLLING_MIN_MINUTES}
												max={POLLING_MAX_MINUTES}
												step={1}
												disabled={!enabled}
												placeholder={String(POLLING_DEFAULT_MINUTES[key])}
												value={draft[key] ?? (polling?.minutes?.[key] !== undefined ? String(polling.minutes[key]) : "")}
												aria-label={`${t(titleKey)}: ${t(labelKey)}`}
												onChange={(e) => {
													setDraft((d) => ({ ...d, [key]: e.target.value }));
													commitMinutes(key, e.target.value);
												}}
												onBlur={() => setDraft((d) => ({ ...d, [key]: undefined }))}
												className="w-20 px-3 py-3 bg-raised border border-edge rounded-xl text-fg text-sm text-center tabular-nums outline-none transition-colors duration-150 focus:border-edge-active disabled:opacity-50"
											/>
											<span className="text-fg-3 text-xs">{t("settings.pollingMinutesUnit")}</span>
										</span>
									</label>
								))}
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
