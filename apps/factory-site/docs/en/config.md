---
title: factory.env configuration variables
section: reference
order: 2
---

The default configuration is `~/.factory/config/factory.env`. It uses `KEY=VALUE` entries, not shell code. Environment variables override entries in the file.

## When to use it

Use this reference to change the gateway, port, listen address, or enabled extensions.

## Change and verify a setting

1. Run `factory config show` for redacted values and their sources. Keep file permissions set to `600`.
2. Change the relevant entry or use `factory setup`. If your edit is ignored, look for an environment override.
3. Restart the Host and run `factory doctor`, or choose **System** → **Setup** → **Check again** when the UI is available.

![System Setup showing model, certificate, and network checks](/images/docs/system.png)

*Verify the check for the setting you changed, not just the overall status.*

| Variables | Purpose |
| --- | --- |
| `FACTORY_PORT`, `FACTORY_LISTEN_HOST` | Port (default `8787`) and bind address (loopback by default). |
| `FACTORY_LOGIN_TOKEN` | LAN sign-in; minimum 24 characters. |
| `FACTORY_MODEL_BASE_URL`, `FACTORY_MODEL_API_KEY` | OpenAI-compatible gateway and its key. A key alone does not select a gateway. |
| `FACTORY_LEAD_MODEL`, `FACTORY_AGENT_MODELS` | Lead model and up to eight comma-separated API-agent models. |
| `FACTORY_PROJECTS_ROOT` | Project root directory. |
| `FACTORY_EXTENSIONS`, `FACTORY_EXTENSIONS_DIR` | Comma-separated enabled keys and an optional absolute directory override. |
| `NODE_EXTRA_CA_CERTS` | Readable CA certificate file for an internal gateway. |

> **Warning:** Do not commit the file or paste credentials into support requests. Use redacted output.

## Common mistakes

- Sourcing `factory.env` or overlooking an environment override.
- Setting only the gateway key without its URL or the Lead model.

## Next steps

[Troubleshoot setup](./troubleshooting.md) or [review LAN security](./security.md).
