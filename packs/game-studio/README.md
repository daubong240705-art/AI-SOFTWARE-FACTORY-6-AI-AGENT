# Game Studio pack

A team for building an original browser 3D party game with physics-driven, wobbly characters and online multiplayer. It works in small playable increments rather than document-first phases.

| Seat | Owns | Main tools |
|---|---|---|
| Lead (api-agent) | plans, owners, acceptance | none (chat only) |
| Game Designer | rules, verbs, rounds, `shared/tuning` | none |
| Technical Artist | `tools/blender`, `assets/` | Blender (headless CLI, optional MCP), glTF Transform, optional Meshy/Tripo |
| Physics Engineer | `shared/physics` | Rapier, Vitest (headless) |
| Network Engineer | `server/`, `shared/protocol` | game server, multi-client tests, Playwright |
| Gameplay Engineer | `client/` | Three.js, Vite, Playwright |
| QA Engineer | `tests/e2e` | Playwright MCP, Chrome DevTools MCP, Playwright Test |

Validate the pack from `apps/factory-host`:

```sh
npm run build && npm run pack:check -- ../../packs/game-studio
```

## Runtime

Worker seats need the local CLIs, so start the Host with `scripts/factory-v2/start-host-cli.sh`. The OpenCode sandbox has no network, no Blender and no browser, which makes it unsuitable for this pack. Seats declared `native-opencode` run on the default CLI chosen by that script. Per-seat overrides are set with `seats.set-runtime`, for example Codex for the Physics and Network seats.

## Machine prerequisites

These were checked on the operator machine on 2026-11-13: Arch Linux, Blender 5.2.3 LTS, Chrome 155, Node 22.23.4, RTX 4060 Laptop and Iris Xe.

- **Blender**: `blender -b --factory-startup -P script.py -- out.glb` exported a skinned GLB with 2 clips. `gltf-transform validate` reported 0 errors.
- **glTF Transform**: `npx -y @gltf-transform/cli` (4.5.1).
- **Playwright MCP**: `npx -y @playwright/mcp@latest` (0.0.85). It needs Chrome or a Playwright browser.
- **Chrome DevTools MCP**: `npx -y chrome-devtools-mcp@latest` (1.13.0). Add `--no-usage-statistics` to opt out of usage statistics.
- **Headless WebGL**: works, but uses the SwiftShader software renderer by default. GPU rendering in headless mode worked with these Chromium args:
  - NVIDIA: `--ignore-gpu-blocklist --enable-gpu-rasterization --use-angle=vulkan --enable-features=Vulkan`
  - Intel: `--ignore-gpu-blocklist --use-gl=angle --use-angle=gl-egl`

  For Playwright MCP, pass them through a `--config` file in `browser.launchOptions.args`.

Browser screenshots, logs and traces go to `.factory/`. The Host excludes that folder from task results. Still add it to the game repository's `.gitignore`, so local tools and people ignore it too.

## Giving MCP tools to agents

Register the servers once in the Host's `FACTORY_MCP_SERVERS_FILE`, then start it with `FACTORY_LOCAL_CLI=1`. The example file is `mcp-servers.example.json`. Each seat's CLI then launches only the servers its pinned `tools` list names, for example `ext.playwright.*`.

The Host does three things for those seats:
- **Isolation:** Claude runs with `--strict-mcp-config`, and Codex switches off your other user-level servers, so seats never see unrelated integrations.
- **Pre-approval:** it approves the `factory` tools and the assigned servers. Without this, `workspace-write` seats fail: Claude answers "you haven't granted it yet" and Codex answers "requires approval, but approval policy is never".
- **Scratch output:** `{workspace}/.factory/` is excluded from results.

Each CLI process starts its own stdio server, so parallel agents get separate browsers. A Blender GUI MCP connects to one running Blender, so keep the Technical Artist at one slot. Details are in `apps/factory-host/README.md`, section "CLI-native servers for local CLI seats".

## Tool names in pack.json

`ext.playwright.*`, `ext.devtools.*`, `ext.blender.*`, `ext.meshy.*` and `ext.tripo.*` bind servers to seats by name. What happens depends on how the server is registered:
- **Stdio entry:** the seat's CLI launches the server itself.
- **HTTP entry:** the Host proxies the server. That proxy returns text only (no screenshots), refuses arguments containing absolute paths, shares one session between agents, and allows 50 calls per attempt. It suits stateless lookups, not browsers or Blender.
- **Not registered:** the reference is inert.

## Paid generation

- Meshy (`npx -y @meshy-ai/meshy-mcp-server`, `MESHY_API_KEY`) and Tripo (`TRIPO_API_KEY`) charge per generation.
- Configure them only when you intend to spend credits. Add the key name to `FACTORY_CLI_PASS_ENV`.
- Set the workflow parameter `paidAssetGeneration` so that an operator gate runs before the assets stage.
