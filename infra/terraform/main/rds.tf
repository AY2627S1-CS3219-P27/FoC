resource "aws_db_subnet_group" "main" {
  name       = "foc"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

# The services connect without TLS, which RDS rejects by default; traffic stays inside the VPC.
resource "aws_db_parameter_group" "main" {
  name   = "foc-postgres18"
  family = "postgres18"

  parameter {
    name         = "rds.force_ssl"
    value        = "0"
    apply_method = "immediate"
  }
}

resource "aws_db_instance" "main" {
  identifier     = "foc"
  engine         = "postgres"
  engine_version = "18"
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  username = "foc_admin"
  password = random_password.db_master.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  parameter_group_name   = aws_db_parameter_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  availability_zone      = local.az_a
  publicly_accessible    = false

  backup_retention_period = 1

  # Sandbox settings: the account is temporary, so the database may be destroyed freely.
  skip_final_snapshot = true
  deletion_protection = false
}
