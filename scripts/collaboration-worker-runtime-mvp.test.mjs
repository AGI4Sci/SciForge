import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { restRequestSchema } from '../packages/collaboration-contracts/src/index.ts'
import {
  DEFAULT_MAX_BODY_BYTES,
  createCollaborationHttpServer
} from '../packages/collaboration-server/src/api.ts'
import { startModelRouterServer } from '@sciforge/model-router'
import { stableDigest } from '../packages/collaboration-server/src/crypto.ts'
import { CollaborationService } from '../packages/collaboration-server/src/service.ts'
import { createAgentCredentialBootstrap, seedOidcUserDevice } from '../packages/collaboration-server/src/test-fixtures/collaboration-identity.ts'
import {
  CollaborationLocalStore,
  EMPTY_COLLABORATION_LOCAL_STATE
} from '../packages/domains/collaboration/src/main/store.ts'
import { CollaborationConnection } from '../packages/domains/collaboration/src/main/connection.ts'
import { CollaborationTaskAdapter } from '../packages/domains/collaboration/src/main/task-adapter.ts'
import { DurableCloudOutbox } from '../packages/domains/collaboration/src/main/outbox.ts'
import { createTestAgentCloudRuntime } from '../packages/domains/collaboration/src/main/test-agent-cloud-runtime.ts'
import { CollaborationSettingsService } from '../packages/domains/collaboration/src/main/settings.ts'
import {
  WORKER_RESULT_SUMMARY_MAX_CODE_POINTS,
  parseWorkerRuntimeResult,
  workerRuntimeResultOutputSchema
} from '../packages/domains/collaboration/src/main/worker-runtime-result.ts'
import {
  FakeClock,
  FakeCollaborationRepository,
  FakeCollaborationRequestActorResolver,
  FakeCollaborationStateBackend
} from '../test-fixtures/collaboration/fake-adapters.mjs'

test('maximum escaped text-only Worker result fits the default Cloud command body', () => {
  const worstEscapedCodePoint = '\u0001'
  const maxOpaqueId = (prefix) => `${prefix}_${'a'.repeat(64)}`
  const summary = worstEscapedCodePoint.repeat(WORKER_RESULT_SUMMARY_MAX_CODE_POINTS)
  assert.equal(
    Buffer.byteLength(JSON.stringify(summary)),
    WORKER_RESULT_SUMMARY_MAX_CODE_POINTS * 6 + 2
  )

  const command = restRequestSchema.parse({
    protocolVersion: '1.0',
    requestId: maxOpaqueId('req'),
    type: 'task.result.submit',
    idempotencyKey: `idem_${'a'.repeat(123)}`,
    taskId: maxOpaqueId('tsk'),
    executionId: maxOpaqueId('exe'),
    expectedTaskRevision: Number.MAX_SAFE_INTEGER,
    expectedExecutionRevision: Number.MAX_SAFE_INTEGER,
    summary,
    runtimeProvenance: {
      runtimeId: worstEscapedCodePoint.repeat(128),
      modelId: null,
      startedAt: '9999-12-31T23:59:59.999Z',
      completedAt: '9999-12-31T23:59:59.999Z'
    },
    outputs: [],
    recoveryJournalEntryIds: [],
    submissionDigest: 'f'.repeat(64)
  })
  const bodyBytes = Buffer.byteLength(JSON.stringify(command))
  assert.ok(
    bodyBytes <= DEFAULT_MAX_BODY_BYTES,
    `${bodyBytes} bytes exceeds ${DEFAULT_MAX_BODY_BYTES}`
  )
})

test('protein Worker schema survives scientific evidence and Model Router Responses-to-Chat fallback', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-worker-router-protein-'))
  const uploadDirectory = join(workspaceRoot, '.sciforge', 'uploads', 'worker-protein')
  await mkdir(uploadDirectory, { recursive: true })
  await writeFile(
    join(uploadDirectory, 'protein.fasta'),
    '>protein\nMQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQR\n'
  )
  const calls = []
  const completedText = JSON.stringify({
    result: {
      schemaVersion: 1,
      outcome: 'completed',
      summary: 'Structured Worker result is ready for Coordinator review.'
    }
  })
  const nativeResponsesFormat = {
    type: 'json_schema',
    name: 'sciforge_output',
    strict: true,
    schema: workerRuntimeResultOutputSchema
  }
  const server = await startModelRouterServer({
    port: 0,
    workspaceRoot,
    config: {
      defaultProfile: 'default',
      publicModelAlias: 'sciforge-router',
      profiles: {
        default: {
          textReasoner: {
            baseUrl: 'https://models.example/v1',
            apiKeyEnv: 'SCIFORGE_TEXT_API_KEY',
            model: 'configured-model',
            compatibility: {
              preferredProtocol: 'responses',
              allowedProtocols: ['responses', 'chat-completions']
            }
          },
          translators: {
            scientific: {
              baseUrl: 'http://scientific.example:3898',
              tokenEnv: 'SCIFORGE_SCIENTIFIC_TOKEN',
              model: 'protein-expert'
            }
          }
        }
      }
    },
    env: {
      SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'router-runtime-key',
      SCIFORGE_TEXT_API_KEY: 'opaque-test-key',
      SCIFORGE_SCIENTIFIC_TOKEN: 'scientific-test-key'
    },
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname
      const body = JSON.parse(String(init?.body ?? '{}'))
      calls.push({
        path,
        body
      })
      if (path.endsWith('/modality/translate')) {
        return Response.json({
          ok: true,
          summary: 'Protein evidence.',
          data: {
            modality: 'protein',
            model: 'protein-expert',
            summary: 'A translated protein observation for the Worker.'
          },
          provenance: {}
        })
      }
      if (path.endsWith('/responses')) {
        return Response.json({ error: { message: 'unsupported endpoint' } }, { status: 404 })
      }
      assert.equal(path.endsWith('/chat/completions'), true)
      return Response.json({
        id: 'chatcmpl-worker-result',
        object: 'chat.completion',
        model: 'configured-model',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: completedText },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      })
    }
  })

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer router-runtime-key',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Complete the protein Collaboration Worker task.' },
            {
              type: 'input_object',
              ref: '.sciforge/uploads/worker-protein/protein.fasta',
              mimeType: 'text/plain',
              title: 'protein.fasta'
            }
          ]
        }],
        text: { format: nativeResponsesFormat }
      })
    })
    const body = await response.json()

    assert.equal(response.status, 200, JSON.stringify(body))
    assert.deepEqual(calls.map(({ path }) => path), [
      '/modality/translate',
      '/v1/responses',
      '/v1/chat/completions'
    ])
    assert.deepEqual(calls[2]?.body.response_format, {
      type: 'json_schema',
      json_schema: {
        name: nativeResponsesFormat.name,
        strict: nativeResponsesFormat.strict,
        schema: workerRuntimeResultOutputSchema
      }
    })
    const textReasonerBody = JSON.stringify(calls[2]?.body)
    assert.match(textReasonerBody, /translated protein observation/u)
    assert.doesNotMatch(textReasonerBody, /final_answer|need_more_visual_info/u)
    assert.deepEqual(parseWorkerRuntimeResult(body.output_text), {
      schemaVersion: 1,
      outcome: 'completed',
      summary: 'Structured Worker result is ready for Coordinator review.'
    })
  } finally {
    await server.close()
  }
})

/**
 * This is the smallest Worker-side integration slice. The Coordinator setup
 * and Cloud state transition are intentionally the same HTTP command boundary
 * used by the text-report MVP test; only the Worker path is changed to use the
 * real durable TaskAdapter and Outbox.
 */
test('text-only Worker runtime completes through Adapter → Outbox → HTTP Cloud', async () => {
  const clock = new FakeClock()
  const repository = new FakeCollaborationRepository()
  const service = new CollaborationService({ repository, now: clock.now })
  const actorResolver = new FakeCollaborationRequestActorResolver({ repository, now: clock.now })
  const server = createCollaborationHttpServer({
    service,
    authentication: actorResolver,
    readiness: async () => true
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`
  let workerConnection

  try {
    const owner = await provisionParticipant({
      service,
      repository,
      actorResolver,
      identityLabel: 'runtime-mvp Coordinator',
      tokenLabel: 'runtime-mvp-coordinator'
    })
    const worker = await provisionParticipant({
      service,
      repository,
      actorResolver,
      identityLabel: 'runtime-mvp Worker',
      tokenLabel: 'runtime-mvp-worker'
    })

    // The Worker must publish a heartbeat before its availability fact. Keep
    // the returned Agent revision; the adapter's later availability writes use
    // this exact revision even though availability itself does not increment it.
    const workerHeartbeat = await postCommand(baseUrl, worker.agentToken, {
      protocolVersion: '1.0',
      type: 'agent.heartbeat',
      requestId: requestId('runtime-mvp-worker-heartbeat'),
      idempotencyKey: idempotency('runtime-mvp-worker-heartbeat'),
      agentId: worker.agent.agentId,
      expectedRevision: worker.agent.revision,
      connectionStatus: 'online',
      capabilities: worker.agent.capabilities
    })
    assert.equal(workerHeartbeat.type, 'rest.entity')
    assert.equal(workerHeartbeat.entity.type, 'agent_node')
    const heartbeatAgent = workerHeartbeat.entity
    await postCommand(baseUrl, worker.agentToken, {
      protocolVersion: '1.0',
      type: 'worker.availability.publish',
      requestId: requestId('runtime-mvp-worker-availability'),
      idempotencyKey: idempotency('runtime-mvp-worker-availability'),
      agentId: heartbeatAgent.agentId,
      expectedAgentRevision: heartbeatAgent.revision,
      connectionStatus: 'online',
      lastHeartbeatAt: heartbeatAgent.lastSeenAt,
      runtimeReadiness: 'ready',
      runtimeCapabilityTags: heartbeatAgent.capabilities,
      acceptsNewOffers: true,
      activeTaskCount: 0,
      observedAt: clock.now().toISOString()
    })

    const created = await postCommand(baseUrl, owner.agentToken, {
      protocolVersion: '1.0',
      type: 'project.create',
      requestId: requestId('runtime-mvp-project-create'),
      idempotencyKey: idempotency('runtime-mvp-project-create'),
      createIntentId: `pct_${stableDigest('runtime-mvp-create-intent').slice(0, 24)}`,
      displayName: 'SciForge Worker runtime MVP',
      goal: 'Validate one bounded expert report through the Worker runtime.',
      budget: {
        maxTasks: 3,
        maxTasksPerRound: 3,
        maxTaskRetries: 1,
        maxCoordinationRounds: 1
      }
    })
    assert.equal(created.type, 'rest.project_created')
    const project = created.project
    const taskFacts = {
      workerUserId: worker.userId,
      planItemId: 'item_runtime_mvp_worker_report',
      title: 'Evidence sub-question report',
      objective: 'Analyze the assigned design sub-question and return a reviewable report; perform design analysis only and do not execute or claim an experiment.',
      completionCriteria: [
        'Include Expert/Role and Sub-question, Conclusion, Evidence or basis, and Recommendation or next action sections.',
        'Attribute material claims with [expert:<role>] or [source:<label>].'
      ],
      dependencyPlanItemIds: [],
      // No domain-specific capability contract is available in the current
      // production readiness projection.  Keep the no-Content MVP routable
      // with the runtime readiness tags only.
      requiredCapabilityTags: [],
      fileIntent: null
    }
    const planFacts = {
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
      supersedesProjectPlanId: null,
      sourceInputLocators: [],
      tasks: [taskFacts],
      rationale: 'One Worker owns one bounded text-only sub-question.',
      runtimeProvenance: {
        runtimeId: 'runtime-mvp-coordinator',
        modelId: null,
        generatedByCoordinatorAgentId: owner.agent.agentId,
        generatedAt: clock.now().toISOString()
      }
    }
    const submittedPlan = await postCommand(baseUrl, owner.agentToken, {
      protocolVersion: '1.0',
      type: 'project.plan.submit',
      requestId: requestId('runtime-mvp-plan-submit'),
      idempotencyKey: idempotency('runtime-mvp-plan-submit'),
      ...planFacts,
      planDigest: stableDigest(planFacts)
    })
    assert.equal(submittedPlan.type, 'rest.entity')
    const plan = submittedPlan.entity
    const confirmedPlan = await postCommand(baseUrl, owner.userToken, {
      protocolVersion: '1.0',
      type: 'project.plan.confirm',
      requestId: requestId('runtime-mvp-plan-confirm'),
      idempotencyKey: idempotency('runtime-mvp-plan-confirm'),
      projectId: project.projectId,
      projectPlanId: plan.projectPlanId,
      expectedProjectRevision: project.revision + 1,
      expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
      expectedPlanRevision: plan.revision,
      planDigest: plan.planDigest,
      initialTeam: {
        mode: 'none',
        members: [{ userId: owner.userId }, { userId: worker.userId }]
      }
    })
    assert.equal(confirmedPlan.type, 'rest.entity')
    const confirmed = confirmedPlan.entity

    const invitation = await repository.getProjectMember(project.projectId, worker.userId)
    assert.ok(invitation)
    const beforeAccept = await repository.getProject(project.projectId)
    assert.ok(beforeAccept)
    await postCommand(baseUrl, worker.userToken, {
      protocolVersion: '1.0',
      type: 'project.membership.accept',
      requestId: requestId('runtime-mvp-membership-accept'),
      idempotencyKey: idempotency('runtime-mvp-membership-accept'),
      projectId: project.projectId,
      projectMembershipId: invitation.projectMembershipId,
      expectedProjectRevision: beforeAccept.revision,
      expectedMembershipRevision: invitation.revision,
      projectPlanId: confirmed.projectPlanId,
      expectedPlanRevision: confirmed.revision,
      planDigest: confirmed.planDigest
    })
    const acceptedProject = await repository.getProject(project.projectId)
    assert.ok(acceptedProject)
    await postCommand(baseUrl, owner.userToken, {
      protocolVersion: '1.0',
      type: 'project.transition',
      requestId: requestId('runtime-mvp-project-activate'),
      idempotencyKey: idempotency('runtime-mvp-project-activate'),
      projectId: project.projectId,
      expectedRevision: acceptedProject.revision,
      expectedCoordinatorAuthorityEpoch: acceptedProject.coordinatorAuthorityEpoch,
      expectedExecutionAuthorityEpoch: acceptedProject.executionAuthorityEpoch,
      status: 'active'
    })

    const activeProject = await repository.getProject(project.projectId)
    assert.ok(activeProject)
    const offered = await postCommand(baseUrl, owner.agentToken, {
      protocolVersion: '1.0',
      type: 'task.offer.create',
      requestId: requestId('runtime-mvp-offer-create'),
      idempotencyKey: idempotency('runtime-mvp-offer-create'),
      projectId: project.projectId,
      expectedProjectRevision: activeProject.revision,
      expectedCoordinatorAuthorityEpoch: activeProject.coordinatorAuthorityEpoch,
      expectedExecutionAuthorityEpoch: activeProject.executionAuthorityEpoch,
      projectPlanId: confirmed.projectPlanId,
      expectedPlanRevision: confirmed.revision,
      planItemId: taskFacts.planItemId,
      offerExpiresAt: new Date(clock.now().getTime() + 60_000).toISOString()
    })
    assert.equal(offered.type, 'rest.collection')
    const task = offered.items.find((item) => item.type === 'task')
    const offer = offered.items.find((item) => item.type === 'task_offer')
    assert.ok(task)
    assert.ok(offer)
    assert.equal(task.fileIntent, null)
    assert.deepEqual(task.requiredCapabilityTags, [])

    const workerBackend = new FakeCollaborationStateBackend(EMPTY_COLLABORATION_LOCAL_STATE)
    const workerStore = new CollaborationLocalStore(workerBackend)
    await workerStore.open()
    await workerStore.transact((draft) => {
      draft.agents.push(heartbeatAgent)
    })
    const agentRuntime = createHttpAgentRuntime({
      baseUrl,
      token: worker.agentToken,
      agent: heartbeatAgent,
      userId: worker.userId,
      deviceId: worker.deviceId
    })
    const workerOutbox = new DurableCloudOutbox({
      store: workerStore,
      agentCloudRuntime: agentRuntime,
      localAgentId: () => heartbeatAgent.agentId,
      now: clock.now
    })
    const runtimeRequests = []
    const workerAdapter = new CollaborationTaskAdapter({
      store: workerStore,
      connection: {
        executeAsAgent: (request) => agentRuntime.execute({
          agentId: heartbeatAgent.agentId,
          request
        })
      },
      outbox: workerOutbox,
      agentExecution: {
        runtimeReadiness: async () => ({
          state: 'ready',
          runtimeId: 'codex',
          capabilityTags: ['agent-runtime.codex', 'model-access.api']
        }),
        prepareSession: async () => ({
          runtimeId: 'codex',
          threadId: 'runtime-mvp-worker-thread'
        }),
        run: async (request) => {
          runtimeRequests.push(request)
          assert.match(request.prompt, /design-analysis-only/iu)
          assert.match(request.prompt, /do not run or claim an experiment/iu)
          assert.match(request.prompt, /Expert.*Role.*Sub-question/isu)
          assert.match(request.prompt, /Conclusion/u)
          assert.match(request.prompt, /Evidence/u)
          assert.match(request.prompt, /Recommendation/u)
          return {
            runtimeId: request.runtimeId,
            threadId: request.threadId,
            turnId: 'runtime-mvp-worker-turn',
            state: 'completed',
            text: JSON.stringify({
              result: {
                schemaVersion: 1,
                outcome: 'completed',
                summary: `## Expert / Role and Sub-question\n- [expert:design analyst] [worker:${worker.userId}]\n## Conclusion\n- [expert:design analyst] The design analysis is complete.\n## Evidence or basis\n- [source:task-brief] Runtime path was exercised; no experiment was executed.\n## Recommendation or next action\n- [expert:design analyst] Coordinator should review this design input.`
              }
            })
          }
        }
      },
      capabilities: {
        invoke: async () => {
          throw new Error('Content Space must not run for a text-only execution.')
        },
        createApprovedBatch: () => {
          throw new Error('Content Space provisioning must not run for a text-only execution.')
        }
      },
      localAgentId: () => heartbeatAgent.agentId,
      workspaceRootForExecution: (executionId) => `/tmp/sciforge-runtime-mvp-${executionId}`,
      now: clock.now
    })

    // Connect the same CollaborationConnection used by the Desktop runtime.
    // It pulls the offer, dispatches the adapter, and durably acknowledges the
    // Cloud inbox before the Worker user makes the manual acceptance decision.
    workerConnection = new CollaborationConnection({
      store: workerStore,
      settings: new CollaborationSettingsService(settingsHost(baseUrl)),
      outbox: workerOutbox,
      authenticatedCloudTransport: {
        status: () => ({
          state: 'ready',
          baseUrl,
          userId: worker.userId,
          deviceId: worker.deviceId,
          deviceRevision: 1
        }),
        execute: async () => {
          throw new Error('The Worker runtime test does not use User Cloud commands.')
        }
      },
      agentCloudRuntime: agentRuntime,
      inboxHandler: { handle: (message) => workerAdapter.handleInbox(message) },
      afterHeartbeat: (connectionStatus) => workerAdapter.publishAvailability(connectionStatus),
      now: clock.now
    })

    // Default policy is manual, so exercise the same explicit acceptance a
    // Worker user performs in the Desktop UI.
    await workerConnection.connect()
    await workerAdapter.waitForIdle()
    const pendingOffer = workerStore.snapshot().pendingTaskOffers[0]
    assert.equal(pendingOffer?.taskOfferId, offer.taskOfferId)
    assert.equal(pendingOffer?.state, 'awaiting-manual')
    await workerAdapter.decideOffer(pendingOffer.taskOfferId, { decision: 'accept' })
    await workerAdapter.waitForIdle()
    await workerOutbox.waitForIdle()

    const localRun = workerStore.snapshot().taskRuns[0]
    assert.ok(localRun)
    assert.equal(localRun.state, 'completed')
    assert.equal(localRun.resultSummary?.includes('Conclusion'), true)
    assert.equal(localRun.resultSummary?.includes('Evidence'), true)
    assert.equal(localRun.resultSummary?.includes('Recommendation'), true)
    assert.equal(localRun.agentJournal.length, 1)
    assert.equal(localRun.agentJournal[0]?.state, 'observed_success')
    assert.equal(localRun.agentJournal[0]?.runtimeId, 'codex')
    assert.equal(localRun.agentJournal[0]?.threadId, 'runtime-mvp-worker-thread')
    assert.equal(runtimeRequests.length, 1)
    assert.ok(workerStore.snapshot().lastInboxSequence > 0)
    assert.ok(workerStore.snapshot().outbox.some(({ kind, state }) => (
      kind === 'inbox.ack' && state === 'delivered'
    )))
    assert.deepEqual(
      workerStore.snapshot().outbox
        .filter(({ body }) => ['task.offer.accept', 'task.execution.start', 'task.result.submit'].includes(body.type))
        .map(({ body, state }) => ({ type: body.type, state })),
      [
        { type: 'task.offer.accept', state: 'delivered' },
        { type: 'task.execution.start', state: 'delivered' },
        { type: 'task.result.submit', state: 'delivered' }
      ]
    )

    const cloudTask = await repository.getTask(task.taskId)
    const cloudExecution = await repository.getTaskExecution(localRun.offer.executionId)
    const cloudSubmission = cloudExecution?.currentResultSubmissionId
      ? await repository.getTaskResultSubmission(cloudExecution.currentResultSubmissionId)
      : null
    assert.equal(cloudTask?.status, 'awaiting_review')
    assert.equal(cloudExecution?.state, 'result_submitted')
    assert.ok(cloudExecution?.currentResultSubmissionId)
    assert.equal(cloudSubmission?.submittedByUserId, worker.userId)
    assert.equal(cloudSubmission?.submittedByAgentId, worker.agent.agentId)
    assert.match(cloudSubmission?.summary ?? '', new RegExp(`\\[worker:${worker.userId}\\]`, 'u'))
    const coordinatorInbox = await postCommand(baseUrl, owner.agentToken, {
      protocolVersion: '1.0',
      requestId: requestId('runtime-mvp-coordinator-inbox-pull'),
      type: 'inbox.pull',
      recipientType: 'agent',
      afterSequence: 0,
      limit: 100
    })
    assert.equal(coordinatorInbox.type, 'rest.inbox_page')
    assert.ok(coordinatorInbox.messages.some((message) => (
      message.payload.type === 'task.result.submitted' &&
      message.payload.taskId === cloudTask?.taskId &&
      message.payload.executionId === cloudExecution?.executionId &&
      message.payload.resultSubmissionId === cloudExecution?.currentResultSubmissionId
    )))
  } finally {
    await workerConnection?.disconnect().catch(() => undefined)
    await closeServer(server)
  }
})

async function provisionParticipant({ service, repository, actorResolver, identityLabel, tokenLabel }) {
  const identity = await seedOidcUserDevice(
    repository,
    identityLabel,
    new Date('2026-08-15T00:00:00.000Z')
  )
  const userToken = `oidc-runtime-mvp-${tokenLabel}-token`
  actorResolver.registerOidcActor(userToken, identity.user)
  const bootstrap = createAgentCredentialBootstrap()
  const ensured = await service.ensureAgent(identity.user, {
    deviceId: identity.deviceId,
    capabilities: ['agent-runtime.codex', 'model-access.api'],
    credentialBootstrapPublicKey: bootstrap.publicKey,
    idempotencyKey: idempotency(`ensure-${tokenLabel}`)
  })
  const agentToken = bootstrap.open(ensured.sealedCredential)
  return {
    user: identity.user,
    userId: identity.userId,
    deviceId: identity.deviceId,
    agent: ensured.agent,
    userToken,
    agentToken
  }
}

function createHttpAgentRuntime({ baseUrl, token, agent, userId, deviceId }) {
  return createTestAgentCloudRuntime({
    authorityStatus: async (agentId) => ({
      state: 'ready',
      agentId,
      userId,
      deviceId,
      generation: agent.credentialGeneration,
      runtimeId: 'codex',
      capabilityTags: agent.capabilities
    }),
    execute: async (agentId, request) => {
      assert.equal(agentId, agent.agentId)
      return postCommand(baseUrl, token, request)
    },
    pullAgentInbox: async ({ agentId, afterSequence, limit }) => {
      assert.equal(agentId, agent.agentId)
      const page = await postCommand(baseUrl, token, {
        protocolVersion: '1.0',
        requestId: requestId(`runtime-mvp-inbox-${afterSequence}`),
        type: 'inbox.pull',
        recipientType: 'agent',
        afterSequence,
        limit: limit ?? 100
      })
      assert.equal(page.type, 'rest.inbox_page')
      return { messages: page.messages, nextSequence: page.nextSequence }
    }
  })
}

async function postCommand(baseUrl, token, command) {
  const response = await fetch(`${baseUrl}/v1/commands`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...('idempotencyKey' in command ? { 'idempotency-key': command.idempotencyKey } : {})
    },
    body: JSON.stringify(command)
  })
  const body = await response.json()
  assert.equal(response.status, 200, `${command.type}: ${JSON.stringify(body)}`)
  return body
}

async function closeServer(server) {
  if (!server.listening) return
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

function requestId(seed) {
  return `req_${stableDigest(seed).slice(0, 24)}`
}

function idempotency(seed) {
  return `idem_${stableDigest(seed).slice(0, 32)}`
}

function settingsHost(baseUrl) {
  let revision = 1
  let value = { schemaVersion: 2, baseUrl }
  return {
    read: async () => ({ revision, value }),
    write: async (next, expectedRevision) => {
      assert.equal(expectedRevision, revision)
      revision += 1
      value = next
      return { revision, value }
    },
    clear: async (expectedRevision) => {
      assert.equal(expectedRevision, revision)
      revision += 1
      value = null
      return { revision, value }
    }
  }
}
