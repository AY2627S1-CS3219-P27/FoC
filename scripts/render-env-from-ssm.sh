#!/usr/bin/env bash
# Writes .env, env/*.env, the *.secret files and the RabbitMQ definitions from SSM.
# Runs on the server as root; everything it writes is git-ignored.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 022
export AWS_REGION="${AWS_REGION:-ap-southeast-1}"

params=$(aws ssm get-parameters-by-path --path /foc/ --recursive --with-decryption \
  --query 'Parameters[].{name:Name,value:Value}' --output json)

value() {
  jq -er --arg name "/foc/$1" '.[] | select(.name == $name) | .value' <<<"$params" ||
    { echo "Missing SSM parameter /foc/$1" >&2; return 1; }
}

# Containers read secrets as non-root, so files stay readable and their folder is root-only.
put_secret() {
  local secret
  secret=$(value "$2")
  mkdir -p "$(dirname "$1")"
  chmod 700 "$(dirname "$1")"
  printf %s "$secret" >"$1"
  chmod 644 "$1"
}

set_env() {
  sed -i "/^$2=/d" "$1"
  printf '%s=%s\n' "$2" "$3" >>"$1"
}

rds_host=$(value rds/host)
account_id=$(aws sts get-caller-identity --query Account --output text)

# The CloudFront HTTPS address (cdn.tf); the server has no public address of its own.
public_url=$(value public_url)

cat >.env <<EOF
ECR_REGISTRY=$account_id.dkr.ecr.$AWS_REGION.amazonaws.com
RDS_HOST=$rds_host
EOF

for f in env/*.env.example; do cp "$f" "${f%.example}"; done

set_env env/shared.env NODE_ENV production
# These two examples set NODE_ENV again, which would override shared.env.
set_env env/supplier-service.env NODE_ENV production
set_env env/rag-service.env NODE_ENV production

set_env env/user-service.env USER_SERVICE_DB_HOST "$rds_host"
set_env env/user-service.env USER_SERVICE_DB_USERNAME user_service
set_env env/user-service.env USER_SERVICE_DB_DATABASE user_service
# user-service has no migrations, so TypeORM's synchronize is what creates its tables.
set_env env/user-service.env USER_SERVICE_DB_SYNCHRONIZE true
set_env env/user-service.env FRONTEND_BASE_URL "$public_url"

set_env env/order-service.env ORDER_SERVICE_DB_HOST "$rds_host"
set_env env/order-service.env ORDER_SERVICE_DB_SYNCHRONIZE false
set_env env/credit-service.env CREDIT_SERVICE_DB_HOST "$rds_host"
set_env env/comms-service.env COMMS_SERVICE_DB_HOST "$rds_host"
set_env env/comms-service.env SOCKET_ALLOWED_ORIGINS "$public_url"
set_env env/notification-service.env NOTIFICATION_SERVICE_DB_HOST "$rds_host"
set_env env/notification-service.env NOTIFICATION_SERVICE_VAPID_PUBLIC_KEY "$(value notification-service/vapid_public_key)"

put_secret user-service/secrets/db_password.secret user-service/db_password
put_secret user-service/secrets/server_secret.secret user-service/server_secret
put_secret user-service/secrets/jwt_private_key.secret user-service/jwt_private_key
put_secret user-service/secrets/jwt_public_key.secret user-service/jwt_public_key
put_secret user-service/secrets/rabbitmq_user_password.secret user-service/rabbitmq_password
put_secret order-service/secrets/order_db_password.secret order-service/db_password
put_secret order-service/secrets/rabbitmq_password.secret order-service/rabbitmq_password
put_secret credit-service/secrets/credit_db_password.secret credit-service/db_password
put_secret credit-service/secrets/rabbitmq_password.secret credit-service/rabbitmq_password
put_secret supplier-service/secrets/supplier_db_password.secret supplier-service/db_password
put_secret supplier-service/secrets/rabbitmq_password.secret supplier-service/rabbitmq_password
put_secret comms-service/secrets/comms_db_password.secret comms-service/db_password
put_secret comms-service/secrets/rabbitmq_password.secret comms-service/rabbitmq_password
put_secret notification-service/secrets/notification_db_password.secret notification-service/db_password
put_secret notification-service/secrets/rabbitmq_notification_password.secret notification-service/rabbitmq_password
put_secret notification-service/secrets/vapid_private_key.secret notification-service/vapid_private_key
put_secret email-service/secrets/rabbitmq_email_password.secret email-service/rabbitmq_password
put_secret rag-service/secrets/rag_db_password.secret rag-service/db_password
# Added to SSM by hand, so it never enters Terraform state.
put_secret rag-service/secrets/openrouter_api_key.secret rag-service/openrouter_api_key

# Papercut accepts any login, so this is unused until a real SMTP provider is set up.
mkdir -p email-service/secrets
chmod 700 email-service/secrets
printf unused >email-service/secrets/smtp_password.secret

# Plaintext passwords are hashed by RabbitMQ on import; guest and its admin rights are dropped.
mkdir -p rabbitmq/secrets
chmod 700 rabbitmq/secrets
jq --argjson params "$params" '
  ($params | map({key: .name, value: .value}) | from_entries) as $ssm
  | .permissions |= map(select(.user != "guest"))
  | .users |= map(
      select(.name != "guest")
      | .name as $name
      | $ssm["/foc/\($name)/rabbitmq_password"] as $password
      | if $password == null then error("no SSM RabbitMQ password for user: \($name)") else . end
      | del(.password_hash, .hashing_algorithm)
      | .password = $password
    )
' rabbitmq/definitions.json >rabbitmq/secrets/definitions.prod.secret
chmod 644 rabbitmq/secrets/definitions.prod.secret

echo "Rendered config for $public_url"
