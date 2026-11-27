#!/usr/bin/env bash
set -euo pipefail

echo "Running unit tests with coverage..."
pnpm exec nx run platform:test --watch=false --coverage

echo ""
echo "Running contract tests..."
pnpm exec vitest run --config contracts/vitest.config.ts

echo ""
echo "All test suites passed."
