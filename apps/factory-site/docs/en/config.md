---
title: factory.env configuration variables
section: reference
order: 2
---

## Configuration file and precedence

The default file, `~/.factory/config/factory.env`, uses `KEY=VALUE` entries and is not a shell script. Environment variables override the file. Use `factory config show` to see the effective values and their sources. Keep the file permissions set to `600`.

## Common variables

| Variable | Purpose |
| --- | --- |
| `FACTORY_PORT`, `FACTORY_LISTEN_HOST` | Port and listen address. The defaults are `8787` and `127.0.0.1`. |
| `FACTORY_LOGIN_TOKEN` | Sign-in token for LAN access. Use at least 24 characters. |
| `FACTORY_MODEL_BASE_URL`, `FACTORY_MODEL_API_KEY` | OpenAI-compatible gateway URL and API key used by the Host. |
| `FACTORY_LEAD_MODEL`, `FACTORY_AGENT_MODELS` | The Lead's model and a comma-separated list of up to eight models for API agents. |
| `FACTORY_PROJECTS_ROOT` | Root directory for projects. |
| `FACTORY_EXTENSIONS`, `FACTORY_EXTENSIONS_DIR` | List of extensions and an optional absolute path override for the extensions directory. |
| `NODE_EXTRA_CA_CERTS` | Additional CA certificate file for an internal TLS gateway. |
