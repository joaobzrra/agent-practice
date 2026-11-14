# Meshy API notes (verified against docs.meshy.ai on 2026-10-23)

Base URL `https://api.meshy.ai/openapi`. Auth header `Authorization: Bearer msy_...`.
All generation calls are asynchronous: POST returns `{"result": "<task_id>"}`, then
GET `<endpoint>/<id>` until `status` is `SUCCEEDED | FAILED | CANCELED`. Wait the
`Retry-After` header between polls (5 s if absent). A client timeout does not cancel or
fail the task; keep the id and poll again. Only `FAILED` refunds credits. Files expire
after 3 days; download immediately (the script does).

Rate limits (Pro): 20 req/s, 10 queued tasks. `429` with `NoMorePendingTasks` means wait
for a task to finish. Check `GET /v1/balance` before a run.

## Image to 3D — `POST /v1/image-to-3d` (30 credits with 2K textures on meshy-7.1)
| param | values | note |
|---|---|---|
| `image_url` | public URL or `data:image/png;base64,...` | JPG/PNG/WebP ≤ 20 MB |
| `ai_model` | `latest` (= meshy-7.1), `meshy-7.1`, `meshy-6`, `meshy-6-lite` | `meshy-5` retired Oct 10 2026 |
| `model_type` | `standard` (default), `smart-topology` | smart-topology uses `meshy-t2.5`/`meshy-t2`, triangle-only, polycount 100–30 000; cheaper (5+10) but lower detail; `lowpoly` retires Oct 30 2026 |
| `geometry_resolution` | `standard`, `2k`, `4k` | `2k`/`4k` need meshy-7.1; +5 credits |
| `should_texture` | bool, default true | |
| `enable_pbr` | bool, default false | we set true: metallic/roughness/normal maps (observed: same 30 credits as without; the normal map pairs with deliberately faceted normals, so keep the file's normals) |
| `save_pre_remeshed_model` | bool, default false | with `should_remesh`: adds `model_urls.pre_remeshed_glb`, the high-poly before remesh (no extra charge observed) |
| `texture_resolution` | `2k`, `4k`, `8k` | 4k same price as 2k on 7.1 |
| `texture_prompt` | ≤ 800 chars | guides texture only; wins over `texture_image_url` |
| `should_remesh` | bool; default false on 7.1 | we set true to hit the budget |
| `topology` | `triangle`, `quad` | only when should_remesh |
| `target_polycount` | 100–300 000 (remesh), default 30 000 | result is approximate |
| `decimation_mode` | 1 ultra … 4 low | overrides target_polycount; we don't use it |
| `pose_mode` | `a-pose`, `t-pose`, `""` | |
| `image_enhancement` | bool, default true | false keeps the exact input look (use when Meshy restyles) |
| `remove_lighting` | bool, default true | meshy-6 only; 7.1 ignores it |
| `target_formats` | `glb`,`obj`,`fbx`,`stl`,`usdz`,`3mf` | fewer = faster; we ask for glb |
| `multi_view_thumbnails` | bool | adds `thumbnail_urls.front/right/back/left` (512px) |
| `auto_size` / `origin_at` | bool / `bottom`,`center` | AI-guessed real size; we scale in Blender instead |

Response task object: `model_urls.{glb,fbx,obj,usdz,...}`, `thumbnail_url`,
`thumbnail_urls`, `texture_urls[0].{base_color,metallic,normal,roughness}`,
`consumed_credits`, `task_error.{type,code,message}`, `expires_at` (unix ms).

Task error codes worth branching on: `image_too_complex` (simplify the reference),
`moderation_blocked`, `timeout`/`queue_timeout` (recreate), `format_conversion_failed`.

## Multi-Image to 3D — `POST /v1/multi-image-to-3d` (same price)
`image_urls`: 1–4 images; with meshy-7.1 the **first is the front view**, others any order.
Same parameters as above except: no `model_type` smart-topology, `geometry_resolution`
max `2k`, and `texture_image_urls` (1–4) may replace `texture_image_url`.

## Rigging — `POST /v1/rigging` (5 credits, ~40 s)
| param | note |
|---|---|
| `input_task_id` | a textured Meshy task, ≤ 320 000 faces |
| `model_url` | GLB, public URL ≤ 400 MB or data URI ≤ 100 MB; **face toward +Z (glTF forward)**; textured |
| `height_meters` | default 1.7 |
| `texture_image_url` | optional PNG base color |

Requires a standard bipedal humanoid. `422` = pose estimation failed (not retryable with
the same mesh). Skeleton (read from API rig downloads, GLB and FBX alike):
24 bones, `Hips Spine02 Spine01 Spine neck Head head_end headfront Left/RightShoulder Arm ForeArm Hand
Left/RightUpLeg Leg Foot ToeBase`, **no finger bones**, rest palms ~77° to the side. The Meshy web app's rig
exports 66 bones (`SmartRigArmature`: UE mannequin names `pelvis spine_01 … index_01_l …`, 15 finger bones per
hand, Mixamo `_End` tips, a 2-frame `rest` action); the API docs and changelog have no option for it (checked
2026-10-23). The web rig is not always that: on one run it gave 36 bones, per hand only `middle_01–03` and
an unnamed `Bone_035/036`, with the hand weighted almost entirely to `hand_l/hand_r`. Count the finger-dominant
vertices before trusting a web rig's fingers. Response `result`: `rigged_character_fbx_url`, `rigged_character_glb_url`,
`basic_animations.{walking,running}_{glb,fbx,armature_glb}_url`.

## Animation — `POST /v1/animations` (3 credits per action)
`rig_task_id` + `action_ids` (1–10 preset ids) or `motion_task_id` (from Text to Motion).
Presets: `GET /v1/animations/library` (free). Result field names were not verified; the
script downloads every URL under `result`.

## Other endpoints the skill may reach for
- `POST /v1/remesh` (5): `input_task_id` or `model_url`, `topology`, `target_polycount`, `resize_height`
- `POST /v1/retexture` (10): new texture on an existing model, `enable_original_uv`
- `POST /v1/uv-unwrap` (5): ≤ 40 000 faces
- `POST /v1/convert` (1), `POST /v1/resize` (1)

## Official tooling
- MCP server: `claude mcp add-json meshy '{"command":"npx","args":["-y","@meshy-ai/meshy-mcp-server"],"env":{"MESHY_API_KEY":"msy_..."}}'`
  (PowerShell-safe form). Tools: `meshy_image_to_3d`, `meshy_multi_image_to_3d`, `meshy_rig`,
  `meshy_animate`, `meshy_remesh`, `meshy_retexture`, `meshy_check_balance`, `meshy_list_animations`…
- Skill pack from Meshy: `npx skills add meshy-dev/meshy-3d-agent` (REST-based, no MCP).
- Docs for agents: https://docs.meshy.ai/llms.txt and https://docs.meshy.ai/llms-full.txt

Sources: https://docs.meshy.ai/api/image-to-3d.md · https://docs.meshy.ai/api/multi-image-to-3d ·
https://docs.meshy.ai/api/rigging.md · https://docs.meshy.ai/llms-full.txt (AI integration, pricing,
task lifecycle, changelog Oct 2026)
