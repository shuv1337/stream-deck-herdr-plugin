#!/usr/bin/env bash
# Install/rebuild the herdr Stream Deck plugin for OpenDeck (Linux).
#
#   scripts/install-opendeck.sh                 # build + install the plugin
#   scripts/install-opendeck.sh --profile       # …and write the full-deck profile
#   scripts/install-opendeck.sh --restart       # …and restart OpenDeck
#
# The profile step auto-detects the single connected device from
# ~/.config/opendeck/profiles/<device>.json; pass DEVICE=sd-… to pick one, and
# COLUMNS/ROWS to override the 8×4 XL layout.
set -euo pipefail
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PLUGIN_ID="dev.timvdhoorn.herdr-agents.sdPlugin"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
DEST="$CONFIG_HOME/opendeck/plugins/$PLUGIN_ID"

WRITE_PROFILE=0
RESTART=0
for arg in "$@"; do
  case "$arg" in
    --profile) WRITE_PROFILE=1 ;;
    --restart) RESTART=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

export PATH="${HOME}/.bun/bin:${PATH}"
cd "$REPO"
bun install --frozen-lockfile 2>/dev/null || bun install
bun test
bun run build
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -a "$REPO/$PLUGIN_ID" "$DEST"
rm -rf "$DEST/logs"
echo "Installed → $DEST"

if [[ "$WRITE_PROFILE" == 1 ]]; then
  if [[ -z "${DEVICE:-}" ]]; then
    mapfile -t devices < <(find "$CONFIG_HOME/opendeck/profiles" -maxdepth 1 -name 'sd-*.json' -printf '%f\n' | sed 's/\.json$//')
    if [[ ${#devices[@]} -ne 1 ]]; then
      echo "Set DEVICE=<id>; found: ${devices[*]:-none}" >&2
      exit 1
    fi
    DEVICE="${devices[0]}"
  fi
  bun scripts/opendeck-profile.ts --device "$DEVICE" --profile "${PROFILE:-herdr}" \
    --columns "${COLUMNS:-8}" --rows "${ROWS:-4}" --write
fi

if [[ "$RESTART" == 1 ]]; then
  if pgrep -x opendeck >/dev/null; then
    pkill -x opendeck || true
    for _ in $(seq 1 20); do pgrep -x opendeck >/dev/null || break; sleep 0.25; done
  fi
  launcher="$HOME/.local/bin/opendeck-hidpi"
  if [[ -x "$launcher" || -f "$launcher" ]]; then
    # Agent shells point DISPLAY at the Xvfb server; OpenDeck must land on the real session.
    DISPLAY=":0" WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}" setsid bash "$launcher" >/dev/null 2>&1 < /dev/null &
  else
    setsid opendeck >/dev/null 2>&1 < /dev/null &
  fi
  echo "OpenDeck restarted."
else
  echo "Restart OpenDeck (or toggle the plugin in Settings → Plugins) to load the new build."
fi
