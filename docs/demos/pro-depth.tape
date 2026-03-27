# TicketLens — Pro tier: deep traversal demo
# Generates: docs/demos/pro-depth.gif
#
# Prerequisites:
#   brew install vhs
#   npm install -g ticketlens
#   ticketlens activate <your-pro-key>
#
# Usage:
#   vhs docs/demos/pro-depth.tape

Output docs/demos/pro-depth.gif

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

# Fetch with depth=2 — pulls linked tickets and their linked tickets
Type "ticketlens CNV1-2 --depth=2"
Sleep 400ms
Enter

# Deep traversal takes longer — wait for banner + 2 levels of API calls
Sleep 14s

# Let the full brief sit so it's readable
Sleep 3s
