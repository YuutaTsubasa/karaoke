#!/bin/bash
# Install (or update) the practice server on a Mac as a launchd agent that starts at
# login and restarts if it stops. Run on the Mac from the folder that has
# karaoke-practice (npm run build:practice copies this script next to it):
#
#   bash install-mac.sh [library folder] [port]
#
# Defaults: ~/Data/20_Assets/Karaoke and port 5280. Others on the home network open
# http://<this Mac's name>.local:<port>/ in a browser.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
library="${1:-$HOME/Data/20_Assets/Karaoke}"
port="${2:-5280}"
label="io.github.yuutatsubasa.karaoke-practice"
app="$HOME/Library/Application Support/KaraokePractice"
plist="$HOME/Library/LaunchAgents/$label.plist"

mkdir -p "$app" "$library" "$HOME/Library/LaunchAgents"
install -m 755 "$here/karaoke-practice" "$app/karaoke-practice"
# A stable ad-hoc signature, so the macOS firewall remembers its decision.
codesign --force --sign - "$app/karaoke-practice"

# Paths go into XML: escape &, < and >.
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
bin_x="$(xml "$app/karaoke-practice")"
lib_x="$(xml "$library")"
log_x="$(xml "$app/server.log")"

cat >"$plist.new" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$bin_x</string>
    <string>-practice</string>
    <string>-listen</string><string>:$port</string>
    <string>-library</string><string>$lib_x</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$log_x</string>
  <key>StandardErrorPath</key><string>$log_x</string>
</dict>
</plist>
EOF

plutil -lint -s "$plist.new" # stop here, before unloading the running agent, if it is not valid
mv "$plist.new" "$plist"
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"

fw=/usr/libexec/ApplicationFirewall/socketfilterfw
if "$fw" --getglobalstate 2>/dev/null | grep -q enabled; then
  echo "The macOS firewall is on: allow incoming connections for $app/karaoke-practice"
  echo "  sudo $fw --add \"$app/karaoke-practice\" && sudo $fw --unblockapp \"$app/karaoke-practice\""
fi
echo "practice server: http://$(scutil --get LocalHostName).local:$port/  (library: $library)"
