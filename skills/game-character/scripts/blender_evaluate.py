"""Headless Blender inspection: stats + turnaround contact sheet.

Run (Blender 4.2+):
  blender -b --python blender_evaluate.py -- --input model.glb --out eval_dir [--spec spec.json]
  blender -b --python blender_evaluate.py -- --selftest

Writes to --out:
  stats.json                 measurements (see collect_stats)
  tex_front|right|back|left.png   Workbench, studio light, texture color
  clay_front|right|back|left.png  Workbench, single color + cavity: shows geometry defects
  head.png                   textured close-up of the top 25% of the height, front
  sheet.png                  all of the above in one image (row1 textured, row2 clay, row3 head)

Camera convention: "front" = camera on -Y looking +Y (a glTF model imported by
Blender faces -Y). "right" = camera on +X, "back" = camera on +Y, "left" = camera on -X.
"""
import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Vector

VIEW_RES = 1024


# ----------------------------------------------------------------- args
def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--input")
    p.add_argument("--out")
    p.add_argument("--spec")
    p.add_argument("--selftest", action="store_true")
    return p.parse_args(argv)


# ----------------------------------------------------------------- scene
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def gltf_import_opts():
    """The glTF importer adds a radius-1 Icosphere (bone display shape, in a hidden collection) to
    every file with an armature; it would be measured as part of the model."""
    props = bpy.ops.import_scene.gltf.get_rna_type().properties.keys()
    return {"disable_bone_shape": True} if "disable_bone_shape" in props else {}


def import_model(path: Path):
    ext = path.suffix.lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(path), **gltf_import_opts())
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path))
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=str(path))
    else:
        raise SystemExit(f"unsupported input: {path}")


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def world_bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def top_center_x(lo, hi, frac=0.25):
    """Median world x of the vertices in the top `frac` of the height: where the head is.
    The bbox centre would follow a crumb or a held prop sideways; the median does not."""
    z_min = hi.z - (hi.z - lo.z) * frac
    xs = []
    for o in mesh_objects():
        co = np.empty(len(o.data.vertices) * 3, dtype=np.float32)
        o.data.vertices.foreach_get("co", co)
        m = np.array(o.matrix_world)
        w = co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]
        xs.append(w[w[:, 2] >= z_min, 0])
    xs = np.concatenate(xs) if xs else np.empty(0)
    return float(np.median(xs)) if xs.size else (lo.x + hi.x) / 2


# ----------------------------------------------------------------- stats
def welded_components(bm):
    """Edge-connected pieces, counting vertices at the same position as one vertex. A glTF import
    splits vertices at UV seams and hard edges; without the weld every UV shell of a textured
    mesh reads as a loose island. Returns (lists of BMVerts, position id per vertex index)."""
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
    return list(comps.values()), pos_id


def island_stats(me):
    """Connected components by edges (welded by position): count, and the smallest island's extent ratio."""
    bm = bmesh.new()
    bm.from_mesh(me)
    islands, pos_id = welded_components(bm)
    # an edge split along a seam appears twice with one face each; count faces per welded edge
    faces_per_edge = {}
    for e in bm.edges:
        key = tuple(sorted((pos_id[e.verts[0].index], pos_id[e.verts[1].index])))
        faces_per_edge[key] = faces_per_edge.get(key, 0) + len(e.link_faces)
    non_manifold = sum(1 for n in faces_per_edge.values() if n != 2)
    loose_verts = sum(1 for v in bm.verts if not v.link_edges)
    extents = []
    for comp in islands:
        xs = [p.co.x for p in comp]; ys = [p.co.y for p in comp]; zs = [p.co.z for p in comp]
        extents.append(max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)))
    bm.free()
    return {
        "islands": len(islands),
        "island_extents_sorted": sorted(extents)[:10],
        "non_manifold_edges": non_manifold,
        "loose_vertices": loose_verts,
    }


def uv_stats(me):
    if not me.uv_layers:
        return {"has_uv": False}
    uv = me.uv_layers.active.data
    n = len(uv)
    if n == 0:
        return {"has_uv": False}
    arr = np.empty(n * 2, dtype=np.float32)
    uv.foreach_get("uv", arr)
    arr = arr.reshape(-1, 2)
    inside = np.all((arr >= -0.001) & (arr <= 1.001), axis=1).mean()
    return {"has_uv": True, "uv_layers": len(me.uv_layers), "fraction_inside_0_1": round(float(inside), 4)}


def collect_stats(spec: dict | None):
    objs = mesh_objects()
    if not objs:
        raise SystemExit("no mesh objects after import")
    lo, hi = world_bbox(objs)
    size = hi - lo
    dg = bpy.context.evaluated_depsgraph_get()
    tris = verts = faces = 0
    per_object = []
    worst_islands = 0
    worst_nm = 0
    smallest_extent = None
    loose = 0
    uv_info = {}
    for o in objs:
        me = o.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        t = len(me.loop_triangles)
        tris += t; verts += len(me.vertices); faces += len(me.polygons)
        isl = island_stats(o.data)
        worst_islands += isl["islands"]
        worst_nm += isl["non_manifold_edges"]
        loose += isl["loose_vertices"]
        if isl["island_extents_sorted"]:
            s = isl["island_extents_sorted"][0]
            smallest_extent = s if smallest_extent is None else min(smallest_extent, s)
        uvi = uv_stats(o.data)
        uv_info[o.name] = uvi
        per_object.append({
            "name": o.name, "triangles": t, "vertices": len(me.vertices),
            "materials": [m.name for m in o.data.materials if m],
            "vertex_groups": len(o.vertex_groups),
            "armature_modifier": any(m.type == "ARMATURE" for m in o.modifiers),
            "islands": isl["islands"], "non_manifold_edges": isl["non_manifold_edges"],
        })
        o.evaluated_get(dg).to_mesh_clear()

    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    images = []
    for img in bpy.data.images:
        if img.users and img.size[0]:
            images.append({"name": img.name, "size": list(img.size), "packed": img.packed_file is not None})

    height = round(size.z, 4)
    stats = {
        "input": bpy.data.filepath or None,
        "triangles": tris, "vertices": verts, "faces": faces,
        "mesh_objects": len(objs),
        "objects": per_object,
        "materials": sorted({m.name for m in bpy.data.materials if m.users}),
        "images": images,
        "bbox_min": [round(v, 4) for v in lo], "bbox_max": [round(v, 4) for v in hi],
        "size_xyz_m": [round(v, 4) for v in size],
        "height_m": height,
        "feet_z": round(lo.z, 4),
        "horizontal_center_offset": [round(((lo + hi) / 2).x, 4), round(((lo + hi) / 2).y, 4)],
        "armatures": len(armatures),
        "bones": sum(len(a.data.bones) for a in armatures),
        "bone_names_sample": [b.name for a in armatures for b in list(a.data.bones)[:12]],
        "islands_total": worst_islands,
        "smallest_island_extent_m": None if smallest_extent is None else round(smallest_extent, 4),
        "smallest_island_ratio_to_height": None if (smallest_extent is None or height == 0) else round(smallest_extent / height, 5),
        "non_manifold_edges": worst_nm,
        "loose_vertices": loose,
        "uv": uv_info,
    }
    if spec:
        budget = int(spec.get("triangle_budget", 0) or 0)
        target_h = float(spec.get("height_meters", 0) or 0)
        stats["checks"] = {
            "triangles_within_budget": (tris <= budget * 1.05) if budget else None,
            "height_within_2pct": (abs(height - target_h) <= 0.02 * target_h) if target_h else None,
            "feet_on_ground": abs(lo.z) <= 0.01,
            "centered_xy": max(abs(((lo + hi) / 2).x), abs(((lo + hi) / 2).y)) <= 0.02,
            "has_rig": len(armatures) > 0,
        }
    return stats


# ----------------------------------------------------------------- renders
def setup_render(out_dir: Path):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x = sc.render.resolution_y = VIEW_RES
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.film_transparent = False
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.use_world_space_lighting = True
    sh.show_shadows = False
    sh.show_specular_highlight = True
    sh.background_type = "VIEWPORT"
    sh.background_color = (0.86, 0.86, 0.86)
    cam_data = bpy.data.cameras.new("EvalCam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("EvalCam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def aim(cam, target: Vector, direction: Vector, dist: float, ortho_scale: float):
    cam.location = target + direction.normalized() * dist
    cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = ortho_scale
    cam.data.clip_end = dist * 4


VIEWS = {
    "front": Vector((0, -1, 0)),
    "right": Vector((1, 0, 0)),
    "back": Vector((0, 1, 0)),
    "left": Vector((-1, 0, 0)),
}


def render(path: Path):
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def render_views(out_dir: Path, lo: Vector, hi: Vector):
    cam = setup_render(out_dir)
    sh = bpy.context.scene.display.shading
    center = (lo + hi) / 2
    size = hi - lo
    extent = max(size.x, size.y, size.z) * 1.12
    dist = extent * 3
    files = {}
    for mode in ("tex", "clay"):
        if mode == "tex":
            sh.color_type = "TEXTURE"; sh.show_cavity = False
        else:
            sh.color_type = "SINGLE"; sh.single_color = (0.78, 0.78, 0.78)
            sh.show_cavity = True; sh.cavity_type = "BOTH"
        for name, d in VIEWS.items():
            aim(cam, center, d, dist, extent)
            f = out_dir / f"{mode}_{name}.png"
            render(f)
            files[f"{mode}_{name}"] = str(f)
    # head close-up: top 25 % of the height, front, textured
    sh.color_type = "TEXTURE"; sh.show_cavity = False
    head_center = Vector((top_center_x(lo, hi), center.y, hi.z - size.z * 0.125))
    aim(cam, head_center, VIEWS["front"], dist, size.z * 0.28)
    f = out_dir / "head.png"
    render(f)
    files["head"] = str(f)
    return files


def load_png(path: Path) -> np.ndarray:
    img = bpy.data.images.load(str(path))
    w, h = img.size
    arr = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    bpy.data.images.remove(img)
    return arr.reshape(h, w, 4)


def contact_sheet(files: dict, out: Path):
    """Row 1: textured F/R/B/L. Row 2: clay F/R/B/L. Row 3: head close-up (col 1)."""
    rows = [
        [files["tex_front"], files["tex_right"], files["tex_back"], files["tex_left"]],
        [files["clay_front"], files["clay_right"], files["clay_back"], files["clay_left"]],
        [files["head"], None, None, None],
    ]
    cell = VIEW_RES
    sheet = np.ones((cell * 3, cell * 4, 4), dtype=np.float32)
    sheet[..., :3] = 0.86
    for r, row in enumerate(rows):
        for c, f in enumerate(row):
            if f is None:
                continue
            tile = load_png(Path(f))
            # Blender image rows are bottom-up; keep that convention for the sheet too.
            y0 = cell * (2 - r)
            sheet[y0:y0 + cell, cell * c:cell * (c + 1)] = tile
    img = bpy.data.images.new("sheet", cell * 4, cell * 3, alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = str(out)
    img.file_format = "PNG"
    img.save()


# ----------------------------------------------------------------- main
def run(input_path: Path, out_dir: Path, spec: dict | None):
    out_dir.mkdir(parents=True, exist_ok=True)
    reset_scene()
    import_model(input_path)
    stats = collect_stats(spec)
    stats["input"] = str(input_path)
    lo = Vector(stats["bbox_min"]); hi = Vector(stats["bbox_max"])
    files = render_views(out_dir, lo, hi)
    contact_sheet(files, out_dir / "sheet.png")
    stats["renders"] = files
    stats["sheet"] = str(out_dir / "sheet.png")
    (out_dir / "stats.json").write_text(json.dumps(stats, indent=2))
    print(json.dumps({k: stats[k] for k in ("triangles", "height_m", "armatures", "bones", "islands_total",
                                              "non_manifold_edges", "materials")}, indent=2))
    print(f"sheet: {out_dir / 'sheet.png'}")


def selftest():
    """Build a stand-in biped (capsule + cube head + armature), export GLB, evaluate it."""
    import tempfile
    tmp = Path(tempfile.mkdtemp(prefix="gc_selftest_"))
    reset_scene()
    bpy.ops.mesh.primitive_cylinder_add(radius=0.2, depth=1.4, location=(0, 0, 0.7))
    body = bpy.context.object; body.name = "Body"
    bpy.ops.mesh.primitive_cube_add(size=0.3, location=(0, 0, 1.55))
    head = bpy.context.object; head.name = "Head"
    bpy.ops.mesh.primitive_cube_add(size=0.02, location=(0.6, 0, 0.3))
    bpy.context.object.name = "Crumb"
    bpy.ops.object.armature_add(location=(0, 0, 0))
    arm = bpy.context.object
    body.select_set(True); head.select_set(True); arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    glb = tmp / "selftest.glb"
    bpy.ops.export_scene.gltf(filepath=str(glb))
    run(glb, tmp / "eval", {"triangle_budget": 1000, "height_meters": 1.7})
    st = json.loads((tmp / "eval" / "stats.json").read_text())
    assert st["armatures"] == 1 and st["bones"] >= 1, st
    # Body, Head, Crumb and nothing else: a rigged glTF import must not bring helper meshes
    assert st["mesh_objects"] == 3 and abs(st["height_m"] - 1.7) < 0.005, st
    # three closed primitives: a glTF import splits their vertices at hard edges and UV seams,
    # which must not read as extra islands or open edges
    assert st["islands_total"] == 3 and st["non_manifold_edges"] == 0, st
    assert (tmp / "eval" / "sheet.png").exists()
    # head close-up: the crumb at x=0.6 must not pull the frame sideways. Measure where the
    # figure lands: centre of the pixels that differ from the background corner
    head = load_png(Path(st["renders"]["head"]))
    mask = np.abs(head[..., :3] - head[-1, 0, :3]).sum(axis=2) > 0.03
    cx = np.nonzero(mask)[1].mean() / mask.shape[1]
    assert 0.45 < cx < 0.55, ("head close-up off-centre", round(float(cx), 3))
    print(f"SELFTEST OK → {tmp / 'eval'}")


if __name__ == "__main__":
    a = parse_args()
    if a.selftest:
        selftest()
    else:
        if not a.input or not a.out:
            raise SystemExit("--input and --out are required")
        spec = json.loads(Path(a.spec).read_text()) if a.spec else None
        run(Path(a.input), Path(a.out), spec)
