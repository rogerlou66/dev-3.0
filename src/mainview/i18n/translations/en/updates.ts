const updates = {
	// Canary build badge (About dialog)
	// The channel name is a proper noun in all locales; the tooltip is what carries the meaning.
	"update.canaryBadge": "Canary",
	"update.canaryBadgeTooltip": "Canary build — cut from main, not a tested release. {version}",

	// Rosetta warning (Intel build on Apple Silicon)
	"rosetta.title": "Intel build on Apple Silicon",
	"rosetta.body":
		"This copy of dev-3.0 is the Intel (x64) build running through Rosetta 2. It runs slower, and macOS is ending Rosetta support — soon it will stop launching entirely.",
	"rosetta.instructionBrew": "Quit dev-3.0, paste this in Terminal, then launch dev-3.0 again:",
	"rosetta.instructionDmg":
		"Paste this in Terminal, then drag dev-3.0 into Applications (replacing the old one) and relaunch:",
	"rosetta.dataSafe": "Your projects, tasks, and settings are not affected.",
	"rosetta.copyBtn": "Copy command",
	"rosetta.copiedBtn": "Copied!",
	"rosetta.laterBtn": "Remind me later",

	// Requirements
	"requirements.title": "System Requirements",
	"requirements.subtitle": "The following tools must be installed to use dev-3.0",
	"requirements.installed": "Installed",
	"requirements.missing": "Not found",
	"requirements.refresh": "Re-check",
	"requirements.copied": "Copied!",
	"requirements.installGit": "Install via Xcode CLI tools:",
	"requirements.installGitWindows": "Install with winget:",
	"requirements.tmuxUnavailableWindows": "Not available on Windows — task terminals use the native backend.",
	"requirements.installTmux": "Install via Homebrew:",
	"requirements.installYazi": "Install via Homebrew (optional, for file browser):",
	"requirements.optional": "optional",
	"requirements.customPathHint": "Or specify the full path to the binary:",
	"requirements.pathNotFound": "Saved path is missing or is not an executable file",
	"requirements.pathInvalidBinary": "Path must point to an executable {name} binary",
	"requirements.setPath": "Set path",

	// Changelog
	"changelog.screenTitle": "Changelog",
	"changelog.loading": "Loading...",
	"changelog.empty": "No changelog entries yet — they appear here as you ship new versions.",
	"changelog.feature": "feature",
	"changelog.fix": "fix",
	"changelog.refactor": "refactor",
	"changelog.docs": "docs",
	"changelog.chore": "chore",
	"changelog.clearFilter": "clear",
	"changelog.subtitle": "Everything we've shipped, newest first.",
	"changelog.entries_one": "{count} entry",
	"changelog.entries_other": "{count} entries",
	"changelog.searchPlaceholder": "Search changelog…",
	"changelog.clearSearch": "Clear search",
	"changelog.noResults": "Nothing matches your search or filters.",
	"changelog.resetFilters": "Reset filters",
	"changelog.showMore": "Show more",
} as const;

export default updates;
