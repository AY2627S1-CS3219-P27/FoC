# A small instance that forwards the server's outbound traffic (ECR, SSM, OpenRouter, email) to the
# internet, at a fraction of a NAT gateway's price. Nothing on the internet can reach the server through it.
data "aws_ssm_parameter" "al2023_arm_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_security_group" "nat" {
  name        = "foc-nat"
  description = "FoC NAT: anything from the server in, all traffic out"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "nat_from_app" {
  security_group_id            = aws_security_group.nat.id
  description                  = "Outbound traffic from the FoC server"
  ip_protocol                  = "-1"
  referenced_security_group_id = aws_security_group.app.id
}

resource "aws_vpc_security_group_egress_rule" "nat_all" {
  security_group_id = aws_security_group.nat.id
  description       = "Forwarded traffic to the internet"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# Only for opening a terminal on it through SSM when debugging.
resource "aws_iam_role" "nat" {
  name               = "foc-nat"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "nat_ssm" {
  role       = aws_iam_role.nat.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "nat" {
  name = "foc-nat"
  role = aws_iam_role.nat.name
}

# A micro, as a nano's 512 MB runs out of memory installing packages on first boot.
resource "aws_instance" "nat" {
  ami                    = data.aws_ssm_parameter.al2023_arm_ami.value
  instance_type          = "t4g.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.nat.id]
  iam_instance_profile   = aws_iam_instance_profile.nat.name
  user_data              = file("${path.module}/nat-user-data.sh")
  # It forwards packets addressed to other machines, which EC2 drops unless this is off.
  source_dest_check = false

  root_block_device {
    volume_type = "gp3"
    encrypted   = true
  }

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  tags = { Name = "foc-nat" }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}
