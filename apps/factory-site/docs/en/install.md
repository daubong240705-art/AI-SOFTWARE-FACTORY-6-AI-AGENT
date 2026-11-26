---
title: Installation
section: start
order: 2
---

Install Factory on a Linux x64 machine you control. A model provider is optional for startup, but Lead chat and API agents need one.

## When to use it

Follow these steps for a new Host or to repair a missing UI build. You need Git and `sudo` for system packages. The installer downloads a pinned Node.js 22 build and checks its checksum.

## Install and start

1. Clone the Factory repository if you do not already have a checkout, then run the installer from its root:

   ```bash
   git clone https://github.com/daubong240705-art/AI-SOFTWARE-FACTORY-6-AI-AGENT.git factory
   cd factory
   bash scripts/install.sh --yes
   export PATH="$HOME/.local/bin:$PATH"
   ```

2. Run `factory setup` to configure the model provider, port, listen address, and optional agent CLIs. Enter credentials locally.
3. Run `factory doctor`. Fix required failures, then run `factory start` and open the Host's local address on the configured port (default `8787`).
4. Open **System** → **Setup** and choose **Check again** after making a fix.

![System Setup with required and optional checks](/images/docs/system.png)

*Setup lists checks for the Host, model, agent CLIs, and network.*

> **Note:** Use `--dry-run` to preview installation or `--no-service` to skip the user service. The installer preserves existing `factory.env` files.

## Common mistakes

- Installing under `/mnt` on WSL2. Use a local Linux filesystem; WSL2 is not fully verified.
- Assuming **Ready** means all optional runtimes are usable. Check the runtime you intend to use.

## Next steps

[Create a project](./quickstart.md) or [troubleshoot setup](./troubleshooting.md).
