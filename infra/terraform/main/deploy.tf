# The only command CI may run on the server. It accepts nothing but a full commit ID.
resource "aws_ssm_document" "deploy" {
  name            = "foc-deploy"
  document_type   = "Command"
  document_format = "JSON"

  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Deploy one commit of FoC to the server"
    parameters = {
      commit = {
        type           = "String"
        description    = "Full commit ID on main whose images CI has built"
        allowedPattern = "^[0-9a-f]{40}$"
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "deploy"
      inputs = {
        timeoutSeconds = "900"
        runCommand = [
          "set -eu",
          # SSM runs with no HOME, which docker login and git need.
          "export HOME=/root",
          "cd /opt/foc",
          "git fetch origin main",
          "git checkout --detach {{ commit }}",
          "scripts/deploy.sh \"$(echo {{ commit }} | cut -c1-12)\"",
        ]
      }
    }]
  })
}
