output "tfstate_bucket" {
  description = "Bucket for every stack's S3 backend."
  value       = aws_s3_bucket.tfstate.bucket
}

output "ecr_registry" {
  description = "Registry host; set FOC_IMAGE_PREFIX to <this>/foc."
  value       = split("/", aws_ecr_repository.service["order-service"].repository_url)[0]
}

output "github_ci_role_arn" {
  description = "Role GitHub Actions assumes (aws-actions/configure-aws-credentials role-to-assume)."
  value       = aws_iam_role.github_ci.arn
}

output "github_deploy_role_arn" {
  description = "Role the release deploy job assumes (repo variable AWS_DEPLOY_ROLE_ARN)."
  value       = aws_iam_role.github_deploy.arn
}
