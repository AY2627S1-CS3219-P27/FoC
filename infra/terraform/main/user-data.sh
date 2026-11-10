#!/bin/bash
# Runs once, on the server's first boot.
set -euxo pipefail

# The NAT instance may still be booting; wait up to 10 minutes for the internet.
for _ in $(seq 120); do curl -fsS -o /dev/null https://github.com && break; sleep 5; done

dnf install -y docker git jq
systemctl enable --now docker

# Same Compose version as CI (.github/workflows/stack-smoke.yml).
mkdir -p /usr/libexec/docker/cli-plugins
curl -fsSL -o /usr/libexec/docker/cli-plugins/docker-compose \
  https://github.com/docker/compose/releases/download/v5.5.1/docker-compose-linux-x86_64
chmod +x /usr/libexec/docker/cli-plugins/docker-compose

# The foc-deploy command (deploy.tf) fetches and checks out each release here.
git clone https://github.com/AY2627S1-CS3219-P27/FoC.git /opt/foc
