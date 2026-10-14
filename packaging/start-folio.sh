#!/bin/sh
#
# Start Folio and open it in your browser.
#
# Double-click this file (on macOS the copy called `start-folio.command`), or run
# it from a terminal. Leave the window open while you read; close it to stop.
#
# No arguments are needed. To change where your books are kept, or which port is
# used, set FOLIO_HOME or PORT before running it.

set -e

HERE=$(cd "$(dirname "$0")" && pwd)
APP="$HERE/app"

# Where your books, covers and reading data live.
#
# Deliberately outside the app folder: replacing the app must never lose your
# library, and on macOS an app in /Applications may not be writable at all.
FOLIO_HOME="${FOLIO_HOME:-$HOME/Folio}"
export FOLIO_HOME
mkdir -p "$FOLIO_HOME/content" "$FOLIO_HOME/covers"

# The catalogue shipped alongside this launcher, opened read-only.
if [ -f "$HERE/catalogue.db" ]; then
  NOVEL_READER_CATALOGUE_DB="$HERE/catalogue.db"
  export NOVEL_READER_CATALOGUE_DB
fi

# Optional: absent in the default download, because its upstream licences are
# more restrictive than the rest of the app. Folio works without it.
if [ -f "$HERE/mangabaka.db" ]; then
  NOVEL_READER_MANGABAKA_DB="$HERE/mangabaka.db"
  export NOVEL_READER_MANGABAKA_DB
fi

PORT="${PORT:-3100}"
export PORT

if ! command -v node >/dev/null 2>&1; then
  echo "Folio needs Node.js, and it does not look like it is installed."
  echo
  echo "Get the LTS version from https://nodejs.org, install it, then run this"
  echo "file again."
  echo
  printf "Press return to close."
  read -r _ || true
  exit 1
fi

URL="http://localhost:$PORT"

echo "Folio is starting at $URL"
echo "Your books are kept in $FOLIO_HOME"
echo
echo "Leave this window open while you read. Close it to stop Folio."
echo

# Wait for the server, then open the browser. Starting it in the background means
# the server is still the foreground process, so Ctrl-C and closing the window
# both stop it.
(
  tries=0
  while [ "$tries" -lt 60 ]; do
    if node -e "
      const socket = require('node:net').connect($PORT, '127.0.0.1');
      socket.on('connect', () => { socket.end(); process.exit(0); });
      socket.on('error', () => process.exit(1));
    " 2>/dev/null; then
      case "$(uname -s)" in
        Darwin) open "$URL" 2>/dev/null || true ;;
        Linux) xdg-open "$URL" 2>/dev/null || true ;;
      esac
      exit 0
    fi
    tries=$((tries + 1))
    sleep 0.25
  done
) &

cd "$APP"
exec node server.js
