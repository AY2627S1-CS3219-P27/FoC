#!/usr/bin/env bash
# Throwaway env/secrets for a CI smoke run of the full compose stack.
# Overwrites rabbitmq/definitions.json in the working tree (plaintext users in
# place of the committed hashes) — only run this on a disposable checkout.
set -euo pipefail
cd "$(dirname "$0")/.."

gen() { openssl rand -hex 16 | tr -d '\r\n'; }
put() { mkdir -p "$(dirname "$1")"; printf %s "$2" > "$1"; }

# Env files: the examples are complete; just drop the suffix.
for f in env/*.env.example; do cp "$f" "${f%.example}"; done
cp supplier-service/.env.example supplier-service/.env

# Passwords with no external dependency.
put user-service/secrets/db_password.secret "$(gen)"
put user-service/secrets/server_secret.secret "$(gen)"
put order-service/secrets/order_db_password.secret "$(gen)"
put credit-service/secrets/credit_db_password.secret "$(gen)"
put supplier-service/secrets/supplier_db_password.secret "$(gen)"
put email-service/secrets/smtp_password.secret "$(gen)"

# RS256 keypair. credit-service/compose.yml reads the public key from
# user-service/jwt_public_key.secret (not secrets/), so write both locations.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out user-service/secrets/jwt_private_key.secret 2>/dev/null
openssl pkey -in user-service/secrets/jwt_private_key.secret -pubout -out user-service/secrets/jwt_public_key.secret
cp user-service/secrets/jwt_public_key.secret user-service/jwt_public_key.secret

# RabbitMQ: random password per broker user, written to the service secret and
# to definitions.json as plaintext (RabbitMQ hashes it on import).
user_pw=$(gen); email_pw=$(gen); order_pw=$(gen); credit_pw=$(gen); guest_pw=$(gen)
put user-service/secrets/rabbitmq_user_password.secret "$user_pw"
put email-service/secrets/rabbitmq_email_password.secret "$email_pw"
put order-service/secrets/rabbitmq_password.secret "$order_pw"
put credit-service/secrets/rabbitmq_password.secret "$credit_pw"

jq --arg u "$user_pw" --arg e "$email_pw" --arg o "$order_pw" --arg c "$credit_pw" --arg g "$guest_pw" '
  .users |= map(
    del(.password_hash, .hashing_algorithm)
    | .password = ({"user-service":$u,"email-service":$e,"order-service":$o,
                    "credit-service":$c,"guest":$g}[.name])
  )' rabbitmq/definitions.json > rabbitmq/definitions.json.tmp
mv rabbitmq/definitions.json.tmp rabbitmq/definitions.json
