# Factory Development Launchers

For a new installation, follow the [setup guide](../../docs/setup/README.md) and use `factory setup`, `factory doctor`, and `factory start`. The scripts here are for an explicitly deployed development build.

- `deploy-host-wsl.sh` copies the built contracts, Host, UI, packs, and extensions onto a local filesystem and installs production dependencies. Build all three packages first. It uses the current checkout unless `FACTORY_SRC` is set, and **replaces** `FACTORY_APP_DIR` (default `~/factory-v2/app`). Stop the deployed Host first. The script also works on Linux outside WSL.
- `start-host-real.sh --check` checks an OpenCode deployment without starting the Host. Set `FACTORY_MODEL_BASE_URL`, `FACTORY_MODEL_API_KEY`, and `FACTORY_AGENT_MODELS`. It checks the model list without requesting a completion. Starting without `--check` can spend tokens.
- `start-host-cli.sh --check` checks an opt-in local CLI deployment. Use `--lead gateway` to use the configured model gateway for Lead chat; `--api-models` enables the model proxy for API agents. Local CLI agents run with the operator's permissions.
- `doc-worker/setup-doc-worker.sh` prepares the optional Python document worker. Use `factory doctor` to check its availability.

The launchers use `FACTORY_V2_HOME` to locate the deployed app. Use an explicit gateway URL such as `https://gateway.example/v1`; `NODE_EXTRA_CA_CERTS` is optional if a private CA is required. Set credentials privately and never put them on the command line or in a tracked file.
