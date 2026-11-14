"""Headless Blender: rigged GLB → Unreal-ready FBX (+ textures beside it). Base mesh only.

Run (Blender 4.2+):
  blender -b --python blender_export_ue.py -- --input rigged/character.glb --spec spec.json --out export_dir

What it does
  1. imports the rigged GLB (meters, +Z forward in glTF → -Y forward in Blender)
  2. names things to the spec: mesh SK_<Name>, materials M_<Name>_*, armature stays "Armature"
     (UE's FBX importer skips a Blender armature node literally named "Armature", so the
     skeleton root is the first real bone instead of an extra "Armature" root)
  3. exports <out>/<SK_Name>.fbx with the settings in ue_common.UE_FBX_OPTS, textures copied
     to <out>/<SK_Name>.fbm/
  4. writes <out>/export_log.json with bone count, triangle count and the exact export options

No topology operations here: the mesh is already skinned. Run blender_fix.py before rigging.
For a modular character (spec.parts), run blender_assemble.py instead; it exports the base too.
"""
import json
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ue_common import export_fbx, import_any, join_meshes, sanitize, tri_count  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--spec", required=True)
    p.add_argument("--out", required=True)
    return p.parse_args(argv)


def prepare_base(spec, objs):
    """Name the base mesh/armature/materials to the spec. Returns (mesh, armature)."""
    name = sanitize(spec["name"])
    arms = [o for o in objs if o.type == "ARMATURE"]
    if len(arms) != 1:
        raise SystemExit(f"expected 1 armature in the rigged file, found {len(arms)}")
    arm = arms[0]
    arm.name = "Armature"
    arm.data.name = f"{name}_Skeleton"
    mesh = join_meshes(objs, f"SK_{name}")
    prefix = f"M_{name}_"
    for m in bpy.data.materials:
        if m.users:
            base = sanitize(m.name)
            m.name = base if base.startswith(prefix) else f"{prefix}{base}"
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0
    return mesh, arm


def main():
    a = parse_args()
    spec = json.loads(Path(a.spec).read_text())
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = import_any(a.input)
    mesh, arm = prepare_base(spec, objs)
    fbx = out / f"{mesh.name}.fbx"
    opts = export_fbx(fbx, [mesh, arm])
    log = {
        "input": str(a.input), "fbx": str(fbx), "mesh": mesh.name, "triangles": tri_count(mesh),
        "armature": arm.name, "bones": len(arm.data.bones),
        "bone_names_sample": [b.name for b in list(arm.data.bones)[:12]],
        "materials": [m.name for m in bpy.data.materials if m.users],
        "images": [i.name for i in bpy.data.images if i.users],
        "export_options": opts,
    }
    (out / "export_log.json").write_text(json.dumps(log, indent=2))
    print(json.dumps({k: log[k] for k in ("fbx", "triangles", "bones", "materials")}, indent=2))
    print(f"Next: blender_evaluate.py --input {fbx} --out {out / 'eval'} for the final sheet, "
          f"then import into UE5 (references/ue5-import.md)")


if __name__ == "__main__":
    main()
