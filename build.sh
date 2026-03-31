#!/usr/bin/env bash
# Guang Code build script
set -e

echo "  Building Guang Code..."
npx tsc

# Add shebang to main entry
MAIN="dist/main.js"
if ! head -1 "$MAIN" | grep -q "#!/usr/bin/env node"; then
  echo '#!/usr/bin/env node' | cat - "$MAIN" > /tmp/gc_main_tmp && mv /tmp/gc_main_tmp "$MAIN"
fi
chmod +x "$MAIN"

echo "  Build complete → dist/main.js"
echo ""
echo "  Run with:"
echo "    ANTHROPIC_API_KEY=sk-ant-... node dist/main.js"
echo "    node dist/main.js --help"
