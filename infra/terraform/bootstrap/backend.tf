# State lives in the bucket this stack creates; it started local and was migrated here.
terraform {
  backend "s3" {
    bucket       = "foc-tfstate-235099643227"
    key          = "bootstrap/terraform.tfstate"
    region       = "ap-southeast-1"
    profile      = "foc"
    encrypt      = true
    use_lockfile = true
  }
}
