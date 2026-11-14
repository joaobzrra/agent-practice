#!/usr/bin/env python3
"""Meshy REST driver for the game-character skill.

Stdlib only (urllib), so it runs on any Python 3.10+ without installs.
Every call is recorded in <out>/run.json so a run can be resumed after a
timeout instead of re-creating (and re-paying for) a task.

Subcommands
  balance                         print remaining credits
  generate --spec S --out DIR     image-to-3d / multi-image-to-3d from the spec
           [--params P.json]      merge extra/override Meshy parameters (one-change loops)
           [--new]                force a new candidate even if one is still running
           [--part NAME]          generate spec.parts[NAME] (source: meshy) → parts/NAME/NAME-cN/raw.glb
  status   --out DIR              re-poll every non-final task in run.json
  rig      --spec S --out DIR     rig a model
           --model prepped.glb    ... from a local GLB (sent as data URI), or
           --from-task [ID]       ... from the chosen/last candidate's Meshy task
  animate  --out DIR --actions a,b,c   apply preset actions to the rig (3 credits each)
  library                         print the preset animation library (free)
  selftest                        offline check of the generation parameters (no key, no credits)

spec.generation.model_type: "standard" (default, meshy-7.1 + remesh) or "smart-topology"
(ai_model meshy-t2 | meshy-t2.5, one image, native low-poly at target_polycount = triangle_budget).

Environment
  MESHY_API_KEY   required. Never written to disk or printed.

Endpoints and parameter names were read from docs.meshy.ai (Oct 2026); see
references/meshy-api.md in the skill for the verified list.
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://api.meshy.ai/openapi"
FINAL = {"SUCCEEDED", "FAILED", "CANCELED"}
MAX_WAIT_S = 60 * 60  # Meshy: wait at least 60 min from created_at before giving up


# ----------------------------------------------------------------- helpers
def api_key() -> str:
    key = os.environ.get("MESHY_API_KEY", "").strip()
    if not key:
        sys.exit("MESHY_API_KEY is not set. Set it in your shell (never in a file) and retry.")
    return key


def request(method: str, path: str, body: dict | None = None, timeout: int = 60):
    """One HTTP call. Returns (status, headers, json_or_text)."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Authorization", f"Bearer {api_key()}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return r.status, dict(r.headers), json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                return r.status, dict(r.headers), raw.decode(errors="replace")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, dict(e.headers), json.loads(raw)
        except json.JSONDecodeError:
            return e.code, dict(e.headers), raw


def must(status: int, payload, what: str):
    if status >= 400:
        msg = payload.get("message") if isinstance(payload, dict) else payload
        sys.exit(f"{what}: HTTP {status}: {msg}")
    return payload


def file_to_data_uri(path: Path, limit_mb: int) -> str:
    size_mb = path.stat().st_size / (1024 * 1024)
    if size_mb > limit_mb:
        sys.exit(f"{path} is {size_mb:.1f} MB; Meshy accepts at most {limit_mb} MB as a data URI.")
    mime = mimetypes.guess_type(str(path))[0]
    if path.suffix.lower() in {".glb", ".gltf"}:
        mime = "model/gltf-binary"
    mime = mime or "application/octet-stream"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url)  # signed URL: no auth header
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    return dest


def poll(path: str, task_id: str, created_at_ms: int | None = None) -> dict:
    """Poll until final. Honors Retry-After; 429/5xx are not task failures."""
    deadline = time.time() + MAX_WAIT_S
    last = None
    while time.time() < deadline:
        status, headers, task = request("GET", f"{path}/{task_id}", timeout=30)
        wait = int(headers.get("Retry-After") or headers.get("retry-after") or 5)
        if status == 429 or status >= 500:
            time.sleep(wait)
            continue
        must(status, task, f"GET {path}/{task_id}")
        st = task.get("status")
        if st != last:
            print(f"  {task_id[:8]} {st} {task.get('progress', 0)}%", flush=True)
            last = st
        if st in FINAL:
            return task
        time.sleep(wait)
    raise SystemExit(f"Task {task_id} still running after {MAX_WAIT_S}s. Re-run `status` later; do not recreate it.")


# ----------------------------------------------------------------- manifest
def load_run(out: Path) -> dict:
    p = out / "run.json"
    if p.exists():
        return json.loads(p.read_text())
    return {"candidates": [], "parts": {}, "rig": None, "animations": [], "balance": {}}


def save_run(out: Path, run: dict):
    out.mkdir(parents=True, exist_ok=True)
    (out / "run.json").write_text(json.dumps(run, indent=2))


def load_spec(path: Path) -> dict:
    spec = json.loads(path.read_text())
    for k in ("name", "references"):
        if k not in spec:
            sys.exit(f"spec.json is missing '{k}'")
    if not spec["references"]:
        sys.exit("spec.json 'references' is empty; at least one front image is required")
    return spec


def save_task_files(task: dict, folder: Path) -> dict:
    """Download model, thumbnails and textures from a generation task object."""
    files = {}
    for fmt, url in (task.get("model_urls") or {}).items():
        stem, _, ext = fmt.rpartition("_")  # "pre_remeshed_glb" -> raw_pre_remeshed.glb, "glb" -> raw.glb
        files[fmt] = str(download(url, folder / (f"raw_{stem}.{ext}" if stem else f"raw.{fmt}")))
    for view, url in (task.get("thumbnail_urls") or {}).items():
        files[f"thumb_{view}"] = str(download(url, folder / "meshy_thumbs" / f"{view}.png"))
    if task.get("thumbnail_url") and "thumb_front" not in files:
        files["thumb_front"] = str(download(task["thumbnail_url"], folder / "meshy_thumbs" / "front.png"))
    for i, maps in enumerate(task.get("texture_urls") or []):
        for kind, url in maps.items():
            files[f"tex{i}_{kind}"] = str(download(url, folder / "textures" / f"texture_{i}_{kind}.png"))
    return files


# ----------------------------------------------------------------- commands
def cmd_balance(_a):
    status, _h, payload = request("GET", "/v1/balance", timeout=30)
    must(status, payload, "balance")
    print(json.dumps(payload, indent=2))
    return payload


def find_part(spec: dict, name: str) -> dict:
    for p in spec.get("parts", []):
        if p.get("name") == name:
            if p.get("source") != "meshy":
                sys.exit(f"part '{name}' has source '{p.get('source')}', not meshy")
            if not p.get("references"):
                sys.exit(f"part '{name}' has no references")
            return p
    sys.exit(f"part '{name}' not in spec.parts")


# Smart Topology models and their target_polycount ceilings (docs.meshy.ai/api/image-to-3d, 2026-10-23)
SMART_TOPOLOGY_MAX = {"meshy-t2": 15000, "meshy-t2.5": 30000}


def smart_topology_params(params: dict, n_refs: int):
    """model_type smart-topology: Meshy's native low-poly models. Refuse what the API answers
    with 400, and drop the parameters it rejects or ignores, before any credit is spent."""
    model = params.get("ai_model")
    if model not in SMART_TOPOLOGY_MAX:
        sys.exit(f"model_type smart-topology needs ai_model {sorted(SMART_TOPOLOGY_MAX)}, not '{model}'")
    if n_refs > 1:
        sys.exit("smart-topology models take one image; multi-image needs model_type standard (meshy-7.1)")
    if params.get("topology", "triangle") != "triangle":
        sys.exit("smart-topology output is triangle-only; topology quad returns 400")
    n = int(params["target_polycount"])
    if not 100 <= n <= SMART_TOPOLOGY_MAX[model]:
        sys.exit(f"target_polycount {n} is outside {model}'s range 100-{SMART_TOPOLOGY_MAX[model]}")
    if params.get("geometry_resolution") in ("2k", "4k"):
        sys.exit("geometry_resolution 2k/4k needs meshy-7.1, not a smart-topology model")
    params.pop("image_enhancement", None)  # 400 with smart-topology
    params.pop("should_remesh", None)      # ignored: target_polycount sets the count directly


def build_generation_params(spec: dict, overrides: dict, part: dict | None = None) -> tuple[str, dict]:
    src = part if part else spec
    refs = [Path(r) for r in src["references"]]
    for r in refs:
        if not r.exists():
            sys.exit(f"reference not found: {r}")
    gen = spec.get("generation", {})
    provider = gen.get("provider", "meshy")
    if provider != "meshy":
        sys.exit(f"spec.generation.provider is '{provider}' but only the meshy backend exists in this "
                 f"driver. Build a {provider} backend from its API docs first, or set provider to meshy.")
    params = {
        "ai_model": gen.get("ai_model", "latest"),
        "should_texture": True,
        "enable_pbr": bool(gen.get("enable_pbr", True)),
        "texture_resolution": part.get("texture_resolution", "2k") if part else gen.get("texture_resolution", "2k"),
        "should_remesh": True,
        "topology": gen.get("topology", "triangle"),
        "target_polycount": int(src.get("triangle_budget", 15000 if not part else 2000)),
        "target_formats": ["glb"],
        "multi_view_thumbnails": True,
        "image_enhancement": bool(gen.get("image_enhancement", True)),
    }
    if part:
        params["pose_mode"] = ""  # a hat has no pose
        if part.get("texture_prompt"):
            params["texture_prompt"] = part["texture_prompt"][:800]
    else:
        params["pose_mode"] = gen.get("pose_mode", "a-pose")
        if gen.get("geometry_resolution") in ("2k", "4k"):
            params["geometry_resolution"] = gen["geometry_resolution"]
        if gen.get("texture_prompt"):
            params["texture_prompt"] = gen["texture_prompt"][:800]
    if gen.get("model_type", "standard") != "standard":
        params["model_type"] = gen["model_type"]
    params.update(overrides)
    if params.get("model_type") == "smart-topology":
        smart_topology_params(params, len(refs))

    if len(refs) == 1:
        params["image_url"] = file_to_data_uri(refs[0], 20)
        return "/v1/image-to-3d", params
    if len(refs) > 4:
        sys.exit("Meshy multi-image accepts at most 4 references")
    if params.get("geometry_resolution") == "4k":
        params["geometry_resolution"] = "2k"  # 4k is not offered on multi-image (returns 400)
    params["image_urls"] = [file_to_data_uri(r, 20) for r in refs]  # first = front view
    return "/v1/multi-image-to-3d", params


def cmd_generate(a):
    out = Path(a.out)
    spec = load_spec(Path(a.spec))
    run = load_run(out)
    overrides = json.loads(Path(a.params).read_text()) if a.params else {}
    part = find_part(spec, a.part) if a.part else None
    bucket = run.setdefault("parts", {}).setdefault(a.part, []) if part else run["candidates"]

    # Resume an unfinished candidate instead of paying twice.
    if not a.new:
        for c in bucket:
            if c.get("status") not in FINAL:
                print(f"Resuming {c['id']} (task {c['task_id']})")
                return finish_candidate(out, run, c)

    path, params = build_generation_params(spec, overrides, part)
    cid = f"{a.part + '-' if part else ''}c{len(bucket) + 1}"
    if not run["balance"].get("before"):
        run["balance"]["before"] = cmd_balance(None).get("balance")
    print(f"Creating {cid} via POST {path} ({params['ai_model']}, {params['target_polycount']} tris, pose '{params['pose_mode']}')")
    status, _h, payload = request("POST", path, body=params, timeout=60)
    must(status, payload, f"POST {path}")
    task_id = payload["result"]
    logged = {k: v for k, v in params.items() if k not in ("image_url", "image_urls")}
    cand = {"id": cid, "part": a.part, "endpoint": path, "task_id": task_id, "params": logged,
            "overrides": overrides, "status": "PENDING", "files": {}}
    bucket.append(cand)
    save_run(out, run)
    return finish_candidate(out, run, cand)


def finish_candidate(out: Path, run: dict, cand: dict):
    task = poll(cand["endpoint"], cand["task_id"])
    cand["status"] = task["status"]
    cand["consumed_credits"] = task.get("consumed_credits")
    if task["status"] != "SUCCEEDED":
        cand["error"] = task.get("task_error")
        save_run(out, run)
        sys.exit(f"{cand['id']} {task['status']}: {task.get('task_error')}")
    if cand.get("part"):
        folder = out / "parts" / cand["part"] / cand["id"]
    else:
        folder = out / "candidates" / cand["id"]
    cand["files"] = save_task_files(task, folder)
    cand["expires_at"] = task.get("expires_at")
    save_run(out, run)
    print(f"{cand['id']} done → {folder / 'raw.glb'}  ({cand['consumed_credits']} credits)")
    print(f"Next: evaluate it with blender_evaluate.py --input {folder / 'raw.glb'}")


def cmd_status(a):
    out = Path(a.out)
    run = load_run(out)
    for c in run["candidates"]:
        if c.get("status") not in FINAL:
            finish_candidate(out, run, c)
    for cands in run.get("parts", {}).values():
        for c in cands:
            if c.get("status") not in FINAL:
                finish_candidate(out, run, c)
    rig = run.get("rig")
    if rig and rig.get("status") not in FINAL:
        finish_rig(out, run)
    print("All tasks final.")


def cmd_rig(a):
    out = Path(a.out)
    spec = load_spec(Path(a.spec))
    run = load_run(out)
    body = {"height_meters": float(spec.get("height_meters", 1.7))}
    if a.model:
        glb = Path(a.model)
        if glb.suffix.lower() != ".glb":
            sys.exit("rig --model expects a .glb")
        body["model_url"] = file_to_data_uri(glb, 100)
        source = str(glb)
    else:
        task_id = a.from_task if a.from_task and a.from_task != "last" else None
        if not task_id:
            done = [c for c in run["candidates"] if c.get("status") == "SUCCEEDED"]
            if not done:
                sys.exit("no succeeded candidate to rig; pass --model or --from-task ID")
            chosen = run.get("chosen")
            task_id = next((c["task_id"] for c in done if c["id"] == chosen), done[-1]["task_id"])
        body["input_task_id"] = task_id
        source = f"task:{task_id}"
    print(f"Creating rig from {source} (height {body['height_meters']} m)")
    archive_previous_rig(out, run)
    status, _h, payload = request("POST", "/v1/rigging", body=body, timeout=120)
    if status == 422:
        sys.exit("Rigging 422: pose estimation failed. The mesh is not readable as a biped "
                 "(merged limbs, odd pose, or props hiding the body). Regenerate with "
                 "pose_mode t-pose or a cleaner reference; do not retry the same mesh.")
    must(status, payload, "POST /v1/rigging")
    run["rig"] = {"task_id": payload["result"], "source": source, "status": "PENDING", "files": {}}
    save_run(out, run)
    return finish_rig(out, run)


def archive_previous_rig(out: Path, run: dict):
    """Every rig downloads into rigged/ and run["rig"] holds one record, so a rig of a second candidate would
    overwrite the first. Move the old files to rigged_<candidate>/ and keep the old record in run["rig_history"]."""
    old = run.get("rig")
    if not old:
        return
    task = old.get("source", "").removeprefix("task:")
    label = next((c["id"] for c in run.get("candidates", []) if c.get("task_id") == task), old["task_id"][:8])
    dest = out / f"rigged_{label}"
    n = 2
    while dest.exists():
        dest, n = out / f"rigged_{label}_{n}", n + 1
    if (out / "rigged").exists():
        (out / "rigged").rename(dest)
        old["files"] = {k: str(dest / Path(v).name) for k, v in old.get("files", {}).items()}
    run.setdefault("rig_history", []).append(old)
    run["rig"] = None
    save_run(out, run)


def finish_rig(out: Path, run: dict):
    rig = run["rig"]
    task = poll("/v1/rigging", rig["task_id"])
    rig["status"] = task["status"]
    rig["consumed_credits"] = task.get("consumed_credits")
    if task["status"] != "SUCCEEDED":
        rig["error"] = task.get("task_error")
        save_run(out, run)
        sys.exit(f"rig {task['status']}: {task.get('task_error')}")
    res = task.get("result") or {}
    folder = out / "rigged"
    files = {}
    if res.get("rigged_character_fbx_url"):
        files["fbx"] = str(download(res["rigged_character_fbx_url"], folder / "character.fbx"))
    if res.get("rigged_character_glb_url"):
        files["glb"] = str(download(res["rigged_character_glb_url"], folder / "character.glb"))
    for k, url in (res.get("basic_animations") or {}).items():
        if url:
            name = k.replace("_url", "")
            ext = "fbx" if name.endswith("fbx") else "glb"
            files[name] = str(download(url, folder / f"{name}.{ext}"))
    rig["files"] = files
    rig["expires_at"] = task.get("expires_at")
    run["balance"]["after"] = cmd_balance(None).get("balance")
    save_run(out, run)
    print(f"rig done → {folder}  ({rig['consumed_credits']} credits)")
    print("Next: build the parts, then blender_assemble.py --base rigged/character.glb (SKILL.md stage 6)")


def cmd_library(_a):
    status, _h, payload = request("GET", "/v1/animations/library", timeout=30)
    must(status, payload, "animation library")
    print(json.dumps(payload, indent=2))


def cmd_animate(a):
    out = Path(a.out)
    run = load_run(out)
    rig = run.get("rig")
    if not rig or rig.get("status") != "SUCCEEDED":
        sys.exit("no succeeded rig in run.json; run `rig` first")
    actions = [s.strip() for s in a.actions.split(",") if s.strip()]
    if not 1 <= len(actions) <= 10:
        sys.exit("pass 1 to 10 action ids (see `library`)")
    body = {"rig_task_id": rig["task_id"], "action_ids": actions}
    status, _h, payload = request("POST", "/v1/animations", body=body, timeout=60)
    must(status, payload, "POST /v1/animations")
    task = poll("/v1/animations", payload["result"])
    entry = {"task_id": payload["result"], "actions": actions, "status": task["status"], "files": {}}
    if task["status"] == "SUCCEEDED":
        # Field names for the animation result are not in the verified notes;
        # download every URL-looking value under result so nothing is lost.
        res = task.get("result") or {}
        folder = out / "animations" / "_".join(actions)[:60]
        for k, v in res.items():
            if isinstance(v, str) and v.startswith("http"):
                ext = "fbx" if "fbx" in k else "glb"
                entry["files"][k] = str(download(v, folder / f"{k.replace('_url', '')}.{ext}"))
    else:
        entry["error"] = task.get("task_error")
    run["animations"].append(entry)
    save_run(out, run)
    print(json.dumps(entry, indent=2))


def cmd_selftest(_a):
    """Offline: generation parameters per model_type. No key, no network, no credits."""
    import tempfile
    tmp = Path(tempfile.mkdtemp(prefix="gc_meshy_"))
    img = tmp / "front.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n")  # only encoded into the params, never sent

    def spec(gen, refs=1, budget=5000):
        return {"name": "T", "references": [str(img)] * refs, "triangle_budget": budget, "generation": gen}

    path, p = build_generation_params(spec({"ai_model": "latest"}), {})
    assert path == "/v1/image-to-3d" and p["image_enhancement"] is True and p["should_remesh"] is True, p.keys()
    assert "model_type" not in p, p.keys()

    path, p = build_generation_params(spec({"model_type": "smart-topology", "ai_model": "meshy-t2"}), {})
    assert path == "/v1/image-to-3d" and p.get("model_type") == "smart-topology" and p["ai_model"] == "meshy-t2", p.keys()
    assert p["target_polycount"] == 5000 and "image_enhancement" not in p and "should_remesh" not in p, p.keys()

    # requests Meshy answers with 400: refused here, before a credit is spent
    for bad, why in ((spec({"model_type": "smart-topology", "ai_model": "latest"}), "needs ai_model"),
                     (spec({"model_type": "smart-topology", "ai_model": "meshy-t2"}, refs=2), "one image"),
                     (spec({"model_type": "smart-topology", "ai_model": "meshy-t2"}, budget=20000), "outside"),
                     (spec({"model_type": "smart-topology", "ai_model": "meshy-t2", "topology": "quad"}), "triangle-only")):
        try:
            build_generation_params(bad, {})
        except SystemExit as e:
            assert why in str(e), (why, str(e))  # refused for this reason, not another
            continue
        raise AssertionError(f"accepted a request Meshy rejects: {bad['generation']}, "
                             f"refs={len(bad['references'])}, budget={bad['triangle_budget']}")

    # a second rig must not overwrite the first one's files or record (rigging a second candidate used to replace the first rig)
    (tmp / "rigged").mkdir()
    (tmp / "rigged" / "character.glb").write_bytes(b"c1 rig")
    run = {"candidates": [{"id": "c1", "task_id": "T1"}, {"id": "c2", "task_id": "T2"}],
           "rig": {"task_id": "R1", "source": "task:T1", "status": "SUCCEEDED",
                   "files": {"glb": str(tmp / "rigged" / "character.glb")}}}
    archive_previous_rig(tmp, run)
    kept = tmp / "rigged_c1" / "character.glb"
    assert kept.read_bytes() == b"c1 rig" and not (tmp / "rigged").exists(), sorted(p.name for p in tmp.iterdir())
    assert run["rig"] is None and run["rig_history"][0]["files"]["glb"] == str(kept), run

    # model_urls keys are formats, but "pre_remeshed_glb" is a GLB: it used to land as raw.pre_remeshed_glb
    real_download = globals()["download"]
    globals()["download"] = lambda url, dest: dest  # no network: the name is what is under test
    try:
        files = save_task_files({"model_urls": {"glb": "u1", "pre_remeshed_glb": "u2"}}, tmp / "cand")
    finally:
        globals()["download"] = real_download
    assert Path(files["glb"]).name == "raw.glb", files
    assert Path(files["pre_remeshed_glb"]).name == "raw_pre_remeshed.glb", files

    # progress lines print "→"; a piped stdout under `python -I` is cp1252 and crashed after a paid generation
    assert sys.stdout.encoding.lower().replace("-", "") == "utf8", sys.stdout.encoding
    print(f"SELFTEST OK ({tmp})")


# ----------------------------------------------------------------- main
def main():
    # A pipe on Windows defaults to cp1252 unless PYTHONUTF8 is set (and `python -I` ignores it); "→" then
    # crashes the line after a paid task has finished.
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("balance").set_defaults(fn=cmd_balance)
    g = sub.add_parser("generate")
    g.add_argument("--spec", required=True)
    g.add_argument("--out", required=True)
    g.add_argument("--params")
    g.add_argument("--new", action="store_true")
    g.add_argument("--part", help="generate a part from spec.parts[NAME] instead of the base")
    g.set_defaults(fn=cmd_generate)
    s = sub.add_parser("status")
    s.add_argument("--out", required=True)
    s.set_defaults(fn=cmd_status)
    r = sub.add_parser("rig")
    r.add_argument("--spec", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--model")
    r.add_argument("--from-task", nargs="?", const="last")
    r.set_defaults(fn=cmd_rig)
    an = sub.add_parser("animate")
    an.add_argument("--out", required=True)
    an.add_argument("--actions", required=True)
    an.set_defaults(fn=cmd_animate)
    sub.add_parser("library").set_defaults(fn=cmd_library)
    sub.add_parser("selftest").set_defaults(fn=cmd_selftest)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
