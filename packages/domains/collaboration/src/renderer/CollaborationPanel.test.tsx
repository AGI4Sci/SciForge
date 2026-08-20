import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  collaborationProjectionViewSchema,
  collaborationStatusSnapshotSchema
} from '../contract.js'
import {
  buildAgentRegistrationInput,
  buildEndpointChallengeInput,
  buildProjectionLinkInput,
  ExplicitError,
  InlineConfirmationEditor,
  InlineTextActionEditor,
  ManagedChannelSection,
  PairingCopyFeedback,
  PairingStatus,
  ParticipantSection,
  ProjectionLocatorSelector,
  ProjectionCard,
  ProjectsSection,
  RecoverySection,
  SessionDisplayNameField,
  nextPairingPollDelayMilliseconds,
  projectionLocatorKey,
  reconcileProjectionLocatorSelection,
  writePairingCommandToClipboard
} from './CollaborationPanel.js'

const NOOP = () => undefined

test('pairing poll schedule honors server retry and stops locally at expiry after rate-limit errors', () => {
  const now = Date.parse('2026-08-15T04:00:00.000Z')
  const expiresAt = '2026-08-15T04:00:10.000Z'

  assert.equal(nextPairingPollDelayMilliseconds({
    nowMilliseconds: now,
    expiresAt,
    retryAfterSeconds: 3
  }), 3_000)
  assert.equal(nextPairingPollDelayMilliseconds({
    nowMilliseconds: now,
    expiresAt,
    retryAfterSeconds: 1
  }), 3_000)
  assert.equal(nextPairingPollDelayMilliseconds({
    nowMilliseconds: now + 8_500,
    expiresAt,
    fallbackMilliseconds: 4_000
  }), 1_500)
  assert.equal(nextPairingPollDelayMilliseconds({
    nowMilliseconds: now + 10_000,
    expiresAt,
    fallbackMilliseconds: 4_000
  }), null)
})

test('renders phone endpoint and owned Agents as one Participant card', () => {
  const snapshot = collaborationStatusSnapshotSchema.parse(statusFixture())
  const html = renderToStaticMarkup(
    <ParticipantSection
      participant={snapshot.participant}
      providerOptions={snapshot.providerOptions}
      selectedProviderKey="provider.fixture"
      locator={{}}
      participantDisplayName="Researcher A"
      agentDisplayName="Laptop A"
      pairing={null}
      busyKey={null}
      onProviderChange={NOOP}
      onLocatorChange={NOOP}
      onParticipantDisplayNameChange={NOOP}
      onAgentDisplayNameChange={NOOP}
      onStartPairing={NOOP}
      onRegisterAgent={NOOP}
      credentialRecoveryAgent={undefined}
      onRecoverAgentCredential={NOOP}
      onSelectPrimary={NOOP}
    />
  )

  assert.match(html, /data-collaboration-section="participant"/u)
  assert.match(html, /Researcher A/u)
  assert.match(html, /Phone A/u)
  assert.match(html, /data-endpoint-status="active"/u)
  assert.match(html, /data-endpoint-assurance="verified"/u)
  assert.match(html, /Laptop A/u)
  assert.match(html, /Server A/u)
  assert.match(html, /data-agent-owner="user-a"/u)
  assert.match(html, /data-primary-agent="true"/u)
  assert.match(html, /data-primary-agent="false"/u)
  assert.match(html, /collaborationSetPrimary/u)
})

test('allows Agent registration after phone verification without any Project', () => {
  const fixture = statusFixture()
  const snapshot = collaborationStatusSnapshotSchema.parse({
    ...fixture,
    participant: {
      ...fixture.participant,
      agents: [],
      primaryAgentId: undefined,
      complete: false
    },
    projects: []
  })
  const html = renderToStaticMarkup(
    <ParticipantSection
      participant={snapshot.participant}
      providerOptions={snapshot.providerOptions}
      selectedProviderKey="provider.fixture"
      locator={{}}
      participantDisplayName="Researcher A"
      agentDisplayName="Laptop A"
      pairing={null}
      busyKey={null}
      onProviderChange={NOOP}
      onLocatorChange={NOOP}
      onParticipantDisplayNameChange={NOOP}
      onAgentDisplayNameChange={NOOP}
      onStartPairing={NOOP}
      onRegisterAgent={NOOP}
      credentialRecoveryAgent={undefined}
      onRecoverAgentCredential={NOOP}
      onSelectPrimary={NOOP}
    />
  )

  assert.match(html, /collaborationRegisterAgent/u)
  assert.match(html, /data-collaboration-agent-name="true"/u)
  assert.match(html, /value="Laptop A"/u)
  assert.doesNotMatch(html, /disabled=""[^>]*>[^<]*collaborationRegisterAgent/u)
  assert.doesNotMatch(html, /projectId/u)
})

test('offers credential recovery only for the identified local Agent', () => {
  const fixture = statusFixture()
  const snapshot = collaborationStatusSnapshotSchema.parse({
    ...fixture,
    connection: {
      ...fixture.connection,
      state: 'disconnected',
      deviceCredentialAvailable: false,
      localAgentId: 'agent-a'
    }
  })
  const localAgent = snapshot.participant?.agents.find(({ agentId }) => agentId === 'agent-a')
  const html = renderToStaticMarkup(
    <ParticipantSection
      participant={snapshot.participant}
      providerOptions={snapshot.providerOptions}
      selectedProviderKey="provider.fixture"
      locator={{}}
      participantDisplayName="Researcher A"
      agentDisplayName=""
      pairing={null}
      busyKey={null}
      onProviderChange={NOOP}
      onLocatorChange={NOOP}
      onParticipantDisplayNameChange={NOOP}
      onAgentDisplayNameChange={NOOP}
      onStartPairing={NOOP}
      onRegisterAgent={NOOP}
      credentialRecoveryAgent={localAgent}
      onRecoverAgentCredential={NOOP}
      onSelectPrimary={NOOP}
    />
  )

  assert.match(html, /data-collaboration-agent-credential-recover="true"/u)
  assert.match(html, /collaborationRecoverAgentCredential/u)
  assert.doesNotMatch(html, /data-collaboration-agent-name="true"/u)
})

test('renders controlled first-binding inputs and builds typed commands without browser dialogs', () => {
  const fixture = statusFixture()
  const pairing = renderToStaticMarkup(
    <ParticipantSection
      participant={undefined}
      providerOptions={fixture.providerOptions}
      selectedProviderKey="provider.fixture"
      locator={{ realm: 'realm-cn' }}
      participantDisplayName="研究员甲"
      agentDisplayName="桌面 Agent"
      pairing={null}
      busyKey={null}
      onProviderChange={NOOP}
      onLocatorChange={NOOP}
      onParticipantDisplayNameChange={NOOP}
      onAgentDisplayNameChange={NOOP}
      onStartPairing={NOOP}
      onRegisterAgent={NOOP}
      credentialRecoveryAgent={undefined}
      onRecoverAgentCredential={NOOP}
      onSelectPrimary={NOOP}
    />
  )
  assert.match(pairing, /data-collaboration-user-name="true"/u)
  assert.match(pairing, /value="研究员甲"/u)

  const session = renderToStaticMarkup(
    <SessionDisplayNameField value="细胞分析" disabled={false} onChange={NOOP} />
  )
  assert.match(session, /data-collaboration-session-name="true"/u)
  assert.match(session, /value="细胞分析"/u)

  assert.deepEqual(buildEndpointChallengeInput({
    providerKey: 'provider.fixture',
    requestedDisplayName: ' 研究员甲 ',
    locator: { realm: ' realm-cn ' }
  }), {
    providerKey: 'provider.fixture',
    requestedDisplayName: '研究员甲',
    locator: { realm: 'realm-cn' }
  })
  assert.deepEqual(buildAgentRegistrationInput(' 桌面 Agent '), {
    displayName: '桌面 Agent',
    nodeType: 'desktop',
    capabilities: []
  })
  assert.equal(buildEndpointChallengeInput({
    providerKey: 'provider.fixture',
    requestedDisplayName: ' ',
    locator: { realm: 'realm-cn' }
  }), undefined)
  assert.equal(buildAgentRegistrationInput(' '), undefined)
})

test('copies the complete pairing command only through the renderer Clipboard API', async () => {
  const command = `/bind SF1.${'a'.repeat(32)}.Abc_123-xYz0`
  const writes: string[] = []
  assert.equal(await writePairingCommandToClipboard(command, {
    writeText: async (value) => { writes.push(value) }
  }), 'copied')
  assert.deepEqual(writes, [command])
  assert.equal(await writePairingCommandToClipboard(command, {
    writeText: async () => { throw new Error('clipboard denied') }
  }), 'failed')

  const pending = renderToStaticMarkup(
    <PairingStatus pairing={{
      status: 'pending',
      pairingCode: command,
      instruction: 'Send this entire command unchanged.',
      expiresAt: '2026-08-15T04:10:00.000Z'
    }} />
  )
  assert.match(pending, /data-collaboration-copy-pairing="true"/u)
  assert.match(pending, /\/bind SF1\./u)
  assert.match(pending, /collaborationCopyPairingInstruction/u)
  assert.match(pending, /collaborationPairingCopyHint/u)

  const copied = renderToStaticMarkup(<PairingCopyFeedback state="copied" />)
  assert.match(copied, /role="status"/u)
  assert.match(copied, /aria-live="polite"/u)
  const failed = renderToStaticMarkup(<PairingCopyFeedback state="failed" />)
  assert.match(failed, /role="alert"/u)
})

test('shows stable Session mapping, explicit owner, sharing, status, and every lifecycle action', () => {
  const projection = collaborationProjectionViewSchema.parse({
    projectionId: 'projection-1',
    ownerUserId: 'user-a',
    agentId: 'agent-a',
    agentOwnerUserId: 'user-a',
    humanEndpointId: 'endpoint-a',
    runtimeId: 'codex',
    threadId: 'thread-stable',
    workspaceRoot: '/workspace/research',
    displayName: '细胞分析',
    remoteDisplay: 'SciForge / 细胞分析',
    status: 'error',
    allowUserIds: ['user-b'],
    revision: 4,
    queueDepth: 2,
    lastSynchronizedAt: '2026-08-15T04:00:00.000Z',
    lastError: 'Remote delivery paused after a bounded retry.'
  })
  const html = renderToStaticMarkup(
    <ProjectionCard
      projection={projection}
      agentName="Laptop A"
      ownerName="Researcher A"
      busy={false}
      onUpdate={NOOP}
      onShare={NOOP}
      onRetry={NOOP}
    />
  )

  assert.match(html, /data-projection-id="projection-1"/u)
  assert.match(html, /data-projection-status="error"/u)
  assert.match(html, /data-execution-agent="agent-a"/u)
  assert.match(html, /data-execution-owner="user-a"/u)
  assert.match(html, /Researcher A · Laptop A/u)
  assert.match(html, /codex\/thread-stable/u)
  assert.match(html, /SciForge \/ 细胞分析/u)
  assert.match(html, /user-b/u)
  assert.match(html, /collaborationSharedExecutionNotice/u)
  for (const action of [
    'collaborationRename',
    'collaborationPause',
    'collaborationClose',
    'collaborationRelink',
    'collaborationSaveAllowlist',
    'collaborationRetry'
  ]) {
    assert.match(html, new RegExp(action, 'u'))
  }
})

test('renders managed Channel verification and counts only Sessions in the exact Channel', () => {
  const fixture = statusFixture()
  const containerLocator = {
    type: 'provider_managed_container_ref' as const,
    provider: 'provider.fixture',
    realmId: 'realm-a',
    containerId: 'managed-channel-1'
  }
  const snapshot = collaborationStatusSnapshotSchema.parse({
    ...fixture,
    participant: {
      ...fixture.participant,
      userId: 'usr_123456789012',
      endpoints: fixture.participant.endpoints.map((endpoint) => ({
        ...endpoint,
        humanEndpointId: 'hep_123456789012'
      }))
    },
    providerOptions: [{ ...fixture.providerOptions[0], managedContainers: true }],
    managedContainers: [{
      type: 'managed_provider_container',
      schemaVersion: 1,
      managedContainerId: 'mco_123456789012',
      ownerUserId: 'usr_123456789012',
      humanEndpointId: 'hep_123456789012',
      provider: 'provider.fixture',
      realmId: 'realm-a',
      stableKey: 'managed-owner-realm-a',
      container: containerLocator,
      displayName: 'sciforge-user-a',
      policy: {
        version: 1, visibility: 'private', history: 'protected', membership: 'owner_and_message_bot',
        memberManagement: 'provisioning_service_only', channelManagement: 'provisioning_service_only',
        ownerCanSend: true, ownerCanCreateTopics: true, messageBotCanSend: true,
        messageBotCreatesProjectTopics: false
      },
      checks: {
        private: true, protectedHistory: true, exactMembership: true, ownerCanSend: true,
        messageBotCanSend: true, ownerCanCreateTopics: true, memberManagementRestricted: true,
        channelManagementRestricted: true
      },
      status: 'active',
      lastVerifiedAt: '2026-08-20T01:00:00.000Z',
      safeErrorCode: null,
      revision: 3,
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T01:00:00.000Z'
    }],
    projections: [{
      projectionId: 'projection-managed', ownerUserId: 'user-a', agentId: 'agent-a',
      agentOwnerUserId: 'user-a', humanEndpointId: 'hep_123456789012', runtimeId: 'codex',
      threadId: 'thread-managed', displayName: 'Project A', remoteDisplay: 'sciforge-user-a / Project A',
      remoteLocator: { ...containerLocator, type: 'provider_locator', topicId: 'topic-a' },
      status: 'active', allowUserIds: ['user-a'], revision: 1, queueDepth: 0
    }, {
      projectionId: 'projection-other', ownerUserId: 'user-a', agentId: 'agent-a',
      agentOwnerUserId: 'user-a', humanEndpointId: 'hep_123456789012', runtimeId: 'codex',
      threadId: 'thread-other', displayName: 'Other', remoteDisplay: 'Other / Topic',
      remoteLocator: { type: 'provider_locator', provider: 'provider.fixture', realmId: 'realm-a',
        containerId: 'other-channel', topicId: 'topic-b' },
      status: 'active', allowUserIds: ['user-a'], revision: 1, queueDepth: 0
    }]
  })
  const html = renderToStaticMarkup(<ManagedChannelSection snapshot={snapshot} busy={false}
    onEnsure={NOOP} onRefreshStatus={NOOP} onRefreshTopics={NOOP} onReconcile={NOOP} onArchive={NOOP} />)
  assert.match(html, /collaborationManagedChannelVerified/u)
  assert.match(html, />1<\/dd>/u)
  assert.match(html, /collaborationManagedChannelRepair/u)

  const failedSnapshot = collaborationStatusSnapshotSchema.parse({
    ...snapshot,
    managedContainers: [{
      ...snapshot.managedContainers[0],
      container: null,
      checks: null,
      status: 'failed',
      lastVerifiedAt: null,
      safeErrorCode: 'invalid_payload',
      revision: 4
    }]
  })
  const failedHtml = renderToStaticMarkup(<ManagedChannelSection snapshot={failedSnapshot} busy={false}
    onEnsure={NOOP} onRefreshStatus={NOOP} onRefreshTopics={NOOP} onReconcile={NOOP} onArchive={NOOP} />)
  assert.match(failedHtml, /collaborationManagedChannelRetry/u)
  assert.doesNotMatch(failedHtml, /collaborationManagedChannelRepair/u)
})

test('renders Project Coordinator, Task assignee state, ordered queue, and explicit recovery errors', () => {
  const snapshot = collaborationStatusSnapshotSchema.parse(statusFixture())
  const projects = renderToStaticMarkup(
    <ProjectsSection projects={snapshot.projects} participant={snapshot.participant} />
  )
  assert.match(projects, /data-project-id="project-1"/u)
  assert.match(projects, /data-project-status="active"/u)
  assert.match(projects, /Laptop A/u)
  assert.match(projects, /data-task-id="task-1"/u)
  assert.match(projects, /data-task-status="needs-human"/u)
  assert.match(projects, /Server A/u)

  const recovery = renderToStaticMarkup(
    <RecoverySection
      queue={snapshot.queue}
      diagnostics={snapshot.diagnostics}
      busy={false}
      onRetry={NOOP}
    />
  )
  assert.match(recovery, /data-queue-sequence="1"/u)
  assert.match(recovery, /data-queue-state="awaiting-approval"/u)
  assert.match(recovery, /data-diagnostic-code="connection_interrupted"/u)
  assert.match(recovery, /collaborationRecover/u)

  const error = renderToStaticMarkup(<ExplicitError message="Typed permission error" />)
  assert.match(error, /role="alert"/u)
  assert.match(error, /Typed permission error/u)
})

test('keeps the challenge poll handle out of render state and has no provider branch', () => {
  const source = readFileSync(new URL('CollaborationPanel.tsx', import.meta.url), 'utf8')
  const pairingType = source.slice(
    source.indexOf('type PairingDisplay ='),
    source.indexOf('const PANEL_SECTION')
  )
  assert.ok(pairingType)
  assert.doesNotMatch(pairingType, /challengeId|secret|token/iu)
  assert.match(source, /challengeHandleRef = useRef<string \| null>/u)
  assert.doesNotMatch(source, /data-[^=]*(?:challenge|secret|token)/iu)
  assert.doesNotMatch(source, /\bzulip\b/iu)
  assert.doesNotMatch(source, /promptValue|confirmAction|globalThis\.(?:prompt|confirm)/u)
})

test('renders accessible controlled editors for projection mutations', () => {
  const textEditor = renderToStaticMarkup(
    <InlineTextActionEditor
      label="新的 Session 显示名称"
      value="细胞分析（二）"
      busy={false}
      submitLabel="重命名"
      onChange={NOOP}
      onSubmit={NOOP}
      onCancel={NOOP}
    />
  )
  assert.match(textEditor, /data-collaboration-inline-editor="text"/u)
  assert.match(textEditor, /新的 Session 显示名称/u)
  assert.match(textEditor, /value="细胞分析（二）"/u)

  const confirmation = renderToStaticMarkup(
    <InlineConfirmationEditor
      message="确认关闭细胞分析？"
      busy={false}
      onConfirm={NOOP}
      onCancel={NOOP}
    />
  )
  assert.match(confirmation, /data-collaboration-inline-editor="confirmation"/u)
  assert.match(confirmation, /role="group"/u)
  assert.match(confirmation, /确认关闭细胞分析？/u)
})

test('requires an explicit Topic choice and links the selected opaque locator', async () => {
  const firstTopic = {
    type: 'provider_locator' as const,
    provider: 'provider.fixture',
    realmId: 'realm-cn',
    containerId: 'container-opaque',
    topicId: 'topic-opaque-1',
    containerDisplayName: '协作空间',
    topicDisplayName: '第一个主题'
  }
  const secondTopic = {
    ...firstTopic,
    topicId: 'topic-opaque-2',
    topicDisplayName: '第二个主题'
  }
  const locators = [firstTopic, secondTopic]

  assert.equal(reconcileProjectionLocatorSelection('', locators), '')
  assert.equal(buildProjectionLinkInput({
    mode: 'existing',
    selectedLocatorKey: '',
    locators,
    agentId: 'agent-a',
    humanEndpointId: 'endpoint-a',
    runtimeId: 'codex',
    threadId: 'thread-a',
    displayName: '细胞分析'
  }), undefined)

  const selectedKey = projectionLocatorKey(secondTopic)
  const request = buildProjectionLinkInput({
    mode: 'existing',
    selectedLocatorKey: selectedKey,
    locators,
    agentId: 'agent-a',
    humanEndpointId: 'endpoint-a',
    runtimeId: 'codex',
    threadId: 'thread-a',
    displayName: '细胞分析'
  })
  assert.ok(request)
  const submitted: Array<NonNullable<typeof request>> = []
  await (async (input: NonNullable<typeof request>) => { submitted.push(input) })(request)
  assert.equal(submitted.length, 1)
  assert.strictEqual(submitted[0].locator, secondTopic)
  assert.notStrictEqual(submitted[0].locator, firstTopic)

  const html = renderToStaticMarkup(
    <ProjectionLocatorSelector
      locators={locators}
      selectedKey={selectedKey}
      busy={false}
      onSelect={NOOP}
    />
  )
  assert.match(html, /协作空间 \/ 第一个主题/u)
  assert.match(html, /协作空间 \/ 第二个主题/u)
  assert.match(html, /第二个主题<\/option>/u)
})

test('keeps locator selection across display-name refreshes without changing identity', () => {
  const before = {
    type: 'provider_locator' as const,
    provider: 'provider.fixture',
    realmId: 'realm-cn',
    containerId: 'container-opaque',
    topicId: 'topic-opaque-2',
    containerDisplayName: '协作空间',
    topicDisplayName: '第二个主题'
  }
  const selectedKey = projectionLocatorKey(before)
  const after = {
    ...before,
    containerDisplayName: '协作空间（新名称）',
    topicDisplayName: '第二个主题（新名称）'
  }

  assert.equal(reconcileProjectionLocatorSelection(selectedKey, [after]), selectedKey)
  assert.equal(projectionLocatorKey(after), selectedKey)
  assert.strictEqual(buildProjectionLinkInput({
    mode: 'new',
    selectedLocatorKey: selectedKey,
    locators: [after],
    agentId: 'agent-a',
    humanEndpointId: 'endpoint-a',
    runtimeId: 'codex',
    threadId: 'thread-a',
    displayName: '细胞分析'
  })?.locator, after)
})

function statusFixture() {
  return {
    revision: 7,
    connection: {
      configured: true,
      baseUrl: 'https://collaboration.example.com',
      state: 'connected' as const,
      lastConnectedAt: '2026-08-15T03:50:00.000Z',
      lastInboxSequence: 42,
      pendingOutboxCount: 1
    },
    providerOptions: [{
      providerKey: 'provider.fixture',
      label: 'Fixture IM',
        locatorFields: [{
        key: 'realm',
        label: 'Realm',
        required: true,
        placeholder: 'https://im.example.com'
        }],
        managedContainers: false
    }],
    managedContainers: [],
    participant: {
      userId: 'user-a',
      displayName: 'Researcher A',
      status: 'active' as const,
      revision: 3,
      complete: true,
      primaryHumanEndpointId: 'endpoint-a',
      primaryAgentId: 'agent-a',
      endpoints: [{
        humanEndpointId: 'endpoint-a',
        providerKey: 'provider.fixture',
        displayName: 'Phone A',
        status: 'active' as const,
        assurance: 'verified' as const,
        projectionLocators: [{
          type: 'provider_locator' as const,
          provider: 'provider.fixture',
          realmId: 'realm-a',
          containerId: 'sessions',
          topicId: 'personal-default',
          containerDisplayName: 'Sessions',
          topicDisplayName: 'Personal Session'
        }],
        verifiedAt: '2026-08-15T03:00:00.000Z'
      }],
      agents: [{
        agentId: 'agent-a',
        ownerUserId: 'user-a',
        displayName: 'Laptop A',
        nodeType: 'desktop' as const,
        status: 'online' as const,
        capabilities: ['agent-runtime'],
        primary: true,
        lastSeenAt: '2026-08-15T04:00:00.000Z'
      }, {
        agentId: 'agent-b',
        ownerUserId: 'user-a',
        displayName: 'Server A',
        nodeType: 'server' as const,
        status: 'offline' as const,
        capabilities: ['agent-runtime'],
        primary: false
      }]
    },
    projections: [],
    projects: [{
      projectId: 'project-1',
      name: 'Protein collaboration',
      state: 'active' as const,
      revision: 5,
      coordinatorAgentId: 'agent-a',
      memberUserIds: ['user-a', 'user-b'],
      tasks: [{
        taskId: 'task-1',
        projectId: 'project-1',
        assigneeAgentId: 'agent-b',
        revision: 2,
        title: 'Validate structure',
        state: 'needs-human' as const,
        updatedAt: '2026-08-15T04:01:00.000Z'
      }]
    }],
    queue: [{
      queueItemId: 'queue-1',
      projectionId: 'projection-1',
      sequence: 1,
      origin: 'human-endpoint' as const,
      kind: 'user-message' as const,
      state: 'awaiting-approval' as const,
      attempts: 1,
      createdAt: '2026-08-15T04:00:00.000Z',
      updatedAt: '2026-08-15T04:01:00.000Z'
    }],
    diagnostics: [{
      code: 'connection_interrupted',
      severity: 'warning' as const,
      message: 'Connection interrupted; ordered recovery is available.',
      occurredAt: '2026-08-15T04:02:00.000Z',
      recoverable: true
    }]
  }
}
