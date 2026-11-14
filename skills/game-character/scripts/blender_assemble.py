"""Headless Blender: assemble modular parts onto the rigged base and export for UE5.

Run (Blender 4.2+):
  blender -b --python blender_assemble.py -- --base rigged/character.glb --spec spec.json \
      --parts-dir characters/<slug>/parts --out characters/<slug>/export [--landmarks-only]

Pipeline
  1. import the rigged base; join its meshes into SK_<Name>; find the armature
  2. compute landmarks (eyes, chest, head_top, neck, waist): z from bones when the Meshy bone
     names match (head / neck / spine), else from height fractions; y by ray-casting the base
     surface along -Y (front). Written to <out>/landmarks.json. --landmarks-only stops here.
  3. for each spec.parts entry: import its GLB, place at landmark + attach.offset_m
     (or attach.position_m absolute), scale/rotate, then skin it:
       rigid  → every vertex 100 % to the landmark's bone (glasses on the head bone)
       deform → weights copied from the nearest base surface (Data Transfer modifier)
     both get an Armature modifier on the same skeleton and are parented to it.
  4. export (spec.export.modular true, the default):
       SK_<Name>.fbx                 base
       SK_<Name>_<part>.fbx          each part as a skeletal mesh on the SAME skeleton (leader pose in UE)
       SM_<Name>_<part>.fbx          rigid parts also as static meshes, + sockets.json (bone + offset)
       assembled_preview.glb         everything, for blender_evaluate.py's final sheet
     modular false → one SK_<Name>.fbx with every part joined into the base mesh.
  5. <out>/assembly_log.json: per part, how many verts got weights, which bone, triangle counts.

Part file resolution (per spec.parts[i]):
  procedural → <parts-dir>/<name>/raw.glb (from build_part.py)
  meshy      → part["file"] if set, else newest <parts-dir>/<name>/<name>-cN/raw.glb
  library    → part["file"]
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ue_common import (export_fbx, import_any, join_meshes, sanitize,  # noqa: E402
                       select_only, tri_count, world_bbox)

LOG = {"parts": [], "warnings": []}


def warn(msg):
    LOG["warnings"].append(msg); print("WARNING:", msg)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--base")
    p.add_argument("--spec")
    p.add_argument("--parts-dir")
    p.add_argument("--out")
    p.add_argument("--landmarks-only", action="store_true")
    p.add_argument("--selftest", action="store_true")
    return p.parse_args(argv)


# ----------------------------------------------------------------- landmarks
def find_bone(arm, *needles, pick="highest", exclude=("end", "top", "tip", "nub")):
    cands = [b for b in arm.data.bones
             if any(n in b.name.lower() for n in needles) and not any(x in b.name.lower() for x in exclude)]
    if not cands:
        return None
    key = (lambda b: (arm.matrix_world @ b.head_local).z)
    return max(cands, key=key) if pick == "highest" else min(cands, key=key)


def bone_world(arm, bone):
    return arm.matrix_world @ bone.head_local, arm.matrix_world @ bone.tail_local


def raycast(base, origin, direction):
    """World-space ray against the base mesh. Returns hit point or None."""
    inv = base.matrix_world.inverted()
    o_l = inv @ Vector(origin)
    d_l = (inv.to_3x3() @ Vector(direction)).normalized()
    hit, loc, _n, _i = base.ray_cast(o_l, d_l)
    return (base.matrix_world @ loc) if hit else None


def compute_landmarks(base, arm):
    lo, hi = world_bbox([base])
    H = hi.z - lo.z
    cx = (lo.x + hi.x) / 2
    head = find_bone(arm, "head")
    neck = find_bone(arm, "neck")
    spine = find_bone(arm, "spine", "chest", pick="highest")
    hips = find_bone(arm, "hips", "pelvis", "root", pick="lowest")

    def z_or(bone, frac, along=0.0):
        if bone is None:
            return lo.z + H * frac, "height_fraction"
        h, t = bone_world(arm, bone)
        return h.z + (t.z - h.z) * along, f"bone:{bone.name}"

    marks = {}
    # eyes: ~35 % of the way from the skull base to the top of the head
    if head:
        hz, _ = bone_world(arm, head)
        marks["eyes"] = (hz.z + (hi.z - hz.z) * 0.35, f"bone:{head.name}")
    else:
        marks["eyes"] = (lo.z + H * 0.935, "height_fraction")
    marks["neck"] = z_or(neck, 0.85, 0.0)
    nz = marks["neck"][0]
    marks["chest"] = (nz - H * 0.035, "below_neck") if neck else (lo.z + H * 0.80, "height_fraction")
    marks["head_top"] = (hi.z, "bbox_top")
    marks["waist"] = z_or(hips, 0.58, 0.0)

    result = {"height_m": round(H, 4), "bbox_min": list(lo), "bbox_max": list(hi), "landmarks": {}}
    bone_for = {"eyes": head, "head_top": head, "neck": neck or head, "chest": spine or neck, "waist": hips or spine}
    for name, (z, how) in marks.items():
        if name == "head_top":
            hit = raycast(base, (cx, (lo.y + hi.y) / 2, hi.z + 1.0), (0, 0, -1))
            pos = hit if hit else Vector((cx, (lo.y + hi.y) / 2, hi.z))
        else:
            hit = raycast(base, (cx, lo.y - 2.0, z), (0, 1, 0))  # from the front, towards +Y
            if hit is None:
                warn(f"landmark {name}: raycast missed the base at z={z:.3f}; using bbox front")
                pos = Vector((cx, lo.y, z))
            else:
                pos = hit
        b = bone_for.get(name)
        result["landmarks"][name] = {"position_m": [round(v, 4) for v in pos], "z_from": how,
                                     "bone": b.name if b else None}
    if head is None:
        warn("no bone with 'head' in its name; eyes/head_top use height fractions and rigid parts have no bone")
    return result


# ----------------------------------------------------------------- parts
def resolve_part_file(part, parts_dir: Path):
    src = part.get("source")
    if src == "procedural":
        return parts_dir / part["name"] / "raw.glb"
    if src == "library":
        return Path(part["file"])
    if src == "meshy":
        if part.get("file"):
            return Path(part["file"])
        cands = sorted((parts_dir / part["name"]).glob(f"{part['name']}-c*/raw.glb"),
                       key=lambda p: int(p.parent.name.rsplit("c", 1)[1]))
        if not cands:
            raise SystemExit(f"part {part['name']}: no generated candidate under {parts_dir / part['name']}")
        return cands[-1]
    raise SystemExit(f"part {part['name']}: unknown source '{src}'")


def place(obj, part, landmarks):
    att = part.get("attach", {})
    if att.get("position_m"):
        pos = Vector(att["position_m"])
    else:
        lm = landmarks["landmarks"].get(att.get("landmark", "chest"))
        if lm is None:
            raise SystemExit(f"part {part['name']}: unknown landmark {att.get('landmark')}")
        pos = Vector(lm["position_m"]) + Vector(att.get("offset_m", [0, 0, 0]))
    obj.location = pos
    rot = att.get("rotation_deg", [0, 0, 0])
    obj.rotation_euler = Euler([math.radians(v) for v in rot], "XYZ")
    s = att.get("scale", 1.0)
    obj.scale = (s, s, s)
    select_only([obj], obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return pos


def skin_rigid(obj, arm, bone_name):
    vg = obj.vertex_groups.new(name=bone_name)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")


def skin_deform(obj, arm, base):
    select_only([obj], obj)
    mod = obj.modifiers.new("WeightsFromBase", "DATA_TRANSFER")
    mod.object = base
    mod.use_vert_data = True
    mod.data_types_verts = {"VGROUP_WEIGHTS"}
    mod.vert_mapping = "POLYINTERP_NEAREST"
    mod.layers_vgroup_select_src = "ALL"
    mod.layers_vgroup_select_dst = "NAME"
    bpy.ops.object.datalayout_transfer(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    # drop empty groups, normalize the rest so every vertex sums to 1
    bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.0001)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)


def attach_armature(obj, arm):
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    obj.parent = arm
    obj.matrix_parent_inverse = arm.matrix_world.inverted()


def weighted_vertex_fraction(obj):
    n = len(obj.data.vertices)
    if n == 0:
        return 0.0
    w = sum(1 for v in obj.data.vertices if any(g.weight > 0.001 for g in v.groups))
    return round(w / n, 4)


def socket_transform(arm, bone_name, obj):
    """Part transform relative to the bone, in Blender units/axes (meters). UE conversion in
    references/ue5-import.md; the skeletal export of the same part needs none of this."""
    pb = arm.pose.bones[bone_name]
    bone_mw = arm.matrix_world @ pb.matrix
    rel = bone_mw.inverted() @ obj.matrix_world
    loc = rel.to_translation(); rot = rel.to_euler("XYZ")
    return {"bone": bone_name, "location_cm_blender_axes": [round(v * 100, 3) for v in loc],
            "rotation_deg_blender_axes": [round(math.degrees(v), 3) for v in rot]}


# ----------------------------------------------------------------- selftest
def selftest():
    """Stand-in rigged biped + both procedural parts → full assemble → asserts. No Meshy needed."""
    import tempfile
    import build_part
    tmp = Path(tempfile.mkdtemp(prefix="gc_assemble_"))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # mesh names sort after "Icosphere" on purpose: a generator's names are arbitrary, and the
    # base join must not depend on which imported object happens to come first
    bpy.ops.mesh.primitive_cylinder_add(radius=0.18, depth=1.45, vertices=24, location=(0, 0, 0.725))
    body = bpy.context.object; body.name = "Torso"
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.12, segments=24, ring_count=12, location=(0, 0, 1.6))
    head = bpy.context.object; head.name = "Skull"
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    arm = bpy.context.object
    eb = arm.data.edit_bones
    root = eb[0]; root.name = "Hips"; root.head = (0, 0, 0.9); root.tail = (0, 0, 1.1)
    spine = eb.new("Spine"); spine.head = (0, 0, 1.1); spine.tail = (0, 0, 1.4); spine.parent = root
    neck = eb.new("Neck"); neck.head = (0, 0, 1.4); neck.tail = (0, 0, 1.48); neck.parent = spine
    hd = eb.new("Head"); hd.head = (0, 0, 1.48); hd.tail = (0, 0, 1.72); hd.parent = neck
    bpy.ops.object.mode_set(mode="OBJECT")
    select_only([body, head, arm], arm)
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    base_glb = tmp / "base.glb"
    select_only([body, head, arm], arm)
    bpy.ops.export_scene.gltf(filepath=str(base_glb), export_format="GLB", use_selection=True)

    parts_dir = tmp / "parts"
    for gen in ("glasses", "drawstrings"):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        obj = build_part.GENERATORS[gen]({})
        select_only([obj], obj)
        (parts_dir / gen).mkdir(parents=True, exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=str(parts_dir / gen / "raw.glb"), export_format="GLB", use_selection=True)

    spec = {"name": "Dummy", "height_meters": 1.72, "export": {"modular": True}, "parts": [
        {"name": "glasses", "source": "procedural", "attach": {"mode": "rigid", "landmark": "eyes", "offset_m": [0, -0.004, 0]}},
        {"name": "drawstrings", "source": "procedural", "attach": {"mode": "deform", "landmark": "chest", "offset_m": [0, -0.005, 0.03]}},
    ]}
    (tmp / "spec.json").write_text(json.dumps(spec))

    class A: pass
    a = A(); a.base = str(base_glb); a.spec = str(tmp / "spec.json"); a.parts_dir = str(parts_dir)
    a.out = str(tmp / "export"); a.landmarks_only = False
    run(a)
    log = json.loads((tmp / "export" / "assembly_log.json").read_text())
    height = json.loads((tmp / "export" / "landmarks.json").read_text())["height_m"]
    assert abs(height - 1.72) < 0.005, ("base must be the torso and skull only", height)
    lm = log["landmarks"]
    assert lm["eyes"]["bone"] == "Head" and 1.5 < lm["eyes"]["position_m"][2] < 1.72, lm
    assert lm["eyes"]["position_m"][1] < -0.1, ("eyes landmark should sit on the front surface", lm)
    byname = {p["name"]: p for p in log["parts"]}
    assert byname["glasses"]["mode"] == "rigid" and byname["glasses"]["bone"] == "Head"
    assert byname["glasses"]["weighted_fraction"] == 1.0
    assert byname["drawstrings"]["weighted_fraction"] > 0.99, byname["drawstrings"]
    for key in ("base", "skeletal:glasses", "skeletal:drawstrings", "static:glasses"):
        assert Path(log["exports"][key]).exists(), key
    assert (tmp / "export" / "sockets.json").exists() and (tmp / "export" / "assembled_preview.glb").exists()
    # part materials are M_<Name>_<part>_<slot>; the generator's own "M_<part>_" is not repeated
    mats = {m.name for o in bpy.data.objects if o.type == "MESH" for m in o.data.materials if m}
    want = {"M_Dummy_glasses_frame", "M_Dummy_glasses_lens", "M_Dummy_drawstrings_cord", "M_Dummy_drawstrings_aglet"}
    assert want <= mats, sorted(mats)
    print(f"SELFTEST OK → {tmp / 'export'}")


# ----------------------------------------------------------------- main
def main():
    a = parse_args()
    if a.selftest:
        selftest(); return
    for k in ("base", "spec", "parts_dir", "out"):
        if not getattr(a, k):
            raise SystemExit(f"--{k.replace('_', '-')} is required")
    run(a)


def run(a):
    LOG["parts"].clear(); LOG["warnings"].clear()
    spec = json.loads(Path(a.spec).read_text())
    name = sanitize(spec["name"])
    parts_dir = Path(a.parts_dir)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0
    objs = import_any(a.base)
    arms = [o for o in objs if o.type == "ARMATURE"]
    if len(arms) != 1:
        raise SystemExit(f"expected 1 armature in the base, found {len(arms)}")
    arm = arms[0]; arm.name = "Armature"; arm.data.name = f"{name}_Skeleton"
    base = join_meshes(objs, f"SK_{name}")
    prefix = f"M_{name}_"
    for m in bpy.data.materials:
        if m.users and not m.name.startswith(prefix):
            m.name = f"{prefix}{sanitize(m.name)}"

    landmarks = compute_landmarks(base, arm)
    (out / "landmarks.json").write_text(json.dumps(landmarks, indent=2))
    print(json.dumps(landmarks["landmarks"], indent=2))
    if a.landmarks_only:
        return

    part_objs = []
    rigid_sockets = {}
    for part in spec.get("parts", []):
        pname = sanitize(part["name"])
        f = resolve_part_file(part, parts_dir)
        if not f.exists():
            raise SystemExit(f"part {pname}: file not found {f}")
        new = import_any(f)
        new_meshes = [o for o in new if o.type == "MESH"]
        for o in new:
            if o.type != "MESH":
                bpy.data.objects.remove(o)  # a part file must not bring its own armature/empties
        if not new_meshes:
            raise SystemExit(f"part {pname}: no mesh in {f}")
        obj = join_meshes(new_meshes, pname)
        gen_prefix = f"M_{sanitize(part.get('generator') or part['name'])}_"  # build_part names slots M_<generator>_<slot>
        for slot in obj.material_slots:
            if slot.material and not slot.material.name.startswith(prefix):
                slot_name = sanitize(slot.material.name).removeprefix(gen_prefix)
                slot.material.name = f"{prefix}{pname}_{slot_name}"
        pos = place(obj, part, landmarks)
        att = part.get("attach", {})
        mode = att.get("mode", "deform")
        lm = landmarks["landmarks"].get(att.get("landmark", "chest"), {})
        bone_name = att.get("bone") or lm.get("bone")
        if mode == "rigid":
            if not bone_name or bone_name not in arm.data.bones:
                raise SystemExit(f"part {pname}: rigid attach needs a bone; landmark '{att.get('landmark')}' "
                                 f"resolved to '{bone_name}'. Set attach.bone to one of: "
                                 f"{[b.name for b in arm.data.bones][:20]}...")
            skin_rigid(obj, arm, bone_name)
        else:
            skin_deform(obj, arm, base)
        attach_armature(obj, arm)
        entry = {"name": pname, "file": str(f), "mode": mode, "bone": bone_name if mode == "rigid" else None,
                 "position_m": [round(v, 4) for v in pos], "triangles": tri_count(obj),
                 "vertex_groups": len(obj.vertex_groups), "weighted_fraction": weighted_vertex_fraction(obj)}
        if mode == "rigid":
            rigid_sockets[pname] = socket_transform(arm, bone_name, obj)
        if entry["weighted_fraction"] < 0.999:
            warn(f"part {pname}: {1 - entry['weighted_fraction']:.1%} of vertices got no weight")
        budget = part.get("triangle_budget")
        if budget and entry["triangles"] > budget * 1.05:
            warn(f"part {pname}: {entry['triangles']} tris > budget {budget}")
        LOG["parts"].append(entry)
        part_objs.append(obj)

    # preview for the evaluate sheet (everything)
    select_only([base, arm] + part_objs, arm)
    preview = out / "assembled_preview.glb"
    bpy.ops.export_scene.gltf(filepath=str(preview), export_format="GLB", use_selection=True, export_apply=False)

    modular = spec.get("export", {}).get("modular", True)
    exports = {}
    if modular:
        exports["base"] = str(out / f"SK_{name}.fbx")
        export_fbx(exports["base"], [base, arm])
        for obj in part_objs:
            fbx = out / f"SK_{name}_{obj.name}.fbx"
            export_fbx(fbx, [obj, arm])
            exports[f"skeletal:{obj.name}"] = str(fbx)
        for obj in part_objs:
            if obj.name in rigid_sockets:
                # static version at its own origin (attach point), no armature
                dup = obj.copy(); dup.data = obj.data.copy(); dup.name = f"SM_{name}_{obj.name}"
                bpy.context.scene.collection.objects.link(dup)
                dup.parent = None; dup.modifiers.clear(); dup.matrix_world = Matrix.Identity(4)
                fbx = out / f"{dup.name}.fbx"
                export_fbx(fbx, [dup], skeletal=False)
                exports[f"static:{obj.name}"] = str(fbx)
                bpy.data.objects.remove(dup)
        (out / "sockets.json").write_text(json.dumps(rigid_sockets, indent=2))
    else:
        select_only([base] + part_objs, base)
        if part_objs:
            bpy.ops.object.join()
        merged = bpy.context.object; merged.name = merged.data.name = f"SK_{name}"
        exports["merged"] = str(out / f"SK_{name}.fbx")
        export_fbx(exports["merged"], [merged, arm])

    LOG.update({"base": str(a.base), "base_triangles": tri_count(base), "bones": len(arm.data.bones),
                "modular": modular, "exports": exports, "preview": str(preview),
                "landmarks": landmarks["landmarks"]})
    (out / "assembly_log.json").write_text(json.dumps(LOG, indent=2))
    print(json.dumps({"parts": [(p["name"], p["mode"], p["weighted_fraction"]) for p in LOG["parts"]],
                      "exports": list(exports), "warnings": LOG["warnings"]}, indent=2))
    print(f"Next: blender_evaluate.py --input {preview} --out {out / 'eval'} for the final sheet")


if __name__ == "__main__":
    main()
