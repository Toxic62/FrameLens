#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

NODE_VERSION="24.14.0"
RUNTIME_DIR="$ROOT_DIR/.framelens-runtime/node"
NODE_BIN="$RUNTIME_DIR/bin/node"
NPM_BIN="$RUNTIME_DIR/bin/npm"

if [[ ! -x "$NPM_BIN" ]]; then
  OS_NAME="$(uname -s | tr '[:upper:]' '[:lower:]')"
  CPU_ARCH="$(uname -m)"
  case "$CPU_ARCH" in
    x86_64) NODE_ARCH="x64" ;;
    arm64) NODE_ARCH="arm64" ;;
    *) echo "Unsupported CPU architecture: $CPU_ARCH"; exit 1 ;;
  esac

  if [[ "$OS_NAME" != "darwin" ]]; then
    echo "This launcher currently bootstraps Node automatically on macOS only."
    echo "Install Node.js, then run: npm run dev"
    exit 1
  fi

  mkdir -p "$RUNTIME_DIR"
  TMP_ARCHIVE="$ROOT_DIR/.framelens-runtime/node.tar.gz"
  NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${OS_NAME}-${NODE_ARCH}.tar.gz"
  echo "Downloading Node.js ${NODE_VERSION}..."
  curl -fsSL "$NODE_URL" -o "$TMP_ARCHIVE"
  tar -xzf "$TMP_ARCHIVE" -C "$RUNTIME_DIR" --strip-components=1
fi

export PATH="$RUNTIME_DIR/bin:$PATH"

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "Installing FrameLens dependencies..."
  "$NPM_BIN" install
fi

if [[ -d "$ROOT_DIR/node_modules/@rollup" ]]; then
  find "$ROOT_DIR/node_modules/@rollup" -name 'rollup.*.node' -exec codesign --force --sign - {} \; >/dev/null 2>&1 || true
fi

if [[ -f "$ROOT_DIR/node_modules/electron/install.js" && ! -d "$ROOT_DIR/node_modules/electron/dist" ]]; then
  "$NODE_BIN" "$ROOT_DIR/node_modules/electron/install.js"
fi

echo "Starting FrameLens..."
"$NPM_BIN" run dev
