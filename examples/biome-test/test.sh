#!/bin/bash
set -e

echo "Running biome check..."
npx biome check --formatter-enabled=false --linter-enabled=true --reporter=json src/ > /tmp/biome-output.json

echo "Validating diagnostics..."
node validate.mjs /tmp/biome-output.json

echo "✓ All rules validated"
