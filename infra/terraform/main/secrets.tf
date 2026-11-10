# Generated secrets, stored encrypted in SSM. Step 5's script writes them onto the server.
# SMTP credentials and the VAPID key aren't generated here; step 5 adds them by hand.

# No special characters: these end up inside connection URLs.
resource "random_password" "db_master" {
  length  = 32
  special = false
}

resource "random_password" "db" {
  for_each = var.db_services

  length  = 32
  special = false
}

resource "random_password" "rabbitmq" {
  for_each = var.broker_services

  length  = 32
  special = false
}

resource "random_password" "user_service_server_secret" {
  length  = 32
  special = false
}

resource "random_password" "grafana_admin" {
  length  = 32
  special = false
}

resource "tls_private_key" "jwt" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "aws_ssm_parameter" "db_master_password" {
  name  = "/foc/rds/master_password"
  type  = "SecureString"
  value = random_password.db_master.result
}

resource "aws_ssm_parameter" "db_password" {
  for_each = var.db_services

  name  = "/foc/${each.value}/db_password"
  type  = "SecureString"
  value = random_password.db[each.value].result
}

resource "aws_ssm_parameter" "rabbitmq_password" {
  for_each = var.broker_services

  name  = "/foc/${each.value}/rabbitmq_password"
  type  = "SecureString"
  value = random_password.rabbitmq[each.value].result
}

resource "aws_ssm_parameter" "user_service_server_secret" {
  name  = "/foc/user-service/server_secret"
  type  = "SecureString"
  value = random_password.user_service_server_secret.result
}

# Log in to Grafana as admin with this, through the SSM tunnel to port 3005.
resource "aws_ssm_parameter" "grafana_admin_password" {
  name  = "/foc/grafana/admin_password"
  type  = "SecureString"
  value = random_password.grafana_admin.result
}

resource "aws_ssm_parameter" "jwt_private_key" {
  name  = "/foc/user-service/jwt_private_key"
  type  = "SecureString"
  value = tls_private_key.jwt.private_key_pem
}

resource "aws_ssm_parameter" "jwt_public_key" {
  name  = "/foc/user-service/jwt_public_key"
  type  = "String"
  value = tls_private_key.jwt.public_key_pem
}

resource "aws_ssm_parameter" "db_host" {
  name  = "/foc/rds/host"
  type  = "String"
  value = aws_db_instance.main.address
}
