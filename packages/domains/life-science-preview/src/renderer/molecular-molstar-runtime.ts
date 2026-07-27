// Keep the Mol* Viewer and structure helpers behind one dynamic import boundary.
// Importing the helpers statically while the Viewer itself is lazy causes Rollup to
// split Mol*'s circular internal barrels across chunks, which can break execution
// order in production builds.
export { Viewer } from 'molstar/lib/apps/viewer/app'
export { StructureElement } from 'molstar/lib/mol-model/structure/structure/element'
export { StructureProperties } from 'molstar/lib/mol-model/structure/structure/properties'
export { Unit } from 'molstar/lib/mol-model/structure/structure/unit'
export { createStructureRepresentationParams } from 'molstar/lib/mol-plugin-state/helpers/structure-representation-params'
export { Vec3 } from 'molstar/lib/mol-math/linear-algebra'
