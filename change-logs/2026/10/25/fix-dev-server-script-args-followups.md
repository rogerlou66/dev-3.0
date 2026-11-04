Short: Dev-server script args land reliably

Script arguments passed with `dev3 dev-server start -- …` now go ahead of a trailing `#` comment on the script's last line instead of being swallowed by it, and a last line they cannot reach (ending in `&`, `|`, `;`, a line continuation or a block keyword like `fi`) is refused before anything is stopped. `--task X abcdef` / `--id X abcdef` once again mean server `abcdef` instead of failing as a second task, and the Dev Server menu no longer sticks out past the window edge when its arguments line loads.
