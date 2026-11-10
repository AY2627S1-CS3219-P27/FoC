#!/bin/bash
# Runs once, on the NAT instance's first boot. AWS's documented NAT instance setup for Amazon Linux 2023.
set -euxo pipefail

dnf install -y iptables-services
systemctl enable --now iptables

echo 'net.ipv4.ip_forward = 1' >/etc/sysctl.d/90-nat.conf
sysctl -p /etc/sysctl.d/90-nat.conf

iface=$(ip route show default | awk '{print $5; exit}')
iptables -t nat -A POSTROUTING -o "$iface" -j MASQUERADE
# The stock rules reject all forwarding.
iptables -F FORWARD
service iptables save
