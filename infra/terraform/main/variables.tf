variable "account_id" {
  description = "The only AWS account this stack may run against."
  type        = string
  default     = "235099643227"
}

variable "region" {
  description = "AWS region for every resource."
  type        = string
  default     = "ap-southeast-1"
}

variable "aws_profile" {
  description = "Local AWS CLI profile Terraform signs in with."
  type        = string
  default     = "foc"
}

variable "instance_type" {
  description = "EC2 size for the compose stack: 8 app containers, RabbitMQ, Redis and observability."
  type        = string
  default     = "t3.large"
}

variable "db_instance_class" {
  description = "RDS size for the one Postgres instance holding all service databases."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_services" {
  description = "Services that own a database on the shared RDS instance."
  type        = set(string)
  default = [
    "user-service",
    "supplier-service",
    "order-service",
    "credit-service",
    "comms-service",
    "notification-service",
    "rag-service",
  ]
}

variable "broker_services" {
  description = "Services with their own RabbitMQ login."
  type        = set(string)
  default = [
    "user-service",
    "supplier-service",
    "order-service",
    "credit-service",
    "comms-service",
    "notification-service",
    "email-service",
  ]
}
