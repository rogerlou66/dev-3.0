const updates = {
	// Canary build badge (About dialog)
	"update.canaryBadge": "Canary",
	"update.canaryBadgeTooltip": "Compilación canary — hecha desde main, no es una versión probada. {version}",

	// Rosetta warning (Intel build on Apple Silicon)
	"rosetta.title": "Versión Intel en Apple Silicon",
	"rosetta.body":
		"Esta copia de dev-3.0 es la versión Intel (x64) ejecutándose mediante Rosetta 2. Es más lenta, y macOS está retirando el soporte de Rosetta — pronto dejará de abrirse por completo.",
	"rosetta.instructionBrew": "Cierra dev-3.0, pega este comando en Terminal y vuelve a abrir dev-3.0:",
	"rosetta.instructionDmg":
		"Pega este comando en Terminal, luego arrastra dev-3.0 a Applications (reemplazando la versión anterior) y reinicia:",
	"rosetta.dataSafe": "Tus proyectos, tareas y ajustes no se ven afectados.",
	"rosetta.copyBtn": "Copiar comando",
	"rosetta.copiedBtn": "¡Copiado!",
	"rosetta.laterBtn": "Recordar más tarde",

	// Requirements
	"requirements.title": "Requisitos del sistema",
	"requirements.subtitle": "Las siguientes herramientas deben estar instaladas para usar dev-3.0",
	"requirements.installed": "Instalado",
	"requirements.missing": "No encontrado",
	"requirements.refresh": "Verificar de nuevo",
	"requirements.copied": "Copiado!",
	"requirements.installGit": "Instalar con Xcode CLI tools:",
	"requirements.installGitWindows": "Instalar con winget:",
	"requirements.tmuxUnavailableWindows": "No disponible en Windows: las terminales de tarea usan el backend nativo.",
	"requirements.installTmux": "Instalar con Homebrew:",
	"requirements.installYazi": "Instalar con Homebrew (opcional, para explorador de archivos):",
	"requirements.optional": "opcional",
	"requirements.customPathHint": "O especifique la ruta completa al binario:",
	"requirements.pathNotFound": "La ruta guardada no existe o no apunta a un archivo ejecutable",
	"requirements.pathInvalidBinary": "La ruta debe apuntar a un binario ejecutable de {name}",
	"requirements.setPath": "Establecer ruta",

	// Changelog
	"changelog.screenTitle": "Historial de cambios",
	"changelog.loading": "Cargando...",
	"changelog.empty": "Aún no hay entradas — aparecerán aquí al publicar nuevas versiones.",
	"changelog.feature": "feature",
	"changelog.fix": "fix",
	"changelog.refactor": "refactor",
	"changelog.docs": "docs",
	"changelog.chore": "chore",
	"changelog.clearFilter": "limpiar",
	"changelog.subtitle": "Todo lo que hemos lanzado, lo más reciente primero.",
	"changelog.entries_one": "{count} entrada",
	"changelog.entries_other": "{count} entradas",
	"changelog.searchPlaceholder": "Buscar en el changelog…",
	"changelog.clearSearch": "Borrar búsqueda",
	"changelog.noResults": "Nada coincide con tu búsqueda o filtros.",
	"changelog.resetFilters": "Restablecer filtros",
	"changelog.showMore": "Mostrar más",
};

export default updates;
