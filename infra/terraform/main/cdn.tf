# The public HTTPS address. CloudFront decrypts traffic and forwards everything to the frontend,
# which proxies /api and /socket.io to the private services.
data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# Passes cookies, the Origin header and query strings through, which login and chat rely on.
data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

# Lets CloudFront reach the server privately inside the VPC, so the server needs no public address.
resource "aws_cloudfront_vpc_origin" "server" {
  vpc_origin_endpoint_config {
    name                   = "foc-server"
    arn                    = aws_instance.server.arn
    http_port              = 3001
    https_port             = 443
    origin_protocol_policy = "http-only"

    origin_ssl_protocols {
      items    = ["TLSv1.2"]
      quantity = 1
    }
  }
}

resource "aws_cloudfront_distribution" "app" {
  enabled = true
  comment = "FoC frontend"
  # The cheapest price class that includes edge locations in Asia.
  price_class = "PriceClass_200"

  origin {
    origin_id   = "server"
    domain_name = aws_instance.server.private_dns

    vpc_origin_config {
      vpc_origin_id = aws_cloudfront_vpc_origin.server.id
    }
  }

  default_cache_behavior {
    target_origin_id         = "server"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# Read by scripts/render-env-from-ssm.sh for password-reset links and allowed chat origins.
resource "aws_ssm_parameter" "public_url" {
  name  = "/foc/public_url"
  type  = "String"
  value = "https://${aws_cloudfront_distribution.app.domain_name}"
}
