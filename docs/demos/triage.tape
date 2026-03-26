# TicketLens — Triage scan demo
# Generates: docs/demos/triage.gif
#
# Prerequisites:
#   brew install vhs
#   npm install -g ticketlens
#   ticketlens init   (configure your Jira connection first)
#
# Usage:
#   Run: vhs docs/demos/triage.tape

Output docs/demos/triage.gif

Set FontSize 13
Set Width 110
Set Height 38
Set Theme "Dracula"
Set CursorBlink false
Set TypingSpeed 60ms

Sleep 800ms

# Launch triage
Type "ticketlens triage"
Sleep 400ms
Enter

# Wait for banner + API calls + interactive list
Sleep 8s

# Navigate down a couple of rows to show the interactive UX
Down
Sleep 600ms
Down
Sleep 600ms
Down
Sleep 600ms

# Pause on a row so the viewer can read it
Sleep 1500ms

# Navigate back up
Up
Sleep 500ms
Up
Sleep 500ms

# Hold on the highlighted ticket
Sleep 1500ms

# Exit interactive mode
Ctrl+C
Sleep 800ms
