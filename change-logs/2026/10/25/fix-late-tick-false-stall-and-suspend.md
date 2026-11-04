Short: Honest late-tick diagnostics

The terminal render guard no longer reports a false stall (and rebuilds the terminal) right after the window comes back from a hidden stretch, and the host watchdog now says whether a late tick means the machine slept or the app was starved while awake, instead of calling every one a host suspend; a starved host is no longer logged as a display wake.
