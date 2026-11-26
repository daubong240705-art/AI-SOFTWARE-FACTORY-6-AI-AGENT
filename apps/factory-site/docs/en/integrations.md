---
title: Integrations & secrets
section: concepts
order: 7
---

Integrations connect Factory to MCP servers or HTTP APIs. The Host stores secret values separately; a workflow refers to a connection and a declared operation.

## When to use it

Use a scoped connection for work that needs an external system. For example, give one game project its Portal publishing connection without making it system-wide.

![Overview with Integrations in the sidebar](/images/docs/overview.png)

*Open Integrations from the sidebar to manage connections and credentials separately.*

## Configure a connection

1. Open **Integrations** → **Credentials** → **Create credential**. Enter the value there and keep the credential ID for the connection configuration.
2. In **Connections**, choose **Create integration**. Choose a type and **Scope** that includes the project. Reference the credential ID and expose only the tools or operations the workflow needs.
3. Before an HTTP **Action** that writes externally, add an **Approval** and plan how to verify an uncertain outcome.

> **Warning:** Never put credentials in a brief, workflow inputs, or logs. The Host encrypts values and exposes IDs and redacted metadata; attempts receive scoped grants.

## Common mistakes

- Putting a connection outside the scope of the project using it.
- Using a broader scope or bypassing approval to make a test pass.

## Next steps

[Configure Portal](./portal.md) or [review security boundaries](./security.md).
