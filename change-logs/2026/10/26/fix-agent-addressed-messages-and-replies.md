Short: Messages reach the agent they were meant for

`dev3 message` to a task now always goes to that task's main agent instead of whichever pane was focused last, and `dev3 pane list` marks each agent pane (main, extra, AI Review) with a handle that `dev3 message --agent <handle>` addresses directly; an addressed agent that has exited or been replaced, including while the message waited in the hold, gets a clear "not delivered" instead of a redirect. A message's reply command now addresses the exact agent that sent it, and when dev3 cannot prove which agent that was (on Windows, or `dev3 message` typed in a plain shell) the message carries no reply command at all and the sender is told replies are unavailable.

Suggested by @vit-pavlenko (h0x91b/dev-3.0#1809)
