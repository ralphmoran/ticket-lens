# TicketLens — Ticket fetch demo
# Generates: docs/demos/fetch.gif
#
# Prerequisites:
#   brew install vhs
#   npm install -g ticketlens
#   ticketlens init   (configure your Jira connection first)
#
# Usage:
#   Edit TICKET_KEY below to a real ticket in your Jira.
#   Then run: vhs docs/demos/fetch.tape

Output docs/demos/fetch.gif

Set FontSize 13
Set Width 110
Set Height 38
Set Theme "Dracula"
Set CursorBlink false
Set TypingSpeed 60ms

# Short pause before starting
Sleep 800ms

# Type the command
Type "ticketlens PROJ-123"
Sleep 400ms
Enter

# Wait for banner + API call + brief output
Sleep 7s

# Let the output sit so it's readable
Sleep 2s
