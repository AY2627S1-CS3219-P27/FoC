#!/bin/bash
# Runs once, on the server's first boot.
set -euxo pipefail

dnf install -y docker git jq
systemctl enable --now docker

# Same Compose version as CI (.github/workflows/stack-smoke.yml).
mkdir -p /usr/libexec/docker/cli-plugins
curl -fsSL -o /usr/libexec/docker/cli-plugins/docker-compose \
  https://github.com/docker/compose/releases/download/v5.5.1/docker-compose-linux-x86_64
chmod +x /usr/libexec/docker/cli-plugins/docker-compose

mkdir -p /opt/foc
