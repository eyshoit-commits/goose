#!/usr/bin/env bash
set -euo pipefail

# This script bootstraps the goose desktop UI so it can run inside a regular browser.
# It is based on https://gist.github.com/khronokernel/122dc28114d3a3b1673fa0423b5a9b39
# but integrates tightly with the repository layout and secure defaults used by goose.

print_help() {
  cat <<'USAGE'
Usage: scripts/run-browser-ui.sh [options]

Options:
  --base-url <url>      Override the backend base URL exposed to the browser UI.
                        Defaults to https://127.0.0.1:8443
  --secret <token>      Provide the API token shared between the UI and backend.
                        Defaults to an empty token.
  --working-dir <path>  Set the working directory exposed through the shim.
  --no-install          Skip running npm install before launching Vite.
  -h, --help            Show this help message and exit.

Any additional arguments after `--` are forwarded to `npm run start-browser`.
USAGE
}

BASE_URL="${GOOSE_BROWSER_BASE_URL:-https://127.0.0.1:8443}"
SECRET="${GOOSE_BROWSER_SECRET:-}"
WORKING_DIR="${GOOSE_BROWSER_WORKING_DIR:-}"
RUN_INSTALL=1
FORWARDED_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      [[ $# -lt 2 ]] && { echo "Missing value for --base-url" >&2; exit 1; }
      BASE_URL="$2"
      shift 2
      ;;
    --secret)
      [[ $# -lt 2 ]] && { echo "Missing value for --secret" >&2; exit 1; }
      SECRET="$2"
      shift 2
      ;;
    --working-dir)
      [[ $# -lt 2 ]] && { echo "Missing value for --working-dir" >&2; exit 1; }
      WORKING_DIR="$2"
      shift 2
      ;;
    --no-install)
      RUN_INSTALL=0
      shift
      ;;
    --help|-h)
      print_help
      exit 0
      ;;
    --)
      shift
      FORWARDED_ARGS=("${@}")
      break
      ;;
    *)
      echo "Unknown option: $1" >&2
      print_help >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
UI_DIR="${ROOT_DIR}/ui/desktop"

if [[ ! -d "${UI_DIR}" ]]; then
  echo "Unable to find ui/desktop directory" >&2
  exit 1
fi

if [[ ${RUN_INSTALL} -eq 1 ]]; then
  echo "Installing npm dependencies (skip with --no-install)..."
  (cd "${UI_DIR}" && npm install)
fi

echo "Launching goose browser UI"
export VITE_GOOSE_BASE_URL="${BASE_URL}"
export VITE_GOOSE_SECRET="${SECRET}"
if [[ -n "${WORKING_DIR}" ]]; then
  export VITE_GOOSE_WORKING_DIR="${WORKING_DIR}"
else
  unset VITE_GOOSE_WORKING_DIR || true
fi

cd "${UI_DIR}"
if [[ ${#FORWARDED_ARGS[@]} -gt 0 ]]; then
  npm run start-browser -- "${FORWARDED_ARGS[@]}"
else
  npm run start-browser
fi
