const updates = {
	// Canary build badge (About dialog)
	"update.canaryBadge": "Canary",
	"update.canaryBadgeTooltip": "Canary-сборка — собрана из main, это не протестированный релиз. {version}",

	// Rosetta warning (Intel build on Apple Silicon)
	"rosetta.title": "Intel-сборка на Apple Silicon",
	"rosetta.body":
		"Эта копия dev-3.0 — Intel-сборка (x64), работающая через Rosetta 2. Она медленнее, а macOS прекращает поддержку Rosetta — скоро приложение вовсе перестанет запускаться.",
	"rosetta.instructionBrew": "Закройте dev-3.0, вставьте команду в Терминал, затем запустите dev-3.0 снова:",
	"rosetta.instructionDmg":
		"Вставьте команду в Терминал, затем перетащите dev-3.0 в Applications (заменив старую версию) и перезапустите:",
	"rosetta.dataSafe": "Ваши проекты, задачи и настройки не пострадают.",
	"rosetta.copyBtn": "Скопировать команду",
	"rosetta.copiedBtn": "Скопировано!",
	"rosetta.laterBtn": "Напомнить позже",

	// Requirements
	"requirements.title": "Системные требования",
	"requirements.subtitle": "Для работы dev-3.0 необходимы следующие инструменты",
	"requirements.installed": "Установлено",
	"requirements.missing": "Не найдено",
	"requirements.refresh": "Проверить снова",
	"requirements.copied": "Скопировано!",
	"requirements.installGit": "Установить через Xcode CLI tools:",
	"requirements.installGitWindows": "Установить через winget:",
	"requirements.tmuxUnavailableWindows": "Недоступен в Windows — терминалы задач работают на нативном бэкенде.",
	"requirements.installTmux": "Установить через Homebrew:",
	"requirements.installYazi": "Установить через Homebrew (опционально, для файлового браузера):",
	"requirements.optional": "опционально",
	"requirements.customPathHint": "Или укажите полный путь к бинарнику:",
	"requirements.pathNotFound": "Сохранённый путь отсутствует или не указывает на исполняемый файл",
	"requirements.pathInvalidBinary": "Путь должен вести к исполняемому файлу {name}",
	"requirements.setPath": "Указать путь",

	// Changelog
	"changelog.screenTitle": "Журнал изменений",
	"changelog.loading": "Загрузка...",
	"changelog.empty": "Записей пока нет — они появятся здесь по мере выпуска новых версий.",
	"changelog.feature": "фича",
	"changelog.fix": "фикс",
	"changelog.refactor": "рефакторинг",
	"changelog.docs": "документация",
	"changelog.chore": "служебное",
	"changelog.clearFilter": "сбросить",
	"changelog.subtitle": "Всё, что мы выпустили, — свежее сверху.",
	"changelog.entries_one": "{count} запись",
	"changelog.entries_few": "{count} записи",
	"changelog.entries_many": "{count} записей",
	"changelog.entries_other": "{count} записей",
	"changelog.searchPlaceholder": "Поиск по изменениям…",
	"changelog.clearSearch": "Очистить поиск",
	"changelog.noResults": "Ничего не найдено по запросу или фильтрам.",
	"changelog.resetFilters": "Сбросить фильтры",
	"changelog.showMore": "Показать ещё",
};

export default updates;
