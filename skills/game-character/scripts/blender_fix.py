"""Headless Blender fix pass: apply a JSON plan of named operations, export a textured GLB.

Run (Blender 4.2+):
  blender -b --python blender_fix.py -- --input raw.glb --plan fix_plan.json --out prepped_dir
  blender -b --python blender_fix.py -- --selftest

Plan format (JSON): a list of operations, applied in order.
  [
    {"op": "remove_loose_parts", "min_ratio": 0.01},   # drop islands smaller than 1 % of height
    {"op": "merge_by_distance", "distance": 0.0005},
    {"op": "recalc_normals"},
    {"op": "decimate_to", "triangles": 15000},
    {"op": "smooth_shading", "angle_deg": 35},
    {"op": "join_objects"},
    {"op": "set_origin_feet"},
    {"op": "scale_to_height", "meters": 1.75},
    {"op": "rename", "object": "SK_Courier", "material_prefix": "M_Courier_"},
    {"op": "pack_textures"},
    {"op": "custom_script", "path": "fix_glasses.py"}   # a bpy file Claude writes; runs with bpy in globals
  ]

Writes <out>/prepped.glb (textures embedded, glTF +Z forward: what Meshy rigging expects)
and <out>/fix_log.json (what each op changed, with counts).

Topology-changing ops (remove_loose_parts, merge_by_distance, decimate_to, join_objects)
refuse to run on a file that already contains an armature, because they damage skin weights.
"""
import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

TOPOLOGY_OPS = {"remove_loose_parts", "merge_by_distance", "decimate_to", "join_objects"}
LOG = []


def log(op, **info):
    LOG.append({"op": op, **info})
    print(f"  {op}: {info}")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--input")
    p.add_argument("--plan")
    p.add_argument("--out")
    p.add_argument("--selftest", action="store_true")
    return p.parse_args(argv)


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def armatures():
    return [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]


def select_only(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def world_bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def tri_count(o):
    me = o.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def welded_components(bm):
    """Edge-connected pieces, counting vertices at the same position as one vertex. A glTF import
    splits vertices at UV seams and hard edges; without the weld every UV shell of a textured
    mesh reads as a loose island and gets deleted. The mesh itself is not welded."""
    bm.verts.index_update()
    ids, pos_id = {}, []
    for v in bm.verts:
        pos_id.append(ids.setdefault(v.co.to_tuple(), len(ids)))
    parent = list(range(len(ids)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for e in bm.edges:
        a, b = find(pos_id[e.verts[0].index]), find(pos_id[e.verts[1].index])
        if a != b:
            parent[a] = b
    comps = {}
    for v in bm.verts:
        comps.setdefault(find(pos_id[v.index]), []).append(v)
    return list(comps.values())


# ----------------------------------------------------------------- ops
def op_remove_loose_parts(min_ratio=0.01, **_):
    lo, hi = world_bbox(meshes())
    height = hi.z - lo.z
    threshold = height * float(min_ratio)
    removed = []
    for o in meshes():
        bm = bmesh.new(); bm.from_mesh(o.data)
        comps = welded_components(bm)
        if len(comps) <= 1:
            bm.free(); continue
        biggest = max(len(c) for c in comps)
        for comp in comps:
            cos = [o.matrix_world @ v.co for v in comp]
            ext = max(max(p.x for p in cos) - min(p.x for p in cos),
                      max(p.y for p in cos) - min(p.y for p in cos),
                      max(p.z for p in cos) - min(p.z for p in cos))
            if ext < threshold and len(comp) < biggest:
                removed.append({"object": o.name, "verts": len(comp), "extent_m": round(ext, 4),
                                "center": [round(c, 3) for c in sum(cos, Vector()) / len(cos)]})
                bmesh.ops.delete(bm, geom=comp, context="VERTS")
        bm.to_mesh(o.data); bm.free(); o.data.update()
    log("remove_loose_parts", threshold_m=round(threshold, 4), removed=removed)


def op_merge_by_distance(distance=0.0005, **_):
    total = 0
    for o in meshes():
        before = len(o.data.vertices)
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=float(distance))
        bm.to_mesh(o.data); bm.free(); o.data.update()
        total += before - len(o.data.vertices)
    log("merge_by_distance", distance=distance, vertices_merged=total)


def op_recalc_normals(**_):
    for o in meshes():
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(o.data); bm.free(); o.data.update()
    log("recalc_normals", objects=len(meshes()))


def op_decimate_to(triangles, **_):
    objs = meshes()
    total = sum(tri_count(o) for o in objs)
    if total <= int(triangles):
        log("decimate_to", skipped=True, triangles_before=total, target=int(triangles))
        return
    ratio = int(triangles) / total
    for o in objs:
        select_only([o], o)
        mod = o.modifiers.new("Decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"; mod.ratio = ratio; mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    after = sum(tri_count(o) for o in meshes())
    log("decimate_to", ratio=round(ratio, 4), triangles_before=total, triangles_after=after)


def op_smooth_shading(angle_deg=30, **_):
    objs = meshes()
    select_only(objs, objs[0])
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(float(angle_deg)))
        how = "shade_smooth_by_angle"
    except (AttributeError, RuntimeError):
        bpy.ops.object.shade_smooth()
        how = "shade_smooth"
    log("smooth_shading", angle_deg=angle_deg, method=how)


def op_join_objects(name=None, **_):
    objs = meshes()
    if len(objs) <= 1:
        log("join_objects", skipped=True, objects=len(objs)); return
    select_only(objs, objs[0])
    bpy.ops.object.join()
    if name:
        bpy.context.object.name = name
    log("join_objects", joined=len(objs), result=bpy.context.object.name)


def op_set_origin_feet(**_):
    objs = meshes()
    lo, hi = world_bbox(objs)
    shift = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    for o in objs:
        o.location += shift
    select_only(objs, objs[0])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    log("set_origin_feet", shift_m=[round(v, 4) for v in shift])


def op_scale_to_height(meters, **_):
    objs = meshes()
    lo, hi = world_bbox(objs)
    cur = hi.z - lo.z
    if cur <= 0:
        raise SystemExit("scale_to_height: zero height")
    f = float(meters) / cur
    pivot = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for o in objs:
        o.location = pivot + (o.location - pivot) * f
        o.scale *= f
    select_only(objs, objs[0])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    log("scale_to_height", factor=round(f, 5), height_before=round(cur, 4), height_after=float(meters))


def sanitize(s):
    return "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in s).strip("_") or "Unnamed"


def op_rename(object=None, material_prefix=None, **_):
    objs = meshes()
    if object:
        if len(objs) == 1:
            objs[0].name = objs[0].data.name = object
        else:
            for i, o in enumerate(objs, 1):
                o.name = o.data.name = f"{object}_{i:02d}"
    if material_prefix:
        for i, m in enumerate(bpy.data.materials, 1):
            if m.users:
                m.name = f"{material_prefix}{sanitize(m.name).removeprefix(material_prefix)}"
    log("rename", objects=[o.name for o in meshes()],
        materials=[m.name for m in bpy.data.materials if m.users])


def op_pack_textures(**_):
    bpy.ops.file.pack_all()
    log("pack_textures", images=[i.name for i in bpy.data.images if i.users])


def op_custom_script(path, **_):
    p = Path(path)
    if not p.exists():
        raise SystemExit(f"custom_script not found: {p}")
    ns = {"bpy": bpy, "bmesh": bmesh, "Vector": Vector, "__name__": "__fix__"}
    exec(compile(p.read_text(), str(p), "exec"), ns)
    log("custom_script", path=str(p), result=ns.get("RESULT"))


OPS = {
    "remove_loose_parts": op_remove_loose_parts,
    "merge_by_distance": op_merge_by_distance,
    "recalc_normals": op_recalc_normals,
    "decimate_to": op_decimate_to,
    "smooth_shading": op_smooth_shading,
    "join_objects": op_join_objects,
    "set_origin_feet": op_set_origin_feet,
    "scale_to_height": op_scale_to_height,
    "rename": op_rename,
    "pack_textures": op_pack_textures,
    "custom_script": op_custom_script,
}


# ----------------------------------------------------------------- main
def main():
    a = parse_args()
    if a.selftest:
        selftest(); return
    for k in ("input", "plan", "out"):
        if not getattr(a, k):
            raise SystemExit(f"--{k} is required")
    run(Path(a.input), json.loads(Path(a.plan).read_text()), Path(a.out))


def run(src, plan, out):
    LOG.clear()
    out.mkdir(parents=True, exist_ok=True)
    if not isinstance(plan, list):
        raise SystemExit("plan must be a JSON list of {op: ...} entries")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    if src.suffix.lower() in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(src))
    elif src.suffix.lower() == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(src))
    else:
        raise SystemExit(f"unsupported input: {src}")

    rigged = bool(armatures())
    before = sum(tri_count(o) for o in meshes())
    for entry in plan:
        op = entry.get("op")
        if op not in OPS:
            raise SystemExit(f"unknown op '{op}'. Known: {sorted(OPS)}")
        if rigged and op in TOPOLOGY_OPS:
            raise SystemExit(f"'{op}' changes topology and the input is rigged; run it before rigging.")
        OPS[op](**{k: v for k, v in entry.items() if k != "op"})

    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    select_only(meshes() + armatures())
    dest = out / "prepped.glb"
    bpy.ops.export_scene.gltf(filepath=str(dest), export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True)
    after = sum(tri_count(o) for o in meshes())
    result = {"input": str(src), "output": str(dest), "triangles_before": before,
              "triangles_after": after, "ops": LOG}
    (out / "fix_log.json").write_text(json.dumps(result, indent=2))
    print(f"prepped → {dest}  ({before} → {after} tris)")
    print(f"Next: blender_evaluate.py --input {dest} --out {out / 'eval'}")
    return result


# ----------------------------------------------------------------- selftest
def selftest():
    """One mesh like a generator ships it: a body with many UV shells plus a floating crumb.
    remove_loose_parts must drop the crumb and nothing else. No Meshy needed."""
    import tempfile
    tmp = Path(tempfile.mkdtemp(prefix="gc_fix_"))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.85, segments=32, ring_count=16, location=(0, 0, 0.85))
    body = bpy.context.object
    bpy.ops.object.shade_smooth()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.5)  # radians: many closed UV shells, like a texture atlas
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.mesh.primitive_cube_add(size=0.02, location=(0.6, -0.6, 0.3))  # outside the sphere
    select_only([body, bpy.context.object], body)
    bpy.ops.object.join()
    glb = tmp / "raw.glb"
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB")
    # min_ratio 0.5: every UV shell is under that size, so a shell miscounted as an island
    # would be deleted; the body as a whole is the biggest island and is always kept
    res = run(glb, [{"op": "remove_loose_parts", "min_ratio": 0.5}], tmp / "prepped")
    removed = res["ops"][0]["removed"]
    assert len(removed) == 1 and removed[0]["extent_m"] < 0.03, ("only the crumb should go", removed)
    assert res["triangles_before"] - res["triangles_after"] == 12, res
    print(f"SELFTEST OK → {tmp / 'prepped'}")


if __name__ == "__main__":
    main()
