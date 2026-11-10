# Emails when the server or the NAT fails AWS's status checks, and again when it recovers.
# AWS already moves the server to healthy hardware on its own if the hardware fails (auto_recovery).
resource "aws_sns_topic" "alerts" {
  name = "foc-alerts"
}

# AWS emails a confirmation link first; no alarm mail arrives until it is clicked.
resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  watched_instances = {
    server = aws_instance.server.id
    nat    = aws_instance.nat.id
  }
}

resource "aws_cloudwatch_metric_alarm" "status_check" {
  for_each = local.watched_instances

  alarm_name        = "foc-${each.key}-status-check"
  alarm_description = "foc-${each.key} is failing its EC2 status checks: it is down or unreachable."
  namespace         = "AWS/EC2"
  metric_name       = "StatusCheckFailed"
  dimensions        = { InstanceId = each.value }

  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  # A stopped instance reports nothing, which isn't an outage worth mailing about.
  treat_missing_data = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
