#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRAG_ROOT="$(dirname "$SCRIPT_DIR")"
EXAMPLES_DIR="$CRAG_ROOT/examples"

PASS=0
FAIL=0
SKIP=0

echo "=== Validating example apps ==="

for example_dir in "$EXAMPLES_DIR"/*/; do
  example_name=$(basename "$example_dir")
  
  # Skip if no tsconfig.json
  if [ ! -f "$example_dir/tsconfig.json" ]; then
    echo "  SKIP  $example_name (no tsconfig.json)"
    SKIP=$((SKIP + 1))
    continue
  fi
  
  # Skip if no generated client directory
  if [ ! -d "$example_dir/src/client" ]; then
    echo "  SKIP  $example_name (no generated client)"
    SKIP=$((SKIP + 1))
    continue
  fi
  
  echo -n "  CHECK $example_name... "
  
  # Run tsc -b in the example directory
  if (cd "$example_dir" && npx tsc -b --noEmit 2>/dev/null); then
    echo "PASS"
    PASS=$((PASS + 1))
  else
    echo "FAIL"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "=== Summary ==="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "  Skipped: $SKIP"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "ERROR: Some examples failed type checking!"
  exit 1
fi

echo ""
echo "All examples passed type checking."
