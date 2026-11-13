---
name: asset-pipeline-3d
description: Build reproducible game-ready GLB characters with headless Blender scripts, validate and optimize them with glTF Transform, and hand off rigs, clips and collider data.
version: 0.1.0
source: Blender Python API and glTF exporter (verified with Blender 5.2.3 LTS in Factory POC 0); glTF Transform CLI docs (gltf-transform.dev); Khronos glTF validator rules; Blender Lab MCP readme (projects.blender.org/lab/blender_mcp).
---

# 3D asset pipeline

## Build by script, not by hand

Every asset is produced by `tools/blender/<name>.py`. Rerunning the script must give the same result. The script:

1. Starts empty: `bpy.ops.wm.read_factory_settings(use_empty=True)`.
2. Builds the mesh from primitives and modifiers. For soft critters, use a few large rounded shapes and smooth shading, then join them into one mesh.
3. Adds an armature and binds with `bpy.ops.object.parent_set(type="ARMATURE_AUTO")`, which works in background mode.
4. Keys each clip as its own action and pushes it to an NLA track named after the clip.
5. Exports with `bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_animations=True, export_animation_mode="NLA_TRACKS")`.

Run it:

```sh
blender -b --factory-startup -P tools/blender/<name>.py -- assets/models/<name>.glb
```

Read the output path from the arguments after `--`. Never write outside the worktree.

## Conventions

- **Units and axes:** metres, origin at the feet. Blender is Z-up; the exporter writes glTF Y-up by default.
- **Character height:** about 1.0–1.3 m. Keep proportions chunky: a big head and body, short limbs.
- **Skeleton:** Root, Spine, Head, UpperArm.L/R, LowerArm.L/R, Thigh.L/R, Shin.L/R. Add more bones only if a clip needs them. Names stay stable across versions.
- **Clips:** Idle, Walk, Run, Jump, Fall, GetUp, Grab, Throw, Wobble. They loop where it makes sense, at 30 fps.
- **Budgets per character:** ≤ 5,000 triangles, 1 material, textures ≤ 1024² (prefer vertex colours or flat toon colours), GLB ≤ 1 MiB. The Host flags files above 5 MiB for operator review.
- **Collider sidecar** `<name>.colliders.json`: for each bone, a capsule `{ "radius": m, "halfHeight": m, "offset": [x, y, z] }` measured from the mesh. Physics uses this instead of guessing.

## Validate, inspect, optimize

```sh
npx -y @gltf-transform/cli validate assets/models/<name>.glb
npx -y @gltf-transform/cli inspect assets/models/<name>.glb
npx -y @gltf-transform/cli optimize assets/models/<name>.glb assets/models/<name>.glb --compress meshopt --texture-compress webp
```

Reading the results:
- **Errors:** zero errors is required.
- **`NODE_SKINNED_MESH_NON_ROOT`:** this warning is usual for Blender exports and harmless in three.js. Report it, but do not fight it.
- **`inspect`:** confirm the expected meshes, skins, clip names, durations and triangle count.
- **Meshopt:** if you used meshopt compression, tell the Gameplay Engineer that GLTFLoader needs the meshopt decoder (`three/addons/libs/meshopt_decoder.module.js`).

## Visual check

- If the Host offers a Blender MCP tool, use it to render a thumbnail or screenshot (`render_viewport_to_path`) and inspect proportions.
- Otherwise, render a still with `blender -b` and a camera you add in the script.
- Put previews under `.factory/` (git-ignored), not under `assets/`.

## Sources, licenses and generation

- Use original work or CC0 sources only, for example Poly Haven, Kenney or Quaternius. Check each pack's license page.
- Record the source URL, author and license in `assets/CREDITS.md`.
- Generation services (Meshy, Tripo) cost money per call. Use them only when the task states the operator allowed it, at most two generations per task, and record the service, the prompt and the job id in `CREDITS.md`.
- Generated meshes still go through this pipeline: retopology or decimation, rig check, clip naming, validation.
- Never recreate characters or assets from an existing game.

## Handoff

Report:
- the script and output paths;
- the command and its exit code;
- validator errors and warnings;
- triangle count and file size before and after optimization;
- bone and clip names;
- the sidecar path;
- what was not checked visually.
