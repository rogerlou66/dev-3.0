Short: Remote access behind any tunnel

Bring your own tunnel: a custom ngrok-like command configured in Settings → System now serves every tunnel dev3 starts — the remote-access URL and per-task exposed ports alike — while the built-in Cloudflare quick tunnel stays the default. While a custom provider is configured, the remote-access origin check also accepts an Origin matching X-Forwarded-Host, so Host-rewriting tunnel proxies no longer break browser auth and WebSocket upgrades.
