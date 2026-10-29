/**
 * The probe stage of the Propose–Probe–Compose loop: running a proposed harness against
 * the task and recording the rollout.
 * @module @deepseek-ai/dsh-ppc-probe
 */

export {
  probeCwd,
  probeWorkspace,
  stageHarness,
  type StagedHarness,
} from './harness.ts'

export {
  probeDir,
  runProbe,
  type ProbeOptions,
  type ProbeResult,
} from './probe.ts'

export {
  runProbes,
  type ProbeCandidate,
  type ProbeRunOptions,
  type ProbeRunResult,
} from './runner.ts'

export {
  hasReadableEvents,
  probeCandidate,
  probeEvidence,
  probeRollout,
  producedBody,
  trajectoryOf,
} from './evidence.ts'
