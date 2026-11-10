#!/usr/bin/env bash
# Deploys one CI-built image tag (a 12-character commit ID): sudo scripts/deploy.sh <tag>
# Safe to re-run: every step skips or repeats harmlessly.
set -euo pipefail
cd "$(dirname "$0")/.."

export FOC_IMAGE_TAG="${1:?usage: scripts/deploy.sh <image-tag>}"
export AWS_REGION="${AWS_REGION:-ap-southeast-1}"
compose=(docker compose -f compose.yaml -f compose.prod.yaml)

param() {
  aws ssm get-parameter --name "/foc/$1" --with-decryption --query Parameter.Value --output text
}

# RDS starts with only the admin login, so each service's login and database are made here.
create_database() {
  local name="${1//-/_}" password
  password=$(param "$1/db_password")
  # The password goes in through the environment, as arguments show in the process list.
  ROLE_PASSWORD="$password" docker run --rm -i -e PGPASSWORD -e ROLE_PASSWORD postgres:18-alpine \
    psql -h "$rds_host" -U foc_admin -d postgres -q -v ON_ERROR_STOP=1 \
    -v role="$name" <<'SQL'
\getenv password ROLE_PASSWORD
SELECT format('CREATE ROLE %I LOGIN', :'role')
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'role', :'password') \gexec
SELECT format('GRANT %I TO CURRENT_USER', :'role') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'role', :'role')
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'role') \gexec
SQL
}

scripts/render-env-from-ssm.sh

rds_host=$(param rds/host)
PGPASSWORD=$(param rds/master_password)
export PGPASSWORD
for service in user-service supplier-service order-service credit-service comms-service notification-service; do
  create_database "$service"
done
unset PGPASSWORD

account_id=$(aws sts get-caller-identity --query Account --output text)
aws ecr get-login-password | docker login --username AWS --password-stdin "$account_id.dkr.ecr.$AWS_REGION.amazonaws.com"

"${compose[@]}" pull --quiet

# These two don't migrate on startup; the others do.
"${compose[@]}" run --rm --no-deps credit-service npm run migration:run:prod
"${compose[@]}" run --rm --no-deps comms-service npm run migration:run:prod

"${compose[@]}" up -d --wait --wait-timeout 300 --no-build --remove-orphans
"${compose[@]}" ps
