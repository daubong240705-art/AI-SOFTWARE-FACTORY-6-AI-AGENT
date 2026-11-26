---
title: Security
section: reference
order: 4
---

Factory's Host holds credentials and enforces policy. Decide who can reach the Host, what each runtime can access, and which operations need human approval.

## When to use it

Review these boundaries before enabling LAN access, selecting a local CLI adapter, or connecting a workflow to an external system.

## Limit access and effects

1. Keep the Host bound to loopback unless other machines need it. For LAN access, configure token-based sign-in and restrict the firewall to trusted networks. Check `D-LAN` in **System** → **Setup**.
2. Keep the one-time bootstrap token and Host credentials local. Browser writes are checked against the session, Origin, and CSRF protections. Scope **Integrations** to the projects that need them.
3. Choose tools and runtime deliberately. On Linux, OpenCode uses bubblewrap; local CLI adapters run with the permissions you give them and do not provide the same isolation.
4. Place an approval before significant external writes. Verify an uncertain result in the target system before retrying.

![System Setup with the Network readiness check](/images/docs/system.png)

*System includes a LAN sign-in check alongside other Host checks.*

> **Warning:** Protect configuration, logs, and backups. Use disposable data and credentials for exercises.

## Common mistakes

- Assuming local CLI adapters have the same sandbox as OpenCode.
- Passing upstream keys to agents instead of keeping them on the Host, which issues scoped attempt grants.

## Next steps

[Configure scoped integrations](./integrations.md) or [design an approval gate](./approvals.md).
