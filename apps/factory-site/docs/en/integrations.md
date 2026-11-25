---
title: Integrations & secrets
section: concepts
order: 7
---

## Scope the connection

An integration connects an MCP server or HTTP API. Choose a scope the project can access and grant only the tools the agent needs. HTTP actions use declared operations rather than credentials embedded in workflow inputs.

## Keep values in the Host

Create the secret and reference its ID from the integration. The Host encrypts secret values and exposes IDs and redacted metadata. Attempts use scoped grants instead of receiving upstream model API keys.
