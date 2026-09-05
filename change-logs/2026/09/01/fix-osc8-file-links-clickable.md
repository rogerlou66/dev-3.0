Short: Terminal file links open the right file

Terminal file paths that agents wrap in OSC 8 file:// hyperlinks (Claude Code does) showed a hover underline but a dead click: the link provider accepted only http(s) URIs. file:// links now Cmd/Ctrl+Click open like plain path links — resolved on the backend against the allowed roots, then previewed or revealed per the "File path click action" setting. Clicking an OSC 8 link also opens the link actually under the cursor: every such link on screen shares one hyperlink id, so the terminal's own link cache used to answer every click with whichever link was hovered first, and the hover tooltip named one file while the click opened another.

Suggested by @arditti (h0x91b/dev-3.0#1617)
