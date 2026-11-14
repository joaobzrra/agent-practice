"""Procedural part generators (headless Blender). Hard-surface accessories are built by
code, not by a generator: the result has exact topology, exact colours, and costs no credits.

Run (Blender 4.2+):
  blender -b --python build_part.py -- --generator glasses --params p.json --out parts/glasses/raw.glb
  blender -b --python build_part.py -- --list

Conventions every generator follows (blender_assemble.py relies on them):
  - units: meters; +Z up; the part FACES -Y (same as a glTF model imported into Blender)
  - origin (0,0,0) is the attach point: glasses → bridge centre at eye level,
    drawstrings → neckline centre where the cords emerge
  - one mesh object named after the generator, materials named M_<generator>_<slot>
  - writes <out> as GLB and prints a JSON line with triangle count

Add a generator: write a function `gen_<name>(params) -> bpy.types.Object` and register it in GENERATORS.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--generator")
    p.add_argument("--params")
    p.add_argument("--out")
    p.add_argument("--list", action="store_true")
    return p.parse_args(argv)


# ----------------------------------------------------------------- helpers
def material(name, rgb, roughness=0.5, metallic=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return m


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = o.data.name = name
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    return o


def cylinder(radius, depth, location, rotation=(0, 0, 0), verts=12):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=verts,
                                        location=location, rotation=rotation)
    return bpy.context.object


def smooth(obj, angle_deg=40):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    except (AttributeError, RuntimeError):
        bpy.ops.object.shade_smooth()


# ----------------------------------------------------------------- glasses
def gen_glasses(p):
    """Round glasses. Origin: bridge centre, at eye level, lens plane at y=0."""
    r = float(p.get("lens_radius", 0.021))
    t = float(p.get("rim_thickness", 0.0025))
    pd = float(p.get("pupil_distance", 0.064))
    tl = float(p.get("temple_length", 0.12))
    frame_mat = material("M_glasses_frame", p.get("color", [0.02, 0.02, 0.02]), roughness=0.35)
    lens_mat = material("M_glasses_lens", p.get("lens_color", [0.08, 0.08, 0.09]), roughness=0.08)
    parts = []
    rx = math.radians(90)
    for s in (-1, 1):
        cx = s * pd / 2
        bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=t, major_segments=28,
                                         minor_segments=8, location=(cx, 0, 0), rotation=(rx, 0, 0))
        rim = bpy.context.object; assign(rim, frame_mat); parts.append(rim)
        bpy.ops.mesh.primitive_circle_add(radius=r - t * 0.4, vertices=28, fill_type="NGON",
                                          location=(cx, 0.0008, 0), rotation=(rx, 0, 0))
        lens = bpy.context.object; assign(lens, lens_mat); parts.append(lens)
        # temple: from the outer edge of the rim backwards (+Y), slightly above centre
        ox = s * (pd / 2 + r)
        temple = cylinder(t * 0.9, tl, (ox, tl / 2, r * 0.45), (rx, 0, 0), verts=8)
        assign(temple, frame_mat); parts.append(temple)
        hinge = cylinder(t * 1.3, t * 3, (ox, 0, r * 0.45), (rx, 0, 0), verts=8)
        assign(hinge, frame_mat); parts.append(hinge)
        # ear hook: short piece angled down at the end of the temple
        hook_len = tl * 0.3
        hook = cylinder(t * 0.85, hook_len, (ox, tl + hook_len * 0.35, r * 0.45 - hook_len * 0.35),
                        (math.radians(-135), 0, 0), verts=8)  # axis → (+Y, -Z): back and down
        assign(hook, frame_mat); parts.append(hook)
    inner = pd / 2 - r
    bridge = cylinder(t * 0.9, inner * 2 + t * 2, (0, 0, r * 0.35), (0, math.radians(90), 0), verts=8)
    assign(bridge, frame_mat); parts.append(bridge)
    obj = join(parts, "glasses")
    smooth(obj, 45)
    return obj


# ----------------------------------------------------------------- drawstrings
def gen_drawstrings(p):
    """Two hoodie cords with aglets. Origin: neckline centre; cords hang down (-Z) and
    sit slightly in front of the chest (-Y). Deform part: weights come from the base."""
    L = float(p.get("length", 0.16))
    sp = float(p.get("spacing", 0.05))
    cr = float(p.get("cord_radius", 0.004))
    cord_mat = material("M_drawstrings_cord", p.get("color", [0.92, 0.88, 0.78]), roughness=0.8)
    tip_mat = material("M_drawstrings_aglet", p.get("aglet_color", [0.9, 0.9, 0.9]), roughness=0.4)
    parts = []
    for s in (-1, 1):
        x0 = s * sp / 2
        cd = bpy.data.curves.new(f"cord{s}", "CURVE")
        cd.dimensions = "3D"; cd.bevel_depth = cr; cd.bevel_resolution = 3; cd.resolution_u = 10
        cd.use_fill_caps = True
        sp_ = cd.splines.new("BEZIER")
        pts = [  # (x, y, z): emerges from inside the neckline, hangs down, slight outward sway
            (x0, 0.004, 0.015),
            (x0 * 1.05, -0.006, -L * 0.45),
            (x0 * 1.18, -0.010, -L),
        ]
        sp_.bezier_points.add(len(pts) - 1)
        for bp, co in zip(sp_.bezier_points, pts):
            bp.co = Vector(co); bp.handle_left_type = bp.handle_right_type = "AUTO"
        cobj = bpy.data.objects.new(f"cord{s}", cd)
        bpy.context.scene.collection.objects.link(cobj)
        bpy.ops.object.select_all(action="DESELECT")
        cobj.select_set(True); bpy.context.view_layer.objects.active = cobj
        bpy.ops.object.convert(target="MESH")
        cobj = bpy.context.object; assign(cobj, cord_mat); parts.append(cobj)
        tip = cylinder(cr * 1.25, cr * 6, (x0 * 1.18, -0.010, -L - cr * 2.5), (0, 0, 0), verts=10)
        assign(tip, tip_mat); parts.append(tip)
    obj = join(parts, "drawstrings")
    smooth(obj, 50)
    return obj


GENERATORS = {"glasses": gen_glasses, "drawstrings": gen_drawstrings}


# ----------------------------------------------------------------- main
def main():
    a = parse_args()
    if a.list:
        print(json.dumps(sorted(GENERATORS))); return
    if a.generator not in GENERATORS:
        raise SystemExit(f"unknown generator '{a.generator}'. Known: {sorted(GENERATORS)}")
    params = json.loads(Path(a.params).read_text()) if a.params else {}
    out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    obj = GENERATORS[a.generator](params)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", use_selection=True, export_apply=True)
    obj.data.calc_loop_triangles()
    print(json.dumps({"generator": a.generator, "out": str(out), "triangles": len(obj.data.loop_triangles),
                      "materials": [m.name for m in obj.data.materials]}))


if __name__ == "__main__":
    main()
