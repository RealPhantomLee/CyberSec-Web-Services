#!/bin/bash
# Run phantom-server from the build directory
BUILD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../backend/build" && pwd)"
exec "$BUILD_DIR/phantom-server"
