/**
 * Stage-one DSH configuration for Scientific Plotting.
 *
 * The static module builds workspace services from `host.capabilities`
 * (artifact version commit/read ports). The host capability bridge for
 * plugins does not exist yet (plugins/GAPS.md, G1), so the stage-one adapter
 * constructs the engine in its own dependency-free degraded mode:
 * status/mapData/render work (renders stay unversioned with the engine's own
 * warning), while rerun/compare report the engine's existing capability
 * error. No plugin behaviour is added — this is the static package's
 * published fallback contract. When the bridge lands, the adapter passes the
 * invoker to `createScientificPlottingServiceFactory` and no plugin code
 * changes.
 */
import { z } from 'zod'

export const scientificPlottingConfigSchema = z.object({}).strict()

export type ScientificPlottingConfig = z.infer<typeof scientificPlottingConfigSchema>
