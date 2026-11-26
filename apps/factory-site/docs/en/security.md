---
title: Security
section: reference
order: 4
---

## Network and sessions

The Host listens only on loopback by default. If you enable LAN access, require token-based sign-in and restrict firewall access to trusted networks. Write operations from the browser are subject to session, Origin, and CSRF checks. Keep the one-time bootstrap token on your machine.

## Runtime boundaries

The Host holds upstream API keys and integration secrets. Agents use grants scoped to individual attempts. OpenCode runs in a bubblewrap sandbox on Linux. Local CLI adapters run with the permissions you give them and do not provide equivalent isolation.

## External effects

Set tool policies and approval gates for actions with significant external effects. The Host records the intended action and its outcome. If the outcome is unclear, check it against the target system before choosing **Retry**. Protect configuration files and backups as private data.
