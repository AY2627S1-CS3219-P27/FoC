variable "account_id" {
  description = "AWS account FoC deploys into."
  type        = string
  default     = "235099643227"
}

variable "region" {
  description = "AWS region for every FoC resource."
  type        = string
  default     = "ap-southeast-1"
}

variable "aws_profile" {
  description = "AWS CLI profile with admin access to account_id."
  type        = string
  default     = "foc"
}

variable "github_repo" {
  description = "owner@id/name@id of the repo whose Actions may push images, as in GitHub's immutable OIDC subject (repos/<repo>/actions/oidc/customization/sub)."
  type        = string
  default     = "AY2627S1-CS3219-P27@323409630/FoC@1376673792"
}

variable "services" {
  description = "One ECR repository is created per image, as foc/<name>."
  type        = list(string)
  default = [
    "user-service",
    "supplier-service",
    "order-service",
    "comms-service",
    "credit-service",
    "email-service",
    "notification-service",
    "frontend",
  ]
}

variable "budget_limit_usd" {
  description = "Monthly spend that triggers the budget alarm."
  type        = number
  default     = 50
}

variable "budget_email" {
  description = "Address the budget alarm emails."
  type        = string
}
