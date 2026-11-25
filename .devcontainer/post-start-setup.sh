#!/bin/bash
# This file is executed every time the dev container starts up or resumes.
# It automatically checks if tailscaled and sshd are running and starts them if not.
#
# NOTE (2026-11-25): the socat tunnel that used to live here has been REMOVED.
# It could not have reached a browser. Measured in this container:
# `host.docker.internal` does not resolve — getent exits 2 and Node reports
# ENOTFOUND; /etc/resolv.conf is tailscale-generated and points at 100.100.100.100
# with tailscaled running in-container. So socat's connect() could never leave
# the container.
# Even with a resolvable host alias it would have targeted itself: VS Code's
# SharedProcessTunnelService auto-forwards any port a container listens on back
# to the host, so the chain would have been
#   container socat -> host 127.0.0.1:9222 (VS Code) -> container 9222 -> socat.
# Its listener on container 9222 is auto-forwarded to host 9222, which is where
# the shared Chrome CDP endpoint must bind. The CDP endpoint is now addressed as
# http://0.250.250.254:9222 (OrbStack's fixed host alias). Do NOT reintroduce this
# tunnel, and do not repoint it to another port: any port a container listens on
# is auto-forwarded, so the loop returns.

echo "INFO: Checking SSH service status..."
if ! pgrep -x sshd >/dev/null; then
    echo "INFO: SSH service not running. Starting it..."
    sudo service ssh restart
fi

echo "INFO: Checking Tailscale status..."
if ! pgrep -x tailscaled >/dev/null; then
    echo "INFO: Tailscale daemon not running. Starting it..."
    sudo start-stop-daemon --start --background --oknodo --pidfile /var/run/tailscaled.pid --make-pidfile --exec /usr/sbin/tailscaled -- --state=/var/lib/tailscale/tailscaled.state
fi

echo "INFO: Checking goose version..."
if command -v goose >/dev/null 2>&1; then
    # `goose update` downloads the whole release even when the installed build
    # is already current (~55MB, ~10s on every start). Ask GitHub for the
    # latest stable tag and update only when it differs. Any failure here
    # (offline, rate-limited, unparseable, no curl) leaves `latest` empty and
    # falls back to updating, which is the old behaviour.
    installed="$(goose --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
    latest="$(curl -fsSL --max-time 10 https://api.github.com/repos/block/goose/releases/latest 2>/dev/null \
        | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1)"
    if [ -n "$installed" ] && [ "$installed" = "$latest" ]; then
        echo "INFO: goose $installed is already the latest stable release - skipping update."
    else
        echo "INFO: goose ${installed:-unknown} -> ${latest:-latest} - updating..."
        goose update || echo "WARN: goose update failed, keeping current version"
    fi
else
    echo "WARN: goose not found, skipping update"
fi

echo "INFO: Checking the container agent..."
if [ -x "/workspaces/genproj/scripts/agent-dev.sh" ]; then
    "/workspaces/genproj/scripts/agent-dev.sh" start || true
else
    echo "WARN: scripts/agent-dev.sh not found, skipping the container agent"
fi


echo "INFO: Services check/startup complete."
