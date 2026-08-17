Short: Manual updates and no telemetry

Removed automatic update checks, background downloads, repeat reminders, and timed restarts; updates now run only after the user chooses Check for Updates, and installation waits for an explicit Restart to Update click. The app and website no longer initialize GA4 or PostHog, collect usage and error events, load remote feature flags, or ship their dependencies, build-time telemetry switches, and build secrets.
