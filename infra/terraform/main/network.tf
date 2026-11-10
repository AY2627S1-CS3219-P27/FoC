data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  az_a = data.aws_availability_zones.available.names[0]
  az_b = data.aws_availability_zones.available.names[1]
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  # CloudFront's VPC origin addresses the server by its DNS name.
  enable_dns_hostnames = true

  tags = { Name = "foc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.0.0/24"
  availability_zone       = local.az_a
  map_public_ip_on_launch = true

  tags = { Name = "foc-public" }
}

# The server's subnet: no public addresses, internet only outbound through the NAT instance.
resource "aws_subnet" "app" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = local.az_a

  tags = { Name = "foc-app" }
}

resource "aws_route_table" "app" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block           = "0.0.0.0/0"
    network_interface_id = aws_instance.nat.primary_network_interface_id
  }
}

resource "aws_route_table_association" "app" {
  subnet_id      = aws_subnet.app.id
  route_table_id = aws_route_table.app.id
}

# RDS requires subnets in two zones. They have no internet route, which keeps the database private.
resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.10.0/24"
  availability_zone = local.az_a

  tags = { Name = "foc-private-a" }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.11.0/24"
  availability_zone = local.az_b

  tags = { Name = "foc-private-b" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "app" {
  name        = "foc-app"
  description = "FoC server: frontend port in, all traffic out, no SSH"
  vpc_id      = aws_vpc.main.id
}

# The server has no public address; CloudFront's VPC origin connects from inside the VPC.
resource "aws_vpc_security_group_ingress_rule" "app_frontend" {
  security_group_id = aws_security_group.app.id
  description       = "Frontend, from the CloudFront VPC origin"
  ip_protocol       = "tcp"
  from_port         = 3001
  to_port           = 3001
  cidr_ipv4         = aws_vpc.main.cidr_block
}

resource "aws_vpc_security_group_egress_rule" "app_all" {
  security_group_id = aws_security_group.app.id
  description       = "Image pulls, SSM and outbound email"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "db" {
  name        = "foc-db"
  description = "FoC database: Postgres from the server only"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  description                  = "Postgres from the FoC server"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.app.id
}
