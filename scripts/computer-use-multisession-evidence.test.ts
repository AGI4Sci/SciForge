import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildMultisessionEvidence } from './computer-use-multisession-evidence'

function successfulChild(
  label: string,
  start: string,
  end: string,
  backend: 'browser-cdp' | 'windows-uia' = 'browser-cdp',
) {
  return {
    sessionId: `session-${label}`,
    targetId: `${backend === 'browser-cdp' ? 'cdp:managed' : 'uia:managed'}:${label}`,
    requestId: `request-${label}`,
    result: {
      ok: true,
      data: {
        backend,
        requestedIsolation: 'host-app-scoped',
        effectiveIsolation: 'host-app-scoped',
        degraded: false,
        action: {
          kind: 'click', name: `Commit ${label}`,
          outcome: {
            committed: true, mayHaveTakenEffect: true, verification: 'verified',
            evidence: { url: `http://127.0.0.1/private/${label}`, token: 'secret' },
          },
        },
        verification: { status: 'verified', matched: true },
        finalObservation: {
          semanticTree: [{ role: 'status', name: `${label.toUpperCase()}_COMMITTED` }],
        },
        timeline: { actionStartedAt: start, actionCompletedAt: end },
      },
    },
  }
}

function capture() {
  const children = [
    successfulChild('alpha', '2026-08-11T00:00:00.100Z', '2026-08-11T00:00:00.400Z'),
    successfulChild('beta', '2026-08-11T00:00:00.200Z', '2026-08-11T00:00:00.500Z'),
    {
      sessionId: 'session-delta', targetId: 'cdp:managed:delta', requestId: 'request-delta',
      result: { ok: false, error: { code: 'TIMEOUT', message: 'deadline expired', retryable: true } },
    },
  ]
  return {
    runId: 'acceptance-run-1',
    batch: {
      ok: true,
      data: { requestedCount: 3, successCount: 2, failureCount: 1, results: children },
      provenance: { requestId: 'parent-batch-request' },
    },
    releases: children.map((child) => ({
      ok: true,
      data: {
        sessionId: child.sessionId, targetId: child.targetId,
        state: 'closed', reason: 'client_release',
      },
    })),
    finalCapabilities: {
      ok: true,
      data: {
        runtime: {
          counts: {
            sessions: 0, requests: 0, activeLeases: 0,
            tombstones: 3, releasedLeaseTombstones: 3,
          },
          activeChannels: 0, activeRequests: 0, cleanupPending: 0,
          waiters: 0, backendHandles: 0,
        },
      },
    },
    harnessState: {
      alpha: {
        state: 'ALPHA_COMMITTED', url: 'http://127.0.0.1/private',
        cookie: 'session=private-cookie', localStorage: 'private-storage',
        artifact: 'C:\\Users\\private\\capture.png',
      },
      apiKey: 'must-not-survive',
    },
  }
}

describe('Computer Use multisession evidence exporter', () => {
  it('validates overlap, releases and resource zero while redacting sensitive values', () => {
    const evidence = buildMultisessionEvidence(capture())
    assert.deepEqual(evidence.batch, {
      requestId: 'parent-batch-request',
      requestedCount: 3,
      successCount: 2,
      failureCount: 1,
      actionOverlapMs: 200,
    })
    assert.equal(evidence.sessions[0].targetId, 'cdp:managed:alpha')
    assert.equal(
      ((evidence.sessions[0].action as Record<string, unknown>).outcome as {
        evidence: Record<string, unknown>
      }).evidence.url,
      '<redacted-sensitive-value>',
    )
    assert.equal(evidence.harnessState?.apiKey, '<redacted>')
    const alpha = evidence.harnessState?.alpha as Record<string, unknown>
    assert.equal(alpha.url, '<redacted-sensitive-value>')
    assert.equal(alpha.cookie, '<redacted>')
    assert.equal(alpha.localStorage, '<redacted>')
    assert.equal(alpha.artifact, '<redacted-sensitive-value>')
    assert.equal(evidence.finalResources.sessions, 0)
    assert.equal(evidence.finalResources.tombstones, 3)
  })

  it('accepts overlapping CDP and Windows UIA children while preserving each backend', () => {
    const mixed = capture()
    mixed.batch.data.results[1] = successfulChild(
      'beta',
      '2026-08-11T00:00:00.200Z',
      '2026-08-11T00:00:00.500Z',
      'windows-uia',
    )
    mixed.releases[1].data.targetId = mixed.batch.data.results[1].targetId

    const evidence = buildMultisessionEvidence(mixed)
    assert.deepEqual(
      evidence.sessions.map((session) => session.backend),
      ['browser-cdp', 'windows-uia', undefined],
    )
    assert.equal(evidence.batch.actionOverlapMs, 200)
  })

  it('rejects duplicate targets or an incomplete release set', () => {
    const duplicate = capture()
    duplicate.batch.data.results[1].targetId = duplicate.batch.data.results[0].targetId
    assert.throws(() => buildMultisessionEvidence(duplicate), /targetId values must be unique/u)

    const missingRelease = capture()
    missingRelease.releases.pop()
    assert.throws(() => buildMultisessionEvidence(missingRelease), /exactly one successful close/u)

    const mismatchedTarget = capture()
    mismatchedTarget.releases[0].data.targetId = 'cdp:managed:other'
    assert.throws(() => buildMultisessionEvidence(mismatchedTarget), /release targetId does not match/u)
  })

  it('rejects active resource residue and serialized successful actions', () => {
    const residue = capture()
    residue.finalCapabilities.data.runtime.backendHandles = 1
    assert.throws(() => buildMultisessionEvidence(residue), /backendHandles must be zero/u)

    const serialized = capture()
    serialized.batch.data.results[1] = successfulChild(
      'beta', '2026-08-11T00:00:00.500Z', '2026-08-11T00:00:00.800Z',
    )
    assert.throws(() => buildMultisessionEvidence(serialized), /do not overlap/u)
  })

  it('rejects degraded isolation or an unverified action outcome', () => {
    const degraded = capture()
    degraded.batch.data.results[0].result.data.degraded = true
    assert.throws(() => buildMultisessionEvidence(degraded), /degraded must be false/u)

    const unverified = capture()
    unverified.batch.data.results[0].result.data.action.outcome.verification = 'unverified'
    assert.throws(() => buildMultisessionEvidence(unverified), /backend-verified/u)

    const unsafeIdentity = capture()
    unsafeIdentity.runId = 'http://private.example/run'
    assert.throws(() => buildMultisessionEvidence(unsafeIdentity), /safe identifier/u)

    const legacy = capture()
    legacy.batch.data.results[0].result.data.backend = 'legacy-pyautogui'
    assert.throws(() => buildMultisessionEvidence(legacy), /controlled target-scoped backend/u)
  })
})
