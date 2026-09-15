# cmux appearance preserves saved preferences

## Context
The cmux preset must change the whole interface and live terminals, while switching back restores the user's theme, font, and size. Terminal fonts are device-local, whereas appearance and theme preferences are stored by the host.

## Investigation
The renderer and tmux both paint terminal colors; changing only the canvas theme leaves tmux's explicit backgrounds visible. SF Mono can be available to a native application without being available to a browser, so a CSS family name alone does not prove font availability.

## Decision
Store `appearancePreset` separately and resolve effective theme and font values without rewriting the saved preferences. Use the fixed TokyoNight Storm palette in the renderer and tmux, preserve Nerd Font icons, and bypass terminal width normalization for the preset's exact 14px size before zoom.

## Risks
Remote devices may fall back to the bundled font; the settings UI reports this, and the app never distributes system font files. Switching to a wider font changes terminal columns, so existing terminals refit after the font loads.

## Alternatives considered
Overwriting the saved settings makes reversal lossy. Reading cmux configuration continuously would couple browser rendering to host-specific files and make the preset change without user action.
