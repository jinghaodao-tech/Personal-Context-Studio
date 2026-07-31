#!/usr/bin/env bash
set -eu
ROOT="${PCS_ROOT:-$HOME/Personal-Context-Studio}"
LABEL="com.personalcontextstudio.supervisor"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$(dirname "$PLIST")" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>WorkingDirectory</key><string>$ROOT</string>
<key>ProgramArguments</key><array><string>/usr/bin/env</string><string>npm</string><string>run</string><string>dev:supervisor</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$HOME/Library/Logs/$LABEL.log</string>
<key>StandardErrorPath</key><string>$HOME/Library/Logs/$LABEL.error.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL for $ROOT"
