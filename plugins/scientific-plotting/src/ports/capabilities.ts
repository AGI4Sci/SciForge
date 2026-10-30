/**
 * The capability-invoker seam of Scientific Plotting: the engine's artifact
 * version commit/read ports are built from the host system capability
 * invoker. Until the host capability bridge for plugins exists
 * (plugins/GAPS.md, G1), the DSH adapter runs the engine in its own
 * dependency-free degraded mode (unversioned renders; rerun/compare report
 * the engine's own capability error), which is the static package's existing
 * fallback contract rather than new plugin behaviour.
 */
import type { DomainMainSystemCapabilityInvoker } from '@sciforge/domain-sdk/host'

export type ScientificPlottingCapabilitiesPort = DomainMainSystemCapabilityInvoker
