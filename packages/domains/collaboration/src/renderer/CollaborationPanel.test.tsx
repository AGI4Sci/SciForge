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
  CurrentSessionBindingSummary,
  ExplicitError,
  filterProjectionLocatorsForManagedContainer,
  groupProjectionsForSession,
  InlineConfirmationEditor,
  InlineTextActionEditor,
  ManagedChannelSection,
  PairingCopyFeedback,
  PairingStatus,
  ParticipantSection,
  ProjectionLocatorSelector,
  ProjectionCard,
  ProjectionGroup,
  ProjectsSection,
  RecoverySection,
  nextPairingPollDelayMilliseconds,
  orderProjectionsForSession,
  projectionMatchesLocator,
  projectionMatchesSession,
  projectionTopicDisplayName,
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
      agentDisplayName="Laptop A"
      pairing={null}
      busyKey={null}
      onProviderChange={NOOP}
      onLocatorChange={NOOP}
      onAgentDisplayNameChange={NOOP}
      onStartPairing={NOOP}
      onRegisterAgent={NOOP}
      authorityRecoveryAgent={undefined}
      onRecoverAgentAuthority={NOOP}
      onSelectPrimary={NOOP}
      onWorkerAcceptanceModeChange={NOOP}
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
  assert.match(html, /data-worker-acceptance-agent-id="agent-a"/u)
  assert.match(html, /value="manual" selected=""/u)
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
      agentDisplayName="Laptop A"
      pairing={null}
      busyKey={null}
      onProviderChange={NOOP}
      onLocatorChange={NOOP}
      onAgentDisplayNameChange={NOOP}
      onStartPairing={NOOP}
      onRegisterAgent={NOOP}
      authorityRecoveryAgent={undefined}
      onRecoverAgentAuthority={NOOP}
      onSelectPrimary={NOOP}
      onWorkerAcceptanceModeChange={NOOP}
    />
  )

  assert.match(html, /collaborationRegisterAgent/u)
  assert.match(html, /data-collaboration-agent-name="true"/u)
  assert.match(html, /value="Laptop A"/u)
  assert.doesNotMatch(html, /disabled=""[^>]*>[^<]*collaborationRegisterAgent/u)
  assert.doesNotMatch(html, /projectId/u)
})

test('offers authority recovery only for the identified local Agent', () => {
  const fixture = statusFixture()
  const snapshot = collaborationStatusSnapshotSchema.parse({
    ...fixture,
    connection: {
      ...fixture.connection,
      state: 'disconnected',
      agentAuthorityReady: false,
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
      agentDisplayName=""
      pairing={null}
      busyKey={null}
      onProviderChange={NOOP}
      onLocatorChange={NOOP}
      onAgentDisplayNameChange={NOOP}
      onStartPairing={NOOP}
      onRegisterAgent={NOOP}
      authorityRecoveryAgent={localAgent}
      onRecoverAgentAuthority={NOOP}
      onSelectPrimary={NOOP}
      onWorkerAcceptanceModeChange={NOOP}
    />
  )

  assert.match(html, /data-collaboration-agent-authority-recover="true"/u)
  assert.match(html, /collaborationRecoverAgentAuthority/u)
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
      agentDisplayName="桌面 Agent"
      pairing={null}
      busyKey={null}
      onProviderChange={NOOP}
      onLocatorChange={NOOP}
      onAgentDisplayNameChange={NOOP}
      onStartPairing={NOOP}
      onRegisterAgent={NOOP}
      authorityRecoveryAgent={undefined}
      onRecoverAgentAuthority={NOOP}
      onSelectPrimary={NOOP}
      onWorkerAcceptanceModeChange={NOOP}
    />
  )
  assert.doesNotMatch(pairing, /data-collaboration-user-name/u)

  assert.deepEqual(buildEndpointChallengeInput({
    providerKey: 'provider.fixture',
    locator: { realm: ' realm-cn ' }
  }), {
    providerKey: 'provider.fixture',
    locator: { realm: 'realm-cn' }
  })
  assert.deepEqual(buildAgentRegistrationInput(' 桌面 Agent '), {
    displayName: '桌面 Agent',
    nodeType: 'desktop',
    capabilities: []
  })
  assert.equal(buildEndpointChallengeInput({
    providerKey: ' ',
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

test('shows a compact personal Topic card with diagnostics folded and no sharing controls', () => {
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
      currentSession={{ id: 'thread-current', runtimeId: 'codex' }}
      busy={false}
      onUpdate={NOOP}
      onRetry={NOOP}
    />
  )

  assert.match(html, /data-projection-id="projection-1"/u)
  assert.match(html, /data-projection-status="error"/u)
  assert.match(html, /collaborationDesktopSession.*细胞分析/u)
  assert.match(html, /collaborationPersonalControlOnly/u)
  assert.match(html, /codex\/thread-stable/u)
  assert.match(html, /<details/u)
  assert.doesNotMatch(html, /Researcher A|Laptop A|user-b|collaborationSharedExecutionNotice/u)
  assert.doesNotMatch(html, /collaborationRename|collaborationSaveAllowlist|collaborationAdvancedPermissions/u)
  for (const action of [
    'collaborationPause',
    'collaborationClose',
    'collaborationRetry'
  ]) {
    assert.match(html, new RegExp(action, 'u'))
  }
  assert.doesNotMatch(html, /collaborationRelink/u)

  const paused = renderToStaticMarkup(
    <ProjectionCard
      projection={{ ...projection, status: 'paused', lastError: undefined }}
      currentSession={{ id: 'thread-current', runtimeId: 'codex' }}
      busy={false}
      onUpdate={NOOP}
      onRetry={NOOP}
    />
  )
  assert.match(paused, /collaborationRelink/u)

  const closed = renderToStaticMarkup(
    <ProjectionCard
      projection={{ ...projection, status: 'closed', lastError: undefined }}
      currentSession={{ id: 'thread-current', runtimeId: 'codex' }}
      busy={false}
      onUpdate={NOOP}
      onRetry={NOOP}
    />
  )
  assert.match(closed, /collaborationRestoreToCurrent/u)

  const occupied = renderToStaticMarkup(
    <ProjectionCard
      projection={{ ...projection, status: 'closed', lastError: undefined }}
      currentSession={{ id: 'thread-current', runtimeId: 'codex' }}
      currentSessionOccupied
      busy={false}
      onUpdate={NOOP}
      onRetry={NOOP}
    />
  )
  assert.doesNotMatch(occupied, /collaborationRestoreToCurrent|collaborationRelink/u)
})

test('makes the current Session binding compact, personal, and first-class', () => {
  const locator = {
    type: 'provider_locator' as const,
    provider: 'provider.fixture',
    realmId: 'realm-a',
    containerId: 'private-a',
    topicId: 'topic-a',
    containerDisplayName: '私人 Channel',
    topicDisplayName: '项目 A'
  }
  const current = collaborationProjectionViewSchema.parse({
    projectionId: 'projection-current', ownerUserId: 'user-a', agentId: 'agent-a',
    agentOwnerUserId: 'user-a', humanEndpointId: 'endpoint-a', runtimeId: 'codex',
    threadId: 'thread-current', displayName: '项目 A 映射', remoteDisplay: '私人 Channel / 项目 A',
    remoteLocator: locator, status: 'active', allowUserIds: [], revision: 1, queueDepth: 0
  })
  const closed = collaborationProjectionViewSchema.parse({
    ...current, projectionId: 'projection-closed', threadId: 'thread-old', status: 'closed'
  })
  const session = { id: 'thread-current', title: '左侧项目 A', runtimeId: 'codex' }

  assert.equal(projectionMatchesSession(current, session), true)
  assert.equal(projectionMatchesLocator(current, locator), true)
  assert.deepEqual(orderProjectionsForSession([closed, current], session).map((item) => item.projectionId), [
    'projection-current', 'projection-closed'
  ])
  assert.deepEqual(groupProjectionsForSession([closed, current], session), {
    current,
    other: [],
    closed: [closed]
  })

  const summary = renderToStaticMarkup(
    <CurrentSessionBindingSummary session={session} projection={current} />
  )
  assert.match(summary, /data-current-session-binding="bound"/u)
  assert.match(summary, /collaborationCurrentDesktopSession.*左侧项目 A/u)
  assert.match(summary, /collaborationPhoneLocation.*私人 Channel \/ 项目 A/u)
  assert.equal((summary.match(/font-semibold/gu) ?? []).length, 2)
  assert.match(summary, /collaborationMappingStatus/u)
  assert.match(summary, /collaborationPersonalControlOnly/u)
  assert.match(summary, /私人 Channel \/ 项目 A/u)
  assert.match(summary, /左侧项目 A/u)
  assert.match(summary, /<details/u)
  assert.doesNotMatch(summary, /user-a|collaborationSaveAllowlist|collaborationAdvancedPermissions/u)

  const selector = renderToStaticMarkup(
    <ProjectionLocatorSelector locators={[locator]} projections={[current]} session={session}
      selectedKey="" busy={false} onSelect={NOOP} />
  )
  assert.doesNotMatch(selector, /<option[^>]+disabled/u)
  assert.match(selector, /collaborationBoundToCurrentSession/u)
})

test('keeps other and closed mappings collapsed by default', () => {
  const other = renderToStaticMarkup(
    <ProjectionGroup kind="other" label="其他 Session 映射（2）">
      <div>details</div>
    </ProjectionGroup>
  )
  const closed = renderToStaticMarkup(
    <ProjectionGroup kind="closed" label="已关闭映射（1）">
      <div>closed details</div>
    </ProjectionGroup>
  )
  assert.match(other, /<details[^>]+data-projection-group="other"/u)
  assert.match(other, /<summary[^>]*>其他 Session 映射（2）/u)
  assert.doesNotMatch(other, /<details[^>]+open/u)
  assert.match(closed, /<details[^>]+data-projection-group="closed"/u)
  assert.match(closed, /<summary[^>]*>已关闭映射（1）/u)
  assert.doesNotMatch(closed, /<details[^>]+open/u)
})

test('uses the remote Topic as the only visible mapping title and follows rename', () => {
  const projection = collaborationProjectionViewSchema.parse({
    projectionId: 'projection-topic-title', ownerUserId: 'user-a', agentId: 'agent-a',
    agentOwnerUserId: 'user-a', humanEndpointId: 'endpoint-a', runtimeId: 'codex',
    threadId: 'thread-a', displayName: '左侧 Session A',
    remoteDisplay: '私人 Channel / 原 Topic',
    remoteLocator: {
      type: 'provider_locator', provider: 'provider.fixture', realmId: 'realm-a',
      containerId: 'private-a', topicId: 'topic-a', topicDisplayName: '原 Topic'
    },
    status: 'active', allowUserIds: [], revision: 1, queueDepth: 0
  })
  assert.equal(projectionTopicDisplayName(projection), '原 Topic')
  assert.equal(projectionTopicDisplayName({
    ...projection,
    remoteDisplay: '私人 Channel / 新 Topic',
    remoteLocator: { ...projection.remoteLocator!, topicDisplayName: '新 Topic' }
  }), '新 Topic')
})

test('keeps a Topic bound to another Session selectable for explicit relink', () => {
  const locator = {
    type: 'provider_locator' as const,
    provider: 'provider.fixture',
    realmId: 'realm-cn',
    containerId: 'private-channel',
    topicId: 'topic-22',
    containerDisplayName: '私人 Channel',
    topicDisplayName: 'Topic 22'
  }
  const projection = collaborationProjectionViewSchema.parse({
    projectionId: 'projection-topic-22', ownerUserId: 'user-a', agentId: 'agent-a',
    agentOwnerUserId: 'user-a', humanEndpointId: 'endpoint-a', runtimeId: 'codex',
    threadId: 'thread-old', displayName: '旧 Session', remoteDisplay: '私人 Channel / Topic 22',
    remoteLocator: locator, status: 'active', allowUserIds: [], revision: 3, queueDepth: 0
  })
  const html = renderToStaticMarkup(
    <ProjectionLocatorSelector
      locators={[locator]}
      projections={[projection]}
      session={{ id: 'thread-current', title: '当前 Session', runtimeId: 'codex' }}
      selectedKey={projectionLocatorKey(locator)}
      busy={false}
      onSelect={NOOP}
    />
  )
  assert.match(html, /Topic 22 — collaborationBoundToSession/u)
  assert.doesNotMatch(html, /<option[^>]+disabled/u)
})

test('shows a closed Topic as restorable instead of unbound', () => {
  const locator = {
    type: 'provider_locator' as const,
    provider: 'provider.fixture',
    realmId: 'realm-cn',
    containerId: 'private-channel',
    topicId: 'topic-22',
    containerDisplayName: '私人 Channel',
    topicDisplayName: 'Topic 22'
  }
  const projection = collaborationProjectionViewSchema.parse({
    projectionId: 'projection-topic-22', ownerUserId: 'user-a', agentId: 'agent-a',
    agentOwnerUserId: 'user-a', humanEndpointId: 'endpoint-a', runtimeId: 'codex',
    threadId: 'thread-old', displayName: 'Topic 22', remoteDisplay: '私人 Channel / Topic 22',
    remoteLocator: locator, status: 'closed', allowUserIds: [], revision: 4, queueDepth: 0
  })
  const html = renderToStaticMarkup(
    <ProjectionLocatorSelector
      locators={[locator]}
      projections={[projection]}
      session={{ id: 'thread-current', title: '当前 Session', runtimeId: 'codex' }}
      selectedKey={projectionLocatorKey(locator)}
      busy={false}
      onSelect={NOOP}
    />
  )
  assert.match(html, /Topic 22 — collaborationClosedTopic/u)
  assert.doesNotMatch(html, /collaborationUnboundTopic/u)
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
      status: 'drifted',
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
  assert.match(html, /collaborationManagedChannelMemberManagement/u)
  assert.match(html, /collaborationManagedChannelAdministration/u)
  assert.match(html, /Fixture IM/u)
  assert.match(html, /Phone A/u)
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
  assert.match(failedHtml, />\?</u)
})

test('keeps locator discovery inside the authenticated user managed container', () => {
  const owned = {
    type: 'provider_locator' as const,
    provider: 'provider.fixture',
    realmId: 'realm-a',
    containerId: 'managed-channel-1',
    topicId: 'owned-topic',
    topicDisplayName: '本人 Topic'
  }
  const crossUser = {
    ...owned,
    containerId: 'managed-channel-other',
    topicId: 'other-topic',
    topicDisplayName: '其他用户 Topic'
  }
  const fixture = statusFixture()
  const managed = collaborationStatusSnapshotSchema.parse({
    ...fixture,
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
      container: {
        type: 'provider_managed_container_ref',
        provider: 'provider.fixture',
        realmId: 'realm-a',
        containerId: 'managed-channel-1'
      },
      displayName: 'sciforge-user-a',
      policy: {
        version: 1, visibility: 'private', history: 'protected',
        membership: 'owner_and_message_bot', memberManagement: 'provisioning_service_only',
        channelManagement: 'provisioning_service_only', ownerCanSend: true,
        ownerCanCreateTopics: true, messageBotCanSend: true,
        messageBotCreatesProjectTopics: false
      },
      checks: {
        private: true, protectedHistory: true, exactMembership: true, ownerCanSend: true,
        messageBotCanSend: true, ownerCanCreateTopics: true,
        memberManagementRestricted: true, channelManagementRestricted: true
      },
      status: 'active', lastVerifiedAt: null, safeErrorCode: null, revision: 1,
      createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z'
    }]
  }).managedContainers

  const filtered = filterProjectionLocatorsForManagedContainer(
    [owned, crossUser],
    managed,
    'hep_123456789012'
  )
  assert.deepEqual(filtered, [owned])
  assert.deepEqual(
    filterProjectionLocatorsForManagedContainer([owned, crossUser], [], 'hep_123456789012'),
    []
  )
  const html = renderToStaticMarkup(
    <ProjectionLocatorSelector locators={filtered} projections={[]}
      session={{ id: 'thread-a', runtimeId: 'codex' }} selectedKey="" busy={false}
      onSelect={NOOP} />
  )
  assert.match(html, /本人 Topic/u)
  assert.doesNotMatch(html, /其他用户 Topic/u)
})

test('renders Project Coordinator, Task assignee state, ordered queue, and explicit recovery errors', () => {
  const snapshot = collaborationStatusSnapshotSchema.parse(statusFixture())
  const projects = renderToStaticMarkup(
    <ProjectsSection
      projects={snapshot.projects}
      participant={snapshot.participant}
      busy={false}
      onTaskOfferDecision={NOOP}
    />
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

test('renders explicit accept and reject controls only for a manual Worker offer', () => {
  const fixture = statusFixture()
  const snapshot = collaborationStatusSnapshotSchema.parse({
    ...fixture,
    projects: fixture.projects.map((project) => ({
      ...project,
      tasks: project.tasks.map((task) => ({
        ...task,
        state: 'awaiting-manual',
        decisionRequired: true
      }))
    }))
  })
  const html = renderToStaticMarkup(
    <ProjectsSection
      projects={snapshot.projects}
      participant={snapshot.participant}
      busy={false}
      onTaskOfferDecision={NOOP}
    />
  )
  assert.match(html, /data-task-offer-decision="true"/u)
  assert.match(html, /collaborationTaskAccept/u)
  assert.match(html, /collaborationTaskReject/u)
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
  assert.doesNotMatch(source, /promptValue|confirmAction|(?:globalThis|window)\.(?:prompt|confirm)/u)
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
      projections={[]}
      session={{ id: 'thread-a', runtimeId: 'codex' }}
      selectedKey={selectedKey}
      busy={false}
      onSelect={NOOP}
    />
  )
  assert.match(html, /协作空间 \/ 第一个主题/u)
  assert.match(html, /协作空间 \/ 第二个主题/u)
  assert.match(html, /第二个主题 — collaborationUnboundTopic<\/option>/u)
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
      realmLabel: 'Realm',
      containerLabel: 'Channel',
      topicLabel: 'Topic',
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
        workerAcceptanceMode: 'manual' as const,
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
      tasks: [{
        taskId: 'task-1',
        projectId: 'project-1',
        executionId: 'execution-task-1',
        assigneeAgentId: 'agent-b',
        revision: 2,
        title: 'Validate structure',
        state: 'needs-human' as const,
        acceptanceMode: 'manual' as const,
        decisionRequired: false,
        preflightReasons: [],
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
