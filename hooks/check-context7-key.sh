#!/bin/bash
# Reminds a developer once per session if CONTEXT7_API_KEY isn't set.
# This can only detect and inform — a hook can't export a variable back into
# the parent Claude Code process, so there's no way around the developer
# setting it in their shell profile and restarting Claude Code themselves.
if [ -z "$CONTEXT7_API_KEY" ]; then
  cat <<'EOF'
⚠️  CONTEXT7_API_KEY is not set — Context7 is running on the shared anonymous
   rate limit. To use your own quota:
     1. Create a key: https://context7.com/dashboard
     2. Add to your shell profile: export CONTEXT7_API_KEY="your-key"
     3. Restart Claude Code
EOF
fi
