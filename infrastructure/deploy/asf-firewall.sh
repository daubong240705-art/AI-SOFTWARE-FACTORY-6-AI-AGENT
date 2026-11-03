#!/bin/sh
set -eu
# Dedicated chain; never flush or replace rules belonging to other applications.
iptables -w -N ASF-CONTROL 2>/dev/null || true
iptables -w -F ASF-CONTROL
for port in 18100 18101; do
    iptables -w -A ASF-CONTROL -p tcp -s 192.168.1.51 -m conntrack --ctdir ORIGINAL --ctorigdst 192.168.1.14 --ctorigdstport "$port" -j RETURN
    iptables -w -A ASF-CONTROL -p tcp -m conntrack --ctdir ORIGINAL --ctorigdst 192.168.1.14 --ctorigdstport "$port" -j DROP
done
iptables -w -A ASF-CONTROL -j RETURN
iptables -w -C DOCKER-USER -j ASF-CONTROL 2>/dev/null || iptables -w -I DOCKER-USER 1 -j ASF-CONTROL
