# UE5 import and retarget notes

The skill exports `export/SK_<Name>.fbx` with its texture files copied beside it in `export/` (not embedded).
These steps are the human half of "done"; the report's Waiting-on-you block points here.

## Export settings used (blender_export_ue.py)
- Selected only: mesh objects + armature. Armature object stays named `Armature` so UE's
  importer does not add an extra "Armature" root bone.
- `apply_unit_scale=True`, `apply_scale_options=FBX_SCALE_ALL`, scene in meters →
  UE reads centimeters. A 1.75 m character must show ~175 cm in the Skeletal Mesh editor.
- `add_leaf_bones=False`, `use_armature_deform_only=True`, `mesh_smooth_type=FACE`,
  `use_tspace=True` (tangents for the normal map), `bake_anim=False` (clips are separate files).
- Blender default axes (-Z forward, Y up); UE's importer converts. If the character faces
  +X in UE after import, the forward axis is fine; if it faces +Y, re-import with
  "Force Front XAxis" checked in the FBX import options.

## Import (UE 5.4+)
1. Content Browser → Import → pick the FBX. Import as **Skeletal Mesh**, Skeleton: none
   (creates `SK_<Name>_Skeleton`). Leave "Import Mesh" and "Import Materials/Textures" on.
   Uncheck "Import Animations" for the character file; import the `rigged/walking*.fbx` and
   `rigged/running*.fbx` clips afterwards with Skeleton = the one just created.
2. Open the Skeletal Mesh. Verify: bounds height ≈ spec height in cm; one material slot
   per `M_<Name>_*`; textures assigned (base color sRGB, normal = Normal Map compression,
   roughness/metallic = Masks, sRGB off). These are the values to put in the report as Verified.
3. Materials: Meshy exports metallic/roughness as separate grayscale maps. Plug roughness
   into Roughness, metallic into Metallic; do not leave them in Base Color.

## Modular import (spec.export.modular, the default)
The Assemble stage exports every part as its own skeletal mesh skinned to the base skeleton.
1. Import `SK_<Name>.fbx` first (Skeletal Mesh, Skeleton: none) → `SK_<Name>_Skeleton`.
2. Import each `SK_<Name>_<part>.fbx` with **Skeleton = `SK_<Name>_Skeleton`**. The part has
   the same bone hierarchy (deform bones only), so no new bones are added. If the importer
   complains about a missing bone, the part was exported against a different rig; re-run Assemble.
3. In the character Blueprint: one SkeletalMeshComponent for the base, one child
   SkeletalMeshComponent per part, each set to **Leader Pose Component = base** (older
   builds call it Master Pose). Parts follow the base animation with zero extra cost per
   bone; swapping an outfit is swapping a mesh asset at runtime.
4. Rigid accessories have a second export, `SM_<Name>_<part>.fbx`, as a static mesh at its own
   attach origin, and `sockets.json` gives the bone and the offset in Blender axes/cm. Attach
   it with a socket only after the skeletal version is confirmed in place; the socket offset
   still needs the Blender→UE axis conversion checked by eye (Assumed, not verified).
   Static-on-socket is cheaper than a skinned part; use it for anything that never deforms.
5. Weight transfer caveat: deform parts copy weights from the nearest base surface. A part
   that intersects the base during animation (armpit of a jacket) needs either a small
   `offset_m` outward or a Morph/push in Blender; that is a per-part fix, not a generator one.

## Retarget to Manny (so stock UE5 animations work)
The Meshy rig is a generic humanoid skeleton, not Manny. Use the IK Retargeter:
1. Create an IK Rig for `SK_<Name>` (right-click the mesh → Create → IK Rig). Set the
   retarget root to the pelvis bone. Use **Auto Create Retarget Chains** (5.4+) and check the
   result: spine, neck, head, both arms, both legs, hands if finger bones exist.
2. Create an IK Retargeter: source = Manny's IK Rig (`IK_Mannequin`), target = the new IK Rig.
   Use **Auto Map Chains** and **Auto Align** the retarget pose (the Meshy rig is in A-pose;
   Manny's reference is A-pose too, so alignment should be small).
3. Export retargeted animations (right-click any Manny animation → Retarget Animation Assets)
   or use the Retargeter at runtime in the Animation Blueprint.

Assumed: Meshy's bone naming is not the UE naming; auto-mapping works by hierarchy, so a
missing chain means the rig lacks those bones (fingers are the usual gap). Report it.

## Checks to run before calling it done
- Height in cm matches spec (Skeletal Mesh editor → bounds, or place in level next to Manny).
- Drop the mesh in a level with the default walking clip: no exploding verts, no inverted
  limbs. A limb that stretches on animation means the retarget chain is mapped to the
  wrong bone, not a mesh problem.
- Triangle count in the Skeletal Mesh editor (LOD0) equals `stats.json` triangles.
