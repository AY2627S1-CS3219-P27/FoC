output "server_instance_id" {
  description = "For opening a terminal: aws ssm start-session --target <id>."
  value       = aws_instance.server.id
}

output "server_public_ip" {
  description = "Fixed public address of the server."
  value       = aws_eip.server.public_ip
}

output "server_public_dns" {
  description = "Public DNS name, used as the CloudFront origin in step 9."
  value       = aws_eip.server.public_dns
}

output "db_host" {
  description = "Private address of the Postgres instance."
  value       = aws_db_instance.main.address
}

output "public_url" {
  description = "The site's public HTTPS address."
  value       = "https://${aws_cloudfront_distribution.app.domain_name}"
}
