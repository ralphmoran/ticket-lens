# TicketLens — Pro tier: custom stale threshold demo
# Generates: docs/demos/pro-triage.gif
#
# Prerequisites:
#   brew install vhs
#   npm install -g ticketlens
#   ticketlens activate <your-pro-key>
#
# Usage:
#   vhs docs/demos/pro-triage.tape

Output docs/demos/pro-triage.gif

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

# Triage with aggressive stale threshold — flags tickets idle for 3+ days
Type "ticketlens triage --stale=3"
Sleep 400ms
Enter

# Wait for banner + API calls + interactive list
Sleep 9s

# Navigate through the list to show interactive UX
Down
Sleep 600ms
Down
Sleep 600ms
Down
Sleep 600ms

Sleep 1500ms

Up
Sleep 500ms
Up
Sleep 500ms

Sleep 1500ms

# Exit
Ctrl+C
Sleep 800ms
