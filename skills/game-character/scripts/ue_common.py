"""Shared helpers for the headless Blender scripts (import with sys.path on the scripts dir)."""
import math
import bpy
from mathutils import Vector

UE_FBX_OPTS = dict(
    apply_unit_scale=True,          # scene meters → UE centimeters
    apply_scale_options="FBX_SCALE_ALL",
    global_scale=1.0,
    bake_space_transform=False,
    mesh_smooth_type="FACE",
    use_tspace=True,                # tangents for normal maps
    use_mesh_modifiers=True,
    add_leaf_bones=False,
    use_armature_deform_only=True,
    armature_nodetype="NULL",
    bake_anim=False,
    path_mode="COPY",
    embed_textures=False,
)


def select_only(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def export_fbx(filepath, objects, skeletal=True):
    """Export the given objects with the UE settings. Returns the options used."""
    select_only(objects, next((o for o in objects if o.type == "ARMATURE"), objects[0]))
    opts = dict(UE_FBX_OPTS, filepath=str(filepath), use_selection=True,
                object_types={"ARMATURE", "MESH"} if skeletal else {"MESH"})
    bpy.ops.export_scene.fbx(**opts)
    return {k: (sorted(v) if isinstance(v, set) else v) for k, v in opts.items()}


def gltf_import_opts():
    """The glTF importer adds a radius-1 Icosphere (bone display shape, in a hidden collection) to
    every file with an armature; it would be measured, counted and joined as part of the model."""
    props = bpy.ops.import_scene.gltf.get_rna_type().properties.keys()
    return {"disable_bone_shape": True} if "disable_bone_shape" in props else {}


def import_any(path):
    p = str(path); ext = p.lower().rsplit(".", 1)[-1]
    before = set(bpy.data.objects)
    if ext in ("glb", "gltf"):
        bpy.ops.import_scene.gltf(filepath=p, **gltf_import_opts())
    elif ext == "fbx":
        bpy.ops.import_scene.fbx(filepath=p)
    elif ext == "obj":
        bpy.ops.wm.obj_import(filepath=p)
    else:
        raise SystemExit(f"unsupported file: {p}")
    return [o for o in bpy.data.objects if o not in before]


def world_bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def tri_count(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


def sanitize(s):
    return "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in s).strip("_") or "Unnamed"


def join_meshes(objs, name):
    objs = [o for o in objs if o.type == "MESH"]
    if not objs:
        raise SystemExit(f"join_meshes({name}): no mesh objects")
    select_only(objs, objs[0])
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.object
    o.name = o.data.name = name
    return o


def shade_smooth(obj, angle_deg=40):
    select_only([obj], obj)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    except (AttributeError, RuntimeError):
        bpy.ops.object.shade_smooth()
