---
title: Installation
section: start
order: 2
---

## Requirements

Use Linux x64 with `git`; `sudo` is needed only for system packages. WSL2 is supported by the installer but not fully verified; avoid installing under `/mnt`. The installer verifies and downloads a pinned Node.js 22 build. A provider is optional for starting the Host, but Lead chat needs a configured model.

## Install and start

```bash
git clone https://github.com/daubong240705-art/AI-SOFTWARE-FACTORY-6-AI-AGENT.git factory
cd factory
bash scripts/install.sh --yes
export PATH="$HOME/.local/bin:$PATH"
factory setup
factory doctor
factory start
```

Open [Factory on this machine](http://127.0.0.1:8787/). Setup prompts for the provider, API key, models, bind address, port, and agent CLIs. Doctor reports failed checks and suggested fixes.

> Use `--dry-run` to preview installation steps or `--no-service` to skip registering a user service. Existing `factory.env` files are not overwritten.
