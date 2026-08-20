import { randomUUID } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import {
  encodePairingBindCode,
  restRequestSchema,
  restResponseSchema,
  webSocketMessageSchema
} from '@sciforge/collaboration-contracts'
import { WebSocket } from 'ws'

const PARTICIPANT_SLOTS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F'])
const PROTOCOL_VERSION = '1.0'
const DEFAULT_TIMEOUT_MS = 90_000
const DEFAULT_NEGATIVE_WINDOW_MS = 5_000
const MAX_SECRET_BYTES = 4_096
const ZULIP_MESSAGES_PATH = ['api', 'v1', 'messages'].join('/')
const ZULIP_SELF_PATH = ['api', 'v1', 'users', 'me'].join('/')

export const acceptanceEnvironmentContract = Object.freeze({
  common: Object.freeze([
    'SCIFORGE_COLLAB_ZULIP_SERVER_URL',
    'SCIFORGE_COLLAB_ZULIP_REALM_URL',
    'SCIFORGE_COLLAB_ZULIP_STREAM',
    'SCIFORGE_COLLAB_ZULIP_BOT_EMAIL'
  ]),
  optionalCommon: Object.freeze([
    'SCIFORGE_COLLAB_ZULIP_ORIGIN',
    'SCIFORGE_COLLAB_ZULIP_TIMEOUT_MS',
    'SCIFORGE_COLLAB_ZULIP_NEGATIVE_WINDOW_MS'
  ]),
  perParticipant: Object.freeze([
    'SCIFORGE_COLLAB_ZULIP_<SLOT>_EMAIL',
    'SCIFORGE_COLLAB_ZULIP_<SLOT>_API_KEY or ..._API_KEY_FILE'
  ]),
  optionalExistingBinding: Object.freeze([
    'SCIFORGE_COLLAB_ZULIP_<SLOT>_USER_ID',
    'SCIFORGE_COLLAB_ZULIP_<SLOT>_HUMAN_ENDPOINT_ID',
    'SCIFORGE_COLLAB_ZULIP_<SLOT>_AGENT_ID',
    'SCIFORGE_COLLAB_ZULIP_<SLOT>_USER_CREDENTIAL or ..._USER_CREDENTIAL_FILE',
    'SCIFORGE_COLLAB_ZULIP_<SLOT>_DEVICE_CREDENTIAL or ..._DEVICE_CREDENTIAL_FILE'
  ])
})

class AcceptanceDriverError extends Error {
  constructor(code) {
    super('The external acceptance operation did not complete.')
    this.name = 'AcceptanceDriverError'
    this.code = code
  }
}

function fail(code) {
  throw new AcceptanceDriverError(code)
}

function required(value, code = 'ACCEPTANCE_CONFIGURATION_MISSING') {
  if (typeof value !== 'string' || !value.trim()) fail(code)
  return value.trim()
}

function normalizedBaseUrl(value, code) {
  let parsed
  try {
    parsed = new URL(required(value, code))
  } catch {
    fail(code)
  }
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1'
  if (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) fail('INSECURE_ENDPOINT_REJECTED')
  parsed.search = ''
  parsed.hash = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '')
  return parsed.toString().replace(/\/$/u, '')
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail('ACCEPTANCE_CONFIGURATION_INVALID')
  }
  return parsed
}

function opaque(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 24)}`
}

function idempotency(label) {
  return `idem_acceptance_${label}_${randomUUID().replaceAll('-', '')}`.slice(0, 128)
}

function topicBootstrapCommand(runId) {
  // Keep topic discovery races non-executable: the provider classifies this as an answer,
  // while the random nonexistent request is rejected by the canonical service.
  return `sciforge-answer ${opaque('hrq')} 1 acceptance-bootstrap-${runId}`
}

function request(command) {
  const candidate = {
    protocolVersion: PROTOCOL_VERSION,
    requestId: opaque('req'),
    ...command
  }
  const parsed = restRequestSchema.safeParse(candidate)
  if (!parsed.success) fail('DRIVER_CONTRACT_INVALID')
  return parsed.data
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function normalizeText(value) {
  return String(value)
    .replace(/^<p>|<\/p>$/gu, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
}

async function readSecret(environment, name) {
  const inline = environment(name)
  const fileName = environment(`${name}_FILE`)
  if (inline && fileName) fail('SECRET_SOURCE_AMBIGUOUS')
  if (inline) return required(inline)
  const path = required(fileName)
  let info
  try {
    info = await lstat(path)
  } catch {
    fail('SECRET_FILE_UNAVAILABLE')
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > MAX_SECRET_BYTES ||
      (info.mode & 0o777) !== 0o600) {
    fail('SECRET_FILE_PERMISSION_REJECTED')
  }
  try {
    return required(await readFile(path, 'utf8'), 'SECRET_FILE_UNAVAILABLE')
  } catch (error) {
    if (error instanceof AcceptanceDriverError) throw error
    fail('SECRET_FILE_UNAVAILABLE')
  }
}

function safeReport(report, label) {
  if (typeof report !== 'function' || !/^[a-z][a-z0-9.-]{0,63}$/u.test(label)) return
  report(label)
}

function collaborationCode(code) {
  if (typeof code !== 'string') return 'COLLABORATION_REQUEST_FAILED'
  return `COLLABORATION_${code.toUpperCase()}`.replace(/[^A-Z0-9_]/gu, '_')
}

function participantPrefix(slot) {
  if (!PARTICIPANT_SLOTS.includes(slot)) fail('PARTICIPANT_SLOT_INVALID')
  return `SCIFORGE_COLLAB_ZULIP_${slot}`
}

function exactTopic(locator, topic) {
  return locator?.provider === 'zulip' && locator.topicDisplayName === topic
}

export function createZulipAcceptanceDriver({ environment, report } = {}) {
  if (typeof environment !== 'function') fail('ACCEPTANCE_CONFIGURATION_MISSING')

  const serverUrl = normalizedBaseUrl(environment('SCIFORGE_COLLAB_ZULIP_SERVER_URL'), 'ACCEPTANCE_CONFIGURATION_MISSING')
  const realmUrl = normalizedBaseUrl(environment('SCIFORGE_COLLAB_ZULIP_REALM_URL'), 'ACCEPTANCE_CONFIGURATION_MISSING')
  const stream = required(environment('SCIFORGE_COLLAB_ZULIP_STREAM'))
  const botEmail = required(environment('SCIFORGE_COLLAB_ZULIP_BOT_EMAIL')).toLocaleLowerCase('en-US')
  const origin = environment('SCIFORGE_COLLAB_ZULIP_ORIGIN')?.trim()
  const timeoutMs = boundedInteger(environment('SCIFORGE_COLLAB_ZULIP_TIMEOUT_MS'), DEFAULT_TIMEOUT_MS, 5_000, 600_000)
  const negativeWindowMs = boundedInteger(
    environment('SCIFORGE_COLLAB_ZULIP_NEGATIVE_WINDOW_MS'),
    DEFAULT_NEGATIVE_WINDOW_MS,
    1_000,
    30_000
  )
  const runId = randomUUID().replaceAll('-', '').slice(0, 12)

  const participantStates = new Map()
  const projectionStates = new Map()
  const projectStates = new Map()
  const humanStates = new Map()
  const outboundTexts = new Map()

  async function collaborationCommand(token, command) {
    const body = request(command)
    const headers = {
      'content-type': 'application/json'
    }
    if (token) headers.authorization = `Bearer ${token}`
    if ('idempotencyKey' in body) headers['idempotency-key'] = body.idempotencyKey
    let response
    try {
      response = await fetch(new URL('v1/commands', `${serverUrl}/`), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch {
      fail('COLLABORATION_TRANSPORT_FAILED')
    }
    let raw
    try {
      raw = await response.json()
    } catch {
      fail('COLLABORATION_RESPONSE_INVALID')
    }
    const parsed = restResponseSchema.safeParse(raw)
    if (!parsed.success) fail('COLLABORATION_RESPONSE_INVALID')
    if (parsed.data.type === 'rest.error') fail(collaborationCode(parsed.data.error.code))
    if (!response.ok) fail('COLLABORATION_REQUEST_FAILED')
    return parsed.data
  }

  async function zulipRequest(state, path, { method = 'GET', form, query } = {}) {
    const url = new URL(path.replace(/^\//u, ''), `${realmUrl}/`)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value))
    let response
    try {
      response = await fetch(url, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`${state.email}:${state.zulipApiKey}`, 'utf8').toString('base64')}`,
          ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
        },
        ...(form ? { body: new URLSearchParams(form).toString() } : {}),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch {
      fail('ZULIP_TRANSPORT_FAILED')
    }
    let body
    try {
      body = await response.json()
    } catch {
      fail('ZULIP_RESPONSE_INVALID')
    }
    if (!response.ok || body?.result !== 'success') fail('ZULIP_REQUEST_FAILED')
    return body
  }

  async function sendZulipMessage(state, topic, text) {
    const body = await zulipRequest(state, ZULIP_MESSAGES_PATH, {
      method: 'POST',
      form: { type: 'stream', to: stream, topic, content: text }
    })
    if ((typeof body.id !== 'number' && typeof body.id !== 'string') || !String(body.id).trim()) {
      fail('ZULIP_RESPONSE_INVALID')
    }
    return String(body.id)
  }

  async function sendZulipDirectMessage(state, recipientEmail, text) {
    const body = await zulipRequest(state, ZULIP_MESSAGES_PATH, {
      method: 'POST',
      form: { type: 'direct', to: JSON.stringify([recipientEmail]), content: text }
    })
    if ((typeof body.id !== 'number' && typeof body.id !== 'string') || !String(body.id).trim()) {
      fail('ZULIP_RESPONSE_INVALID')
    }
    return String(body.id)
  }

  async function listZulipMessages(state, topic) {
    const body = await zulipRequest(state, ZULIP_MESSAGES_PATH, {
      query: {
        anchor: 'newest',
        num_before: 1_000,
        num_after: 0,
        apply_markdown: 'false',
        narrow: JSON.stringify([['stream', stream], ['topic', topic]])
      }
    })
    if (!Array.isArray(body.messages) || body.messages.length > 10_000) fail('ZULIP_RESPONSE_INVALID')
    return body.messages.filter((message) => message && typeof message === 'object')
  }

  async function verifyZulipAccount(state, endpoint) {
    const self = await zulipRequest(state, ZULIP_SELF_PATH)
    if ((typeof self.user_id !== 'number' && typeof self.user_id !== 'string') ||
        String(self.user_id) !== endpoint?.identity?.providerUserId ||
        endpoint?.identity?.provider !== 'zulip' || endpoint?.identity?.realmId !== realmUrl ||
        (typeof self.email === 'string' && self.email.toLocaleLowerCase('en-US') !== state.email.toLocaleLowerCase('en-US'))) {
      fail('ZULIP_IDENTITY_MISMATCH')
    }
    return String(self.user_id)
  }

  async function verifyZulipSourceMessage(state, topic, providerMessageId) {
    const messages = await listZulipMessages(state, topic)
    const message = messages.find((candidate) => String(candidate.id) === providerMessageId)
    if (!message || String(message.sender_id) !== state.providerUserId) fail('ZULIP_IDENTITY_MISMATCH')
  }

  async function awaitZulipMessage(state, locator, text) {
    const topic = required(locator?.topicDisplayName, 'DRIVER_STATE_INVALID')
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const messages = await listZulipMessages(state, topic)
      const matching = messages.filter((message) => (
        normalizeText(message.content) === text &&
        typeof message.sender_email === 'string' &&
        message.sender_email.toLocaleLowerCase('en-US') === botEmail
      ))
      if (matching.length > 0) {
        return {
          providerMessageId: String(matching.at(-1).id),
          deliveryCount: matching.length
        }
      }
      await sleep(750)
    }
    fail('ZULIP_MESSAGE_TIMEOUT')
  }

  function stateFor(participant) {
    const state = participantStates.get(participant?.userId)
    if (!state || state.public !== participant) fail('PARTICIPANT_STATE_INVALID')
    return state
  }

  function projectionStateFor(projection) {
    const state = projectionStates.get(projection?.projectionId)
    if (!state || state.public !== projection) fail('PROJECTION_STATE_INVALID')
    return state
  }

  function projectStateFor(project) {
    const state = projectStates.get(project?.projectId)
    if (!state || state.public !== project) fail('PROJECT_STATE_INVALID')
    return state
  }

  function credentialFor(state, recipientType) {
    return recipientType === 'agent' ? state.deviceCredential : state.userCredential
  }

  function inboxStateFor(state, recipientType) {
    return recipientType === 'agent' ? state.agentInbox : state.userInbox
  }

  async function synchronizeInbox(state, recipientType) {
    const inbox = inboxStateFor(state, recipientType)
    const response = await collaborationCommand(credentialFor(state, recipientType), {
      type: 'inbox.pull',
      recipientType,
      afterSequence: inbox.cursor,
      limit: 200
    })
    if (response.type !== 'rest.inbox_page') fail('COLLABORATION_RESPONSE_INVALID')
    let last
    for (const message of response.messages) {
      if (!inbox.ids.has(message.inboxMessageId)) {
        inbox.ids.add(message.inboxMessageId)
        inbox.messages.push(message)
      }
      if (!last || message.sequence > last.sequence) last = message
      inbox.cursor = Math.max(inbox.cursor, message.sequence)
    }
    if (last) {
      const ack = await collaborationCommand(credentialFor(state, recipientType), {
        type: 'inbox.ack',
        inboxMessageId: last.inboxMessageId,
        sequence: last.sequence,
        idempotencyKey: idempotency('inbox_ack')
      })
      if (ack.type !== 'rest.receipt') fail('COLLABORATION_RESPONSE_INVALID')
    }
    return inbox
  }

  function webSocketUrl() {
    const url = new URL('v1/events', `${serverUrl}/`)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url
  }

  async function openInboxSocket(state, recipientType) {
    const token = credentialFor(state, recipientType)
    const socket = new WebSocket(webSocketUrl(), {
      headers: { authorization: `Bearer ${token}` },
      ...(origin ? { origin } : {}),
      maxPayload: 8 * 1_024,
      perMessageDeflate: false,
      handshakeTimeout: Math.min(timeoutMs, 15_000)
    })
    const signal = { generation: 0 }
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new AcceptanceDriverError('WEBSOCKET_CONNECTION_FAILED')), Math.min(timeoutMs, 15_000))
        const finish = (operation) => {
          clearTimeout(timer)
          operation()
        }
        socket.on('message', (data, binary) => {
          if (binary) return finish(() => reject(new AcceptanceDriverError('WEBSOCKET_PROTOCOL_INVALID')))
          let raw
          try {
            raw = JSON.parse(data.toString())
          } catch {
            return finish(() => reject(new AcceptanceDriverError('WEBSOCKET_PROTOCOL_INVALID')))
          }
          const parsed = webSocketMessageSchema.safeParse(raw)
          if (!parsed.success) return finish(() => reject(new AcceptanceDriverError('WEBSOCKET_PROTOCOL_INVALID')))
          signal.generation += 1
          if (parsed.data.type === 'connection.ready') finish(resolve)
        })
        socket.once('error', () => finish(() => reject(new AcceptanceDriverError('WEBSOCKET_CONNECTION_FAILED'))))
        socket.once('unexpected-response', () => finish(() => reject(new AcceptanceDriverError('WEBSOCKET_CONNECTION_FAILED'))))
      })
    } catch (error) {
      socket.terminate()
      throw error
    }
    return { socket, signal }
  }

  async function waitForInbox(state, recipientType, matcher, { consume = true } = {}) {
    const channel = await openInboxSocket(state, recipientType)
    const startedAt = Date.now()
    try {
      while (Date.now() - startedAt < timeoutMs) {
        const inbox = await synchronizeInbox(state, recipientType)
        const match = inbox.messages.find((message) => !inbox.consumed.has(message.inboxMessageId) && matcher(message))
        if (match) {
          if (consume) inbox.consumed.add(match.inboxMessageId)
          return match
        }
        const generation = channel.signal.generation
        await sleep(500)
        if (generation !== channel.signal.generation) continue
      }
    } finally {
      channel.socket.terminate()
    }
    fail('INBOX_MESSAGE_TIMEOUT')
  }

  async function waitForInboxCount(state, recipientType, matcher, count) {
    const channel = await openInboxSocket(state, recipientType)
    const startedAt = Date.now()
    try {
      while (Date.now() - startedAt < timeoutMs) {
        const inbox = await synchronizeInbox(state, recipientType)
        const matching = inbox.messages.filter((message) => !inbox.consumed.has(message.inboxMessageId) && matcher(message))
        if (matching.length >= count) return matching.sort((left, right) => left.sequence - right.sequence)
        await sleep(500)
      }
    } finally {
      channel.socket.terminate()
    }
    fail('INBOX_MESSAGE_TIMEOUT')
  }

  async function assertInboxAbsent(state, recipientType, matcher) {
    const channel = await openInboxSocket(state, recipientType)
    const deadline = Date.now() + negativeWindowMs
    try {
      while (Date.now() < deadline) {
        const inbox = await synchronizeInbox(state, recipientType)
        if (inbox.messages.some(matcher)) fail('UNEXPECTED_INBOX_DELIVERY')
        await sleep(250)
      }
    } finally {
      channel.socket.terminate()
    }
  }

  async function discoverLocator(state, topic) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const response = await collaborationCommand(state.userCredential, {
        type: 'endpoint.locator.list',
        humanEndpointId: state.public.endpointId,
        query: topic,
        limit: 500
      })
      if (response.type !== 'endpoint.locator_page') fail('COLLABORATION_RESPONSE_INVALID')
      const exact = response.locators.filter((locator) => (
        exactTopic(locator, topic) && locator.containerDisplayName === stream && locator.realmId === realmUrl
      ))
      if (exact.length === 1) return exact[0]
      if (exact.length > 1) fail('LOCATOR_AMBIGUOUS')
      await sleep(750)
    }
    fail('LOCATOR_DISCOVERY_TIMEOUT')
  }

  async function heartbeat(state, online) {
    const response = await collaborationCommand(state.deviceCredential, {
      type: 'agent.heartbeat',
      agentId: state.public.agentId,
      expectedRevision: state.agentRevision,
      connectionStatus: online ? 'online' : 'offline',
      capabilities: ['collaboration.acceptance'],
      idempotencyKey: idempotency('agent_heartbeat')
    })
    if (response.type !== 'rest.entity' || response.entity.type !== 'agent_node') {
      fail('COLLABORATION_RESPONSE_INVALID')
    }
    state.agentRevision = response.entity.revision
    state.online = online
  }

  async function bindExistingParticipant(slot, common) {
    const prefix = participantPrefix(slot)
    const userId = environment(`${prefix}_USER_ID`)
    const endpointId = environment(`${prefix}_HUMAN_ENDPOINT_ID`)
    const agentId = environment(`${prefix}_AGENT_ID`)
    const present = [userId, endpointId, agentId].filter(Boolean).length
    const secretNames = [`${prefix}_USER_CREDENTIAL`, `${prefix}_DEVICE_CREDENTIAL`]
    const secretsConfigured = secretNames.filter((name) => environment(name) || environment(`${name}_FILE`)).length
    if (present === 0 && secretsConfigured === 0) return null
    if (present !== 3 || secretsConfigured !== 2) fail('EXISTING_BINDING_CONFIGURATION_INCOMPLETE')
    const userCredential = await readSecret(environment, secretNames[0])
    const deviceCredential = await readSecret(environment, secretNames[1])
    const snapshot = await collaborationCommand(userCredential, { type: 'participant.get', userId: required(userId) })
    if (snapshot.type !== 'participant.snapshot' || snapshot.user.userId !== userId ||
        !snapshot.humanEndpoints.some((endpoint) => endpoint.humanEndpointId === endpointId && endpoint.status === 'active') ||
        !snapshot.agents.some((agent) => agent.agentId === agentId && agent.lifecycleStatus === 'active')) {
      fail('EXISTING_BINDING_MISMATCH')
    }
    let participant = snapshot.participant
    if (participant.primaryHumanEndpointId !== endpointId || participant.primaryAgentId !== agentId) {
      const selected = await collaborationCommand(userCredential, {
        type: 'participant.update_primary',
        userId: required(userId),
        expectedRevision: participant.revision,
        primaryHumanEndpointId: required(endpointId),
        primaryAgentId: required(agentId),
        idempotencyKey: idempotency('participant_primary')
      })
      if (selected.type !== 'rest.entity' || selected.entity.type !== 'participant_profile' || selected.entity.status !== 'active') {
        fail('COLLABORATION_RESPONSE_INVALID')
      }
      participant = selected.entity
    }
    if (participant.status !== 'active') fail('EXISTING_BINDING_MISMATCH')
    const endpoint = snapshot.humanEndpoints.find((item) => item.humanEndpointId === endpointId)
    const providerUserId = await verifyZulipAccount(common, endpoint)
    const agent = snapshot.agents.find((item) => item.agentId === agentId)
    return {
      ...common,
      userCredential,
      deviceCredential,
      providerUserId,
      agentRevision: agent.revision,
      public: Object.freeze({ slot, userId: required(userId), endpointId: required(endpointId), agentId: required(agentId) })
    }
  }

  async function bindFreshParticipant(slot, common) {
    const begun = await collaborationCommand(undefined, {
      type: 'pairing.begin',
      provider: 'zulip',
      realmId: realmUrl,
      requestedDisplayName: `验收用户 ${slot}`,
      idempotencyKey: idempotency('pairing_begin')
    })
    if (begun.type !== 'pairing.begun') fail('COLLABORATION_RESPONSE_INVALID')
    await sendZulipDirectMessage(
      common,
      botEmail,
      `/bind ${encodePairingBindCode({ challengeId: begun.challengeId, challengeCode: begun.challengeCode })}`
    )
    let verified
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const response = await collaborationCommand(undefined, {
        type: 'pairing.redeem',
        pollSecret: begun.pollSecret,
        idempotencyKey: idempotency('pairing_redeem')
      })
      if (response.type === 'pairing.verified') {
        verified = response
        break
      }
      if (response.type !== 'pairing.pending') fail('COLLABORATION_RESPONSE_INVALID')
      await sleep(Math.max(500, response.retryAfterSeconds * 1_000))
    }
    if (!verified) fail('PAIRING_TIMEOUT')
    const registered = await collaborationCommand(verified.userCredential, {
      type: 'agent.register',
      ownerUserId: verified.userId,
      installationId: opaque('ins'),
      displayName: `验收 Agent ${slot}`,
      nodeType: 'desktop',
      capabilities: ['collaboration.acceptance'],
      idempotencyKey: idempotency('agent_register')
    })
    if (registered.type !== 'agent.registered') fail('COLLABORATION_RESPONSE_INVALID')
    const snapshot = await collaborationCommand(verified.userCredential, {
      type: 'participant.get',
      userId: verified.userId
    })
    if (snapshot.type !== 'participant.snapshot') fail('COLLABORATION_RESPONSE_INVALID')
    const selected = await collaborationCommand(verified.userCredential, {
      type: 'participant.update_primary',
      userId: verified.userId,
      expectedRevision: snapshot.participant.revision,
      primaryHumanEndpointId: verified.humanEndpointId,
      primaryAgentId: registered.agent.agentId,
      idempotencyKey: idempotency('participant_primary')
    })
    if (selected.type !== 'rest.entity' || selected.entity.type !== 'participant_profile' || selected.entity.status !== 'active') {
      fail('COLLABORATION_RESPONSE_INVALID')
    }
    const endpoint = snapshot.humanEndpoints.find((item) => item.humanEndpointId === verified.humanEndpointId)
    const providerUserId = await verifyZulipAccount(common, endpoint)
    return {
      ...common,
      userCredential: verified.userCredential,
      deviceCredential: registered.deviceCredential,
      providerUserId,
      agentRevision: registered.agent.revision,
      public: Object.freeze({
        slot,
        userId: verified.userId,
        endpointId: verified.humanEndpointId,
        agentId: registered.agent.agentId
      })
    }
  }

  async function bindParticipant({ slot }) {
    const prefix = participantPrefix(slot)
    const common = {
      slot,
      email: required(environment(`${prefix}_EMAIL`)),
      zulipApiKey: await readSecret(environment, `${prefix}_API_KEY`),
      agentInbox: { cursor: 0, ids: new Set(), messages: [], consumed: new Set() },
      userInbox: { cursor: 0, ids: new Set(), messages: [], consumed: new Set() },
      online: false
    }
    const state = await bindExistingParticipant(slot, common) ?? await bindFreshParticipant(slot, common)
    participantStates.set(state.public.userId, state)
    await heartbeat(state, true)
    safeReport(report, 'participant.bound')
    return state.public
  }

  async function createPersonalProjection({ participant, label }) {
    const state = stateFor(participant)
    const topic = `${required(label).slice(0, 180)}-${runId}-${participant.slot}`
    await sendZulipMessage(state, topic, topicBootstrapCommand(runId))
    const locator = await discoverLocator(state, topic)
    const created = await collaborationCommand(state.userCredential, {
      type: 'projection.create',
      ownerUserId: participant.userId,
      agentId: participant.agentId,
      humanEndpointId: participant.endpointId,
      locator,
      displayName: topic,
      allowedSenderUserIds: [participant.userId],
      idempotencyKey: idempotency('projection_create')
    })
    if (created.type !== 'rest.entity' || created.entity.type !== 'remote_session_projection') {
      fail('COLLABORATION_RESPONSE_INVALID')
    }
    const publicProjection = Object.freeze({
      projectionId: created.entity.projectionId,
      revision: created.entity.revision,
      threadId: `acceptance-thread-${runId}-${participant.slot}`,
      locator,
      label: topic
    })
    projectionStates.set(publicProjection.projectionId, {
      public: publicProjection,
      participant: state,
      processedProviderMessages: new Set(),
      lastInboundSequence: 0
    })
    safeReport(report, 'projection.created')
    return publicProjection
  }

  async function sendMobileMessage({ participant, projection, text }) {
    const state = stateFor(participant)
    const projectionState = projectionStateFor(projection)
    if (projectionState.participant !== state) fail('PROJECTION_PARTICIPANT_MISMATCH')
    const providerMessageId = await sendZulipMessage(state, projection.locator.topicDisplayName, required(text))
    await verifyZulipSourceMessage(state, projection.locator.topicDisplayName, providerMessageId)
    safeReport(report, 'mobile.message.sent')
    return Object.freeze({ providerMessageId, status: state.online ? 'submitted' : 'queued', text })
  }

  async function awaitDesktopTurn({ participant, projection, sourceMessage }) {
    const state = stateFor(participant)
    const projectionState = projectionStateFor(projection)
    const message = await waitForInbox(state, 'agent', (candidate) => (
      candidate.recipientType === 'agent' &&
      candidate.recipientAgentId === participant.agentId &&
      candidate.payload.type === 'personal.message.received' &&
      candidate.payload.projectionId === projection.projectionId &&
      candidate.payload.providerMessageId === sourceMessage.providerMessageId
    ))
    if (message.payload.projectionRevision !== projection.revision ||
        message.payload.senderUserId !== participant.userId ||
        message.payload.humanEndpointId !== participant.endpointId) {
      fail('PERSONAL_ROUTE_MISMATCH')
    }
    await sleep(negativeWindowMs)
    const inbox = await synchronizeInbox(state, 'agent')
    const matching = inbox.messages.filter((candidate) => (
      candidate.payload.type === 'personal.message.received' &&
      candidate.payload.providerMessageId === sourceMessage.providerMessageId
    ))
    if (matching.length !== 1 || projectionState.processedProviderMessages.has(sourceMessage.providerMessageId)) {
      fail('PERSONAL_MESSAGE_DUPLICATED')
    }
    if (message.sequence <= projectionState.lastInboundSequence) fail('PERSONAL_MESSAGE_OUT_OF_ORDER')
    projectionState.processedProviderMessages.add(sourceMessage.providerMessageId)
    projectionState.lastInboundSequence = message.sequence
    safeReport(report, 'desktop.turn.received')
    return Object.freeze({
      threadId: projection.threadId,
      localTurnId: opaque('trn'),
      sourceSequence: message.sequence,
      executionCount: matching.length
    })
  }

  async function publishProjectionMessage(state, projection, { text, kind, localTurnId }) {
    const localItemId = opaque('lit')
    const response = await collaborationCommand(state.deviceCredential, {
      type: 'projection.message.publish',
      projectionId: projection.projectionId,
      projectionRevision: projection.revision,
      localItemId,
      ...(localTurnId ? { localTurnId } : {}),
      kind,
      text: required(text),
      occurredAt: new Date().toISOString(),
      idempotencyKey: idempotency('projection_publish')
    })
    if (response.type !== 'rest.receipt') fail('COLLABORATION_RESPONSE_INVALID')
    outboundTexts.set(localItemId, text)
    return localItemId
  }

  async function replyFromAgent({ participant, projection, turn, text }) {
    const state = stateFor(participant)
    if (turn.threadId !== projection.threadId) fail('THREAD_MAPPING_CHANGED')
    const localItemId = await publishProjectionMessage(state, projection, {
      text,
      kind: 'assistant_final',
      localTurnId: turn.localTurnId
    })
    safeReport(report, 'agent.reply.published')
    return Object.freeze({ logicalMessageId: localItemId })
  }

  async function awaitMobileMessage({ participant, projection, text, logicalMessageId }) {
    const state = stateFor(participant)
    projectionStateFor(projection)
    const expectedText = text ?? outboundTexts.get(logicalMessageId)
    const delivered = await awaitZulipMessage(state, projection.locator, required(expectedText, 'DRIVER_STATE_INVALID'))
    if (delivered.deliveryCount !== 1) fail('MOBILE_MESSAGE_DUPLICATED')
    safeReport(report, 'mobile.message.received')
    return Object.freeze(delivered)
  }

  async function sendDesktopMessage({ participant, projection, text }) {
    const state = stateFor(participant)
    projectionStateFor(projection)
    const logicalMessageId = await publishProjectionMessage(state, projection, { text, kind: 'user_message' })
    safeReport(report, 'desktop.message.published')
    return Object.freeze({ logicalMessageId })
  }

  async function setAgentOnline({ participant, online }) {
    const state = stateFor(participant)
    await heartbeat(state, Boolean(online))
    safeReport(report, online ? 'agent.online' : 'agent.offline')
  }

  async function createProject({ owner, members, coordinator, label }) {
    const ownerState = stateFor(owner)
    const coordinatorState = stateFor(coordinator)
    for (const member of members) stateFor(member)
    const created = await collaborationCommand(ownerState.userCredential, {
      type: 'project.create',
      ownerUserId: owner.userId,
      displayName: required(label),
      goal: `Zulip 六用户真实验收 ${runId}`,
      memberUserIds: members.map((member) => member.userId),
      coordinatorAgentId: coordinator.agentId,
      budget: { maxTasks: 20, maxTasksPerRound: 20, maxCoordinationRounds: 5, maxTaskRetries: 1 },
      idempotencyKey: idempotency('project_create')
    })
    if (created.type !== 'rest.entity' || created.entity.type !== 'project') fail('COLLABORATION_RESPONSE_INVALID')
    const topic = `${required(label).slice(0, 180)}-${runId}`
    await sendZulipMessage(ownerState, topic, topicBootstrapCommand(runId))
    const locator = await discoverLocator(ownerState, topic)
    const bound = await collaborationCommand(ownerState.userCredential, {
      type: 'project.endpoint.bind',
      projectId: created.entity.projectId,
      locator,
      idempotencyKey: idempotency('project_endpoint_bind')
    })
    if (bound.type !== 'rest.entity' || bound.entity.type !== 'project_endpoint_binding') {
      fail('COLLABORATION_RESPONSE_INVALID')
    }
    const publicProject = Object.freeze({
      projectId: created.entity.projectId,
      coordinatorAgentId: coordinator.agentId,
      locator,
      revision: created.entity.revision
    })
    projectStates.set(publicProject.projectId, {
      public: publicProject,
      owner: ownerState,
      coordinator: coordinatorState,
      members: members.map(stateFor),
      sourceInputs: [],
      inputMappings: new Map(),
      taskLock: Promise.resolve()
    })
    safeReport(report, 'project.created')
    return publicProject
  }

  async function sendProjectInput({ participant, project, text }) {
    const state = stateFor(participant)
    const projectState = projectStateFor(project)
    if (!projectState.members.includes(state)) fail('PROJECT_MEMBER_REQUIRED')
    const providerMessageId = await sendZulipMessage(state, project.locator.topicDisplayName, required(text))
    await verifyZulipSourceMessage(state, project.locator.topicDisplayName, providerMessageId)
    const source = Object.freeze({
      providerMessageId,
      senderUserId: participant.userId,
      senderEndpointId: participant.endpointId,
      projectId: project.projectId,
      text
    })
    projectState.sourceInputs.push(source)
    safeReport(report, 'project.input.sent')
    return source
  }

  async function awaitProjectInput({ coordinator, project, sourceInput }) {
    const state = stateFor(coordinator)
    const projectState = projectStateFor(project)
    if (projectState.coordinator !== state) fail('COORDINATOR_REQUIRED')
    if (!projectState.inputMappings.has(sourceInput.providerMessageId)) {
      const notifications = await waitForInboxCount(state, 'agent', (message) => (
        message.payload.type === 'project.input.received' && message.payload.projectId === project.projectId
      ), projectState.sourceInputs.length)
      const sources = [...projectState.sourceInputs].sort((left, right) => Number(left.providerMessageId) - Number(right.providerMessageId))
      for (let index = 0; index < sources.length; index += 1) {
        const notification = notifications[index]
        const source = sources[index]
        if (!notification || !source) fail('PROJECT_INPUT_CORRELATION_FAILED')
        projectState.inputMappings.set(source.providerMessageId, notification)
      }
    }
    const notification = projectState.inputMappings.get(sourceInput.providerMessageId)
    if (!notification) fail('PROJECT_INPUT_CORRELATION_FAILED')
    state.agentInbox.consumed.add(notification.inboxMessageId)
    safeReport(report, 'project.input.received')
    return Object.freeze({
      projectInputId: notification.payload.projectInputId,
      senderUserId: sourceInput.senderUserId
    })
  }

  async function currentProject(projectState, token = projectState.owner.userCredential) {
    const response = await collaborationCommand(token, { type: 'project.get', projectId: projectState.public.projectId })
    if (response.type !== 'rest.entity' || response.entity.type !== 'project') fail('COLLABORATION_RESPONSE_INVALID')
    return response.entity
  }

  async function withProjectTaskLock(projectState, operation) {
    const previous = projectState.taskLock
    let release
    projectState.taskLock = new Promise((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  async function createTaskWithAgent(agentState, projectState, assigneeState, label) {
    return withProjectTaskLock(projectState, async () => {
      const current = await currentProject(projectState, agentState.deviceCredential)
      const response = await collaborationCommand(agentState.deviceCredential, {
        type: 'task.create',
        projectId: projectState.public.projectId,
        expectedRevision: current.revision,
        assigneeAgentId: assigneeState.public.agentId,
        title: required(label),
        objective: `真实 Zulip 验收任务 ${label}`,
        completionCriteria: ['由指定 Worker 通过生产 Agent inbox 完成'],
        dependencyTaskIds: [],
        idempotencyKey: idempotency('task_create')
      })
      if (response.type !== 'rest.entity' || response.entity.type !== 'task') fail('COLLABORATION_RESPONSE_INVALID')
      return response.entity
    })
  }

  async function createTask({ coordinator, project, assignee, label }) {
    const projectState = projectStateFor(project)
    const coordinatorState = stateFor(coordinator)
    const assigneeState = stateFor(assignee)
    const task = await createTaskWithAgent(coordinatorState, projectState, assigneeState, label)
    safeReport(report, 'task.created')
    return Object.freeze(task)
  }

  async function awaitTaskOffer({ participant, task }) {
    const state = stateFor(participant)
    const message = await waitForInbox(state, 'agent', (candidate) => (
      candidate.payload.type === 'task.offered' &&
      candidate.payload.taskId === task.taskId &&
      candidate.payload.revision === task.revision
    ))
    if (message.recipientType !== 'agent' || message.recipientAgentId !== participant.agentId) {
      fail('TASK_ROUTE_MISMATCH')
    }
    safeReport(report, 'task.offer.received')
    return Object.freeze({ task, sequence: message.sequence })
  }

  async function transitionTask(state, task, status, extra = {}) {
    const response = await collaborationCommand(state.deviceCredential, {
      type: 'task.transition',
      taskId: task.taskId,
      expectedRevision: task.revision,
      status,
      ...extra,
      idempotencyKey: idempotency(`task_${status}`)
    })
    if (response.type !== 'rest.entity' || response.entity.type !== 'task') fail('COLLABORATION_RESPONSE_INVALID')
    return response.entity
  }

  async function completeTask({ participant, offer, result }) {
    const state = stateFor(participant)
    let task = await transitionTask(state, offer.task, 'accepted')
    task = await transitionTask(state, task, 'running')
    task = await transitionTask(state, task, 'succeeded', { resultSummary: required(result) })
    safeReport(report, 'task.completed')
    return Object.freeze({ task, result })
  }

  async function awaitTaskResult({ coordinator, task, result }) {
    const state = stateFor(coordinator)
    const message = await waitForInbox(state, 'agent', (candidate) => (
      candidate.payload.type === 'task.updated' &&
      candidate.payload.taskId === task.taskId &&
      candidate.payload.status === 'succeeded'
    ))
    const current = await collaborationCommand(state.deviceCredential, { type: 'task.get', taskId: task.taskId })
    if (current.type !== 'rest.entity' || current.entity.type !== 'task' || current.entity.status !== 'succeeded' ||
        result?.task?.taskId !== task.taskId) {
      fail('TASK_RESULT_MISMATCH')
    }
    safeReport(report, 'task.result.received')
    return Object.freeze({ task: current.entity, sequence: message.sequence })
  }

  async function createHumanNeeded({ participant, project, task, target, text }) {
    const requester = stateFor(participant)
    const targetState = stateFor(target)
    const projectState = projectStateFor(project)
    if (requester !== targetState) fail('HUMAN_TARGET_REQUIRED')
    const decisionTask = await createTaskWithAgent(
      projectState.coordinator,
      projectState,
      requester,
      `human-needed-${task.taskId.slice(-12)}`
    )
    const offer = await awaitTaskOffer({ participant, task: decisionTask })
    let running = await transitionTask(requester, offer.task, 'accepted')
    running = await transitionTask(requester, running, 'running')
    const response = await collaborationCommand(requester.deviceCredential, {
      type: 'human.needed.create',
      projectId: project.projectId,
      taskId: running.taskId,
      expectedTaskRevision: running.revision,
      targetUserId: target.userId,
      requiredAssurance: 'verified',
      prompt: required(text),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      idempotencyKey: idempotency('human_needed')
    })
    if (response.type !== 'rest.entity' || response.entity.type !== 'human_needed') {
      fail('COLLABORATION_RESPONSE_INVALID')
    }
    humanStates.set(response.entity.humanRequestId, {
      projectState,
      requester,
      target: targetState,
      task: running,
      sourceTask: task,
      prompt: text,
      notificationText: `${text}\n\n回复命令：sciforge-answer ${response.entity.humanRequestId} ${response.entity.revision} <answer>`,
      answerMessage: null
    })
    safeReport(report, 'human.needed.created')
    return Object.freeze(response.entity)
  }

  async function awaitHumanNeeded({ participant, humanNeeded }) {
    const state = stateFor(participant)
    const humanState = humanStates.get(humanNeeded?.humanRequestId)
    if (!humanState || humanState.target !== state) fail('HUMAN_STATE_INVALID')
    const message = await waitForInbox(state, 'user', (candidate) => (
      candidate.payload.type === 'human.needed' &&
      candidate.payload.request.humanRequestId === humanNeeded.humanRequestId
    ))
    const mobile = await awaitZulipMessage(state, humanState.projectState.public.locator, humanState.notificationText)
    if (mobile.deliveryCount !== 1) fail('HUMAN_NOTIFICATION_DUPLICATED')
    safeReport(report, 'human.needed.received')
    return Object.freeze({ sequence: message.sequence, providerMessageId: mobile.providerMessageId })
  }

  async function assertNoHumanNeeded({ participant, humanNeeded }) {
    const state = stateFor(participant)
    await assertInboxAbsent(state, 'user', (candidate) => (
      candidate.payload.type === 'human.needed' &&
      candidate.payload.request.humanRequestId === humanNeeded.humanRequestId
    ))
    safeReport(report, 'human.needed.absent')
  }

  function humanAnswerCommand(humanNeeded, text) {
    return `sciforge-answer ${humanNeeded.humanRequestId} ${humanNeeded.revision} ${required(text)}`
  }

  async function answerHumanNeeded({ participant, humanNeeded, text }) {
    const state = stateFor(participant)
    const humanState = humanStates.get(humanNeeded?.humanRequestId)
    if (!humanState) fail('HUMAN_STATE_INVALID')
    const coordinator = humanState.projectState.coordinator
    const matcher = (candidate) => (
      candidate.payload.type === 'human.answer.received' &&
      candidate.payload.answer.humanRequestId === humanNeeded.humanRequestId
    )
    const before = coordinator.agentInbox.messages.filter(matcher).length
    const command = humanAnswerCommand(humanNeeded, text)
    await sendZulipMessage(state, humanState.projectState.public.locator.topicDisplayName, command)
    if (state !== humanState.target) {
      await assertInboxAbsent(coordinator, 'agent', matcher)
      const current = await collaborationCommand(state.userCredential, { type: 'task.get', taskId: humanState.task.taskId })
      if (current.type !== 'rest.entity' || current.entity.type !== 'task' || current.entity.status !== 'needs_human') {
        fail('HUMAN_REJECTION_NOT_OBSERVED')
      }
      fail('HUMAN_TARGET_REQUIRED')
    }
    await sendZulipMessage(state, humanState.projectState.public.locator.topicDisplayName, command)
    const message = await waitForInbox(coordinator, 'agent', matcher, { consume: false })
    await sleep(negativeWindowMs)
    await synchronizeInbox(coordinator, 'agent')
    const matching = coordinator.agentInbox.messages.filter(matcher)
    if (matching.length - before !== 1) fail('HUMAN_ANSWER_DUPLICATED')
    humanState.answerMessage = message
    safeReport(report, 'human.answer.received')
    return Object.freeze(message.payload.answer)
  }

  async function awaitHumanAnswer({ coordinator, humanNeeded, humanAnswer }) {
    const state = stateFor(coordinator)
    const humanState = humanStates.get(humanNeeded?.humanRequestId)
    if (!humanState || humanState.projectState.coordinator !== state || !humanState.answerMessage) {
      fail('HUMAN_STATE_INVALID')
    }
    const message = humanState.answerMessage
    if (message.payload.type !== 'human.answer.received' ||
        message.payload.answer.humanAnswerId !== humanAnswer.humanAnswerId ||
        message.payload.answer.answeredByUserId !== humanState.target.public.userId ||
        message.payload.answer.answeredFromHumanEndpointId !== humanState.target.public.endpointId) {
      fail('HUMAN_ANSWER_MISMATCH')
    }
    state.agentInbox.consumed.add(message.inboxMessageId)
    safeReport(report, 'human.answer.confirmed')
    return Object.freeze({ sequence: message.sequence })
  }

  async function handoffCoordinator({ owner, project, from, to }) {
    const ownerState = stateFor(owner)
    const fromState = stateFor(from)
    const toState = stateFor(to)
    const projectState = projectStateFor(project)
    if (projectState.owner !== ownerState || projectState.coordinator !== fromState) fail('COORDINATOR_REQUIRED')
    const current = await currentProject(projectState)
    const response = await collaborationCommand(ownerState.userCredential, {
      type: 'project.transfer_coordinator',
      projectId: project.projectId,
      expectedRevision: current.revision,
      coordinatorAgentId: to.agentId,
      idempotencyKey: idempotency('coordinator_transfer')
    })
    if (response.type !== 'rest.entity' || response.entity.type !== 'project') fail('COLLABORATION_RESPONSE_INVALID')
    projectState.coordinator = toState
    safeReport(report, 'coordinator.transferred')
    return Object.freeze({ coordinatorAgentId: response.entity.coordinatorAgentId, revision: response.entity.revision })
  }

  async function createTaskAsAgent({ agent, project, assignee, label }) {
    const agentState = stateFor(agent)
    const assigneeState = stateFor(assignee)
    const projectState = projectStateFor(project)
    try {
      const task = await createTaskWithAgent(agentState, projectState, assigneeState, label)
      safeReport(report, 'task.created.by-agent')
      return Object.freeze(task)
    } catch (error) {
      if (error?.code === 'COLLABORATION_PERMISSION_DENIED') fail('COORDINATOR_REQUIRED')
      throw error
    }
  }

  return Object.freeze({
    bindParticipant,
    createPersonalProjection,
    sendMobileMessage,
    awaitDesktopTurn,
    replyFromAgent,
    awaitMobileMessage,
    sendDesktopMessage,
    setAgentOnline,
    createProject,
    sendProjectInput,
    awaitProjectInput,
    createTask,
    awaitTaskOffer,
    completeTask,
    awaitTaskResult,
    createHumanNeeded,
    awaitHumanNeeded,
    assertNoHumanNeeded,
    answerHumanNeeded,
    awaitHumanAnswer,
    handoffCoordinator,
    createTaskAsAgent
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(process.env.SCIFORGE_COLLAB_ZULIP_E2E === '1'
    ? 'acceptance:driver-ready\n'
    : 'acceptance:skipped\n')
}
