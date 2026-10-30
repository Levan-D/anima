# Source this from Git Bash before running the app or the test suites: . scripts/dev-env.sh
# Tool caches, temp files and app data then stay inside .dev/. Only the shell's own environment changes.

REPO="$(git rev-parse --show-toplevel)"

# An agent's shell inherits this from Claude Desktop. Electron then attaches to that app's crash
# handler, and a crashed renderer drops its dump in that app's folder instead of the --user-data-dir.
unset CHROME_CRASHPAD_PIPE_NAME

export LOCALAPPDATA="$REPO/.dev/localappdata"
export APPDATA="$REPO/.dev/appdata"
export TEMP="$REPO/.dev/tmp"
export TMP="$TEMP"
export TMPDIR="$TEMP"
export npm_config_cache="$LOCALAPPDATA/npm-cache"
export electron_config_cache="$LOCALAPPDATA/electron-cache"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export PLAYWRIGHT_BROWSERS_PATH="$LOCALAPPDATA/ms-playwright"

export MUSIC_PLAYER_DATA_DIR="$REPO/.dev/data"
export MUSIC_PLAYER_MPV_ARGS=--ao=null

mkdir -p "$LOCALAPPDATA" "$APPDATA" "$TEMP"
