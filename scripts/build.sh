#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
BUILD_DIR="$BACKEND_DIR/build"

echo "=== CyberSec Web Services — Backend Build ==="

# Check / install required system packages
if command -v apt-get &>/dev/null; then
    PKGS=(g++ cmake libssl-dev libcurl4-openssl-dev git)
    MISSING=()
    for pkg in "${PKGS[@]}"; do
        dpkg -s "$pkg" &>/dev/null || MISSING+=("$pkg")
    done
    if [ ${#MISSING[@]} -gt 0 ]; then
        echo "Installing missing packages: ${MISSING[*]}"
        sudo apt-get update -qq
        sudo apt-get install -y "${MISSING[@]}"
    fi
elif command -v pacman &>/dev/null; then
    echo "Arch Linux detected — ensure these are installed:"
    echo "  sudo pacman -S gcc cmake openssl curl git"
    echo "Continuing..."
else
    echo "Unknown package manager — ensure g++, cmake, openssl, curl, and git are installed."
fi

echo "All dependencies present."

# Configure + build
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

cmake "$BACKEND_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DFETCHCONTENT_QUIET=OFF

make -j"$(nproc)"

echo ""
echo "=== Build complete ==="
echo "Binary: $BUILD_DIR/phantom-server"
echo ""
echo "To run (must be from build dir): cd $BUILD_DIR && ./phantom-server"
