# TicketLens — Teams tier: automated digest demo
# Generates: docs/demos/teams-digest.gif
#
# Demonstrates the scripting/cron use case — pipe triage output to a file,
# just like a scheduled morning digest would work.
#
# Prerequisites:
#   brew install vhs
#   npm install -g ticketlens
#
# Usage:
#   vhs docs/demos/teams-digest.tape

Output docs/demos/teams-digest.gif

Set FontSize 14
Set Width 1200
Set Height 700
Set Padding 40
Set Margin 20
Set MarginFill "#1e1f29"
Set WindowBar Colorful
Set WindowBarSize 40
Set BorderRadius 12
Set Theme "Dracula"
Set CursorBlink false
Set TypingSpeed 60ms
Set Framerate 30

Sleep 800ms

# Pipe triage output to a file — the cron digest pattern
Type "ticketlens triage --plain > ~/morning-digest.md"
Sleep 400ms
Enter

# Wait for the API call to complete
Sleep 9s

Sleep 800ms

# Show the file was created
Type "cat ~/morning-digest.md"
Sleep 400ms
Enter

Sleep 2s

# Show the cron job that automates this every morning
Sleep 800ms
Type "# Automate with cron: runs 9am Mon-Fri"
Sleep 400ms
Enter
Sleep 400ms
Type "# 0 9 * * 1-5 ticketlens triage --plain > ~/digest-$(date +%F).md"
Sleep 400ms
Enter

Sleep 2s
