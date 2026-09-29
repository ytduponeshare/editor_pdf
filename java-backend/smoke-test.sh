#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${JAVA_PDF_URL:-http://127.0.0.1:3202}"
OUTPUT_DIR="$SCRIPT_DIR/target/smoke"
mkdir -p "$OUTPUT_DIR"

curl --fail --silent --show-error "$BASE_URL/api/health"
curl --fail --silent --show-error \
  -H 'Content-Type: text/html; charset=utf-8' \
  --data-binary "@$SCRIPT_DIR/smoke/html-template.html" \
  "$BASE_URL/api/pdf/html" \
  --output "$OUTPUT_DIR/html-java-chromium.pdf"

test "$(head -c 4 "$OUTPUT_DIR/html-java-chromium.pdf")" = '%PDF'
file "$OUTPUT_DIR/html-java-chromium.pdf"
