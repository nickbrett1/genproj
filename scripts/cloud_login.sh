#!/bin/bash
set -e

# Determine the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The project root directory is one level up from the scripts directory
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Change to the project root directory so that relative paths work correctly
cd "$PROJECT_ROOT"

# Doppler login first: it is the critical path for goose (and the wrangler /
# google-cloud sections below depend on it). Tailscale is optional SSH access
# and its interactive 'tailscale up' prompt must not block the rest.

# Doppler login/setup
if command -v doppler &> /dev/null; then
  if doppler whoami &> /dev/null 2>&1; then
    echo "✅ Already logged in to Doppler."
  else
    echo "INFO: Logging into Doppler (browser flow)..."
    echo "      If a browser does not open, copy the URL and auth code printed above into"
    echo "      your browser to complete the login, then return here."
    if doppler login --no-check-version --yes; then
      echo "✅ Doppler login successful."
      if doppler setup --no-interactive --project genproj --config dev; then
        echo "✅ Doppler project genproj/dev configured."
      else
        echo "WARN: doppler setup failed for genproj/dev - the project may not"
        echo "      exist yet. Create it at https://dashboard.doppler.com, then run:"
        echo "      doppler setup --no-interactive --project genproj --config dev"
      fi
    else
      echo "❌ Doppler login did not complete. Re-run this script (or 'doppler login'),"
      echo "   or authenticate with a service token:  export DOPPLER_TOKEN=dp.st.<token>"
    fi
  fi
else
  echo "⚠️  Doppler CLI not found. Skipping Doppler login - run 'goose' after the"
  echo "    devcontainer post-create setup finishes, or install the CLI manually."
fi

# Tailscale login
if command -v tailscale &> /dev/null; then
  if ! pgrep -x tailscaled > /dev/null; then
    echo "INFO: Starting Tailscale daemon..."
    sudo tailscaled --state=/var/lib/tailscale/tailscaled.state > /dev/null 2>&1 &
    sleep 2
  fi
  if ! sudo tailscale status &> /dev/null; then
    echo "INFO: Logging into Tailscale..."
    sudo tailscale up --hostname=genproj
  else
    echo "✅ Already logged in to Tailscale."
  fi
fi


echo
# Cloudflare Wrangler login
# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
  echo "Wrangler CLI not found. Installing globally with npm..."
  npm install -g wrangler
fi

# 1. Check if already logged in via Doppler API Token (Highly recommended for multi-container)
if doppler run --project genproj --config dev -- env | grep -q "CLOUDFLARE_API_TOKEN"; then
  echo "✅ Found CLOUDFLARE_API_TOKEN in Doppler. Using token for authentication."
  # Verify connectivity
  if ! doppler run --project genproj --config dev -- npx wrangler whoami 2>&1 | grep -q "You are not authenticated"; then
    echo "✅ Successfully authenticated via Doppler token. Skipping interactive login."
    exit 0
  else
    echo "⚠️ CLOUDFLARE_API_TOKEN found in Doppler but 'wrangler whoami' failed. Proceeding to interactive login..."
  fi
fi

# 2. Check if already logged in via OAuth session
if ! npx wrangler whoami 2>&1 | grep -q "You are not authenticated"; then
  echo "✅ Already logged in via OAuth session."
  exit 0
fi

WRANGLER_CALLBACK_PORT=${WRANGLER_CALLBACK_PORT:-8976}

# 3. Check for port conflicts inside the container
if ss -tuln | grep -q ":8976 "; then
  CONFLICT_PID=$(lsof -t -i:8976)
  echo "❌ Error: Port 8976 is already in use inside this container (PID: $CONFLICT_PID)."
  echo "   If this is a stale 'socat' process, you can kill it with: kill $CONFLICT_PID"
  exit 1
fi

# If we are using a non-standard port, we need to bridge the gap from 8976
if [ "$WRANGLER_CALLBACK_PORT" != "8976" ]; then
  echo "INFO: Using non-standard port $WRANGLER_CALLBACK_PORT. Bridging from 8976..."
  socat TCP-LISTEN:8976,fork,reuseaddr TCP:localhost:$WRANGLER_CALLBACK_PORT &
  SOCAT_PID=$!
  trap "kill $SOCAT_PID 2>/dev/null || true" EXIT
fi

echo "📢 IMPORTANT: Cloudflare OAuth ALWAYS redirects to localhost:8976 on your host machine."
echo "   If you have multiple containers, ensure port 8976 is forwarded to THIS container in VS Code."
echo "   (Check the 'Ports' tab in VS Code and ensure 8976 points to this project)"
echo

script -q -c "npx wrangler login --browser=false --callback-host=0.0.0.0 --callback-port=$WRANGLER_CALLBACK_PORT | stdbuf -oL sed 's/0\\.0\\.0\\.0/localhost/g'" /dev/null




echo
# Setup Wrangler configuration with environment variables
echo "Setting up Wrangler configuration..."
doppler run --project genproj --config dev -- ./scripts/setup-wrangler-config.sh dev

echo "Cloud login script finished."
