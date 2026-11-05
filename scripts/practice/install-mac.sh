#!/bin/bash
# Install (or update) the practice server on a Mac as a launchd agent that starts at
# login and restarts if it stops. Run on the Mac from the folder that has
# karaoke-practice (npm run build:practice copies this script next to it):
#
#   bash install-mac.sh [library folder] [port]
#
# Defaults: ~/Data/20_Assets/Karaoke and port 5280 (http), with https on the next
# port (5281). Others on the home network open http://<this Mac's name>.local:5280/;
# the page links to the CA certificate to install once per device, after which
# https works (browsers only allow the key change on https).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
library="${1:-$HOME/Data/20_Assets/Karaoke}"
port="${2:-5280}"
tls_port=$((port + 1))
label="io.github.yuutatsubasa.karaoke-practice"
app="$HOME/Library/Application Support/KaraokePractice"
tls="$app/tls"
plist="$HOME/Library/LaunchAgents/$label.plist"

mkdir -p "$app" "$library" "$tls" "$HOME/Library/LaunchAgents"
chmod 700 "$tls"
library="$(cd "$library" && pwd)" # launchd does not start in this folder
install -m 755 "$here/karaoke-practice" "$app/karaoke-practice"
# A stable ad-hoc signature, so the macOS firewall remembers its decision.
codesign --force --sign - "$app/karaoke-practice"

# --- https: a CA of its own (made once, kept) and a server certificate for this
# Mac's names and current addresses (made again on every install). Apple devices
# accept server certificates of at most 825 days.
host="$(scutil --get LocalHostName)"
if [ ! -f "$tls/ca.key" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -sha256 \
    -keyout "$tls/ca.key" -out "$tls/ca.crt" \
    -subj "/CN=Karaoke practice on $host" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  chmod 600 "$tls/ca.key"
fi
san="DNS:$host.local,DNS:$(echo "$host" | tr '[:upper:]' '[:lower:]').local,DNS:$(echo "$host" | tr '[:upper:]' '[:lower:]'),DNS:localhost,IP:127.0.0.1"
for ifc in en0 en1; do
  ip="$(ipconfig getifaddr "$ifc" 2>/dev/null || true)"
  [ -n "$ip" ] && san="$san,IP:$ip"
done
cat >"$tls/server.ext" <<EOF
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san
EOF
openssl req -newkey rsa:2048 -nodes -keyout "$tls/server.key" -out "$tls/server.csr" -subj "/CN=$host.local" 2>/dev/null
openssl x509 -req -in "$tls/server.csr" -CA "$tls/ca.crt" -CAkey "$tls/ca.key" -CAcreateserial \
  -days 800 -sha256 -extfile "$tls/server.ext" -out "$tls/server.crt" 2>/dev/null
chmod 600 "$tls/server.key"

# Paths go into XML: escape &, < and >.
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

cat >"$plist.new" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$app/karaoke-practice")</string>
    <string>-practice</string>
    <string>-listen</string><string>:$port</string>
    <string>-library</string><string>$(xml "$library")</string>
    <string>-profiles</string><string>$(xml "$app/profiles.json")</string>
    <string>-tls-cert</string><string>$(xml "$tls/server.crt")</string>
    <string>-tls-key</string><string>$(xml "$tls/server.key")</string>
    <string>-tls-listen</string><string>:$tls_port</string>
    <string>-ca-cert</string><string>$(xml "$tls/ca.crt")</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$(xml "$app/server.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$app/server.log")</string>
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
  echo "(again after each update: a new build has a new signature)"
  echo "  sudo $fw --add \"$app/karaoke-practice\" && sudo $fw --unblockapp \"$app/karaoke-practice\""
fi
echo "practice server: http://$host.local:$port/  https://$host.local:$tls_port/  (library: $library)"
