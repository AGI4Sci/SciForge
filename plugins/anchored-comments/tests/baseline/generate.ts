/**
 * Baseline snapshot used by `tests/baseline-golden.test.ts`.
 *
 * Everything here goes through the plugin operations with a fixed clock and a
 * throwaway workspace, so the snapshot contains no absolute paths and no wall
 * clock values. `npm run baseline` is the only way to update `golden.json`.
 */
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ANCHORED_COMMENT_CAPABILITY_IDS } from '../../src/core/contract.js'
import { createAnchoredCommentsOperations } from '../../src/core/operations.js'
import {
  captureRequest,
  feedbackPacket,
  NOW,
  productFeedbackThread,
  researchThread
} from '../fixtures.js'

export async function baselineSnapshot(): Promise<Record<string, unknown>> {
  const workspaceRoot = await mkdtemp(join(await realpath(tmpdir()), 'anchored-baseline-'))
  const operations = createAnchoredCommentsOperations({
    env: {},
    now: () => new Date(NOW)
  })
  try {
    const snapshot: Record<string, unknown> = {}
    const invoke = (capabilityId: string, input: unknown): Promise<unknown> =>
      operations.invoke(capabilityId, input, workspaceRoot)

    snapshot['empty-list'] = await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.list, {})

    const thread = researchThread('thread-baseline-1')
    snapshot['upsert'] = await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.upsert, { thread })
    snapshot['get'] = await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.get, { threadId: thread.id })
    snapshot['list-by-target'] = await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.list, {
      targetKey: thread.anchor.targetKey
    })
    snapshot['capture-unavailable'] = await invoke(
      ANCHORED_COMMENT_CAPABILITY_IDS.capture,
      captureRequest()
    )

    const feedbackThread = productFeedbackThread()
    await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.upsert, { thread: feedbackThread })
    snapshot['feedback-submit-unconfigured'] = await invoke(
      ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback,
      { packet: feedbackPacket() }
    )
    snapshot['feedback-status'] = await invoke(
      ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus,
      { threadId: feedbackThread.id }
    )
    snapshot['delete'] = await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.delete, {
      threadId: thread.id
    })
    return snapshot
  } finally {
    operations.dispose()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = join(fileURLToPath(new URL('.', import.meta.url)), 'golden.json')
  await writeFile(target, `${JSON.stringify(await baselineSnapshot(), null, 2)}\n`)
  console.log(`wrote ${target}`)
}
