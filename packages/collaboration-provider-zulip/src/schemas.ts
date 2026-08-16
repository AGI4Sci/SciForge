import { z } from 'zod'

const numericIdSchema = z.union([z.number().int().nonnegative(), z.string().trim().min(1).max(128)])
const eventNumericIdSchema = z.number().int().nonnegative().safe()
const queueIdSchema = z.string().trim().min(1).max(1_024)
const successEnvelope = {
  result: z.literal('success').optional(),
  msg: z.string().max(4_096).optional()
}
const zulipGroupSettingSchema = z.union([
  eventNumericIdSchema,
  z.strictObject({
    direct_members: z.array(eventNumericIdSchema).max(100_000),
    direct_subgroups: z.array(eventNumericIdSchema).max(100_000)
  })
])

export const zulipRecipientSchema = z.strictObject({
  id: numericIdSchema.optional(),
  email: z.string().max(320).optional(),
  full_name: z.string().max(512).optional(),
  is_mirror_dummy: z.boolean().optional()
})

export const zulipReactionSchema = z.strictObject({
  emoji_name: z.string().max(256),
  emoji_code: z.string().max(256),
  reaction_type: z.string().max(128),
  user_id: numericIdSchema.optional(),
  user: zulipRecipientSchema.optional()
})

export const zulipTopicLinkSchema = z.strictObject({
  text: z.string().max(1_024),
  url: z.string().max(8_192)
})

export const zulipMessageSchema = z.strictObject({
  id: numericIdSchema,
  type: z.enum(['stream', 'private']),
  stream_id: numericIdSchema.optional(),
  display_recipient: z.union([z.string().max(512), z.array(zulipRecipientSchema).max(1_000)]),
  subject: z.string().max(1_024).optional(),
  topic: z.string().max(1_024).optional(),
  content: z.string().max(100_000),
  raw_content: z.string().max(100_000).optional(),
  sender_id: numericIdSchema,
  sender_email: z.string().max(320),
  sender_full_name: z.string().max(512),
  sender_realm_str: z.string().max(512).optional(),
  is_me_message: z.boolean().optional(),
  timestamp: z.number().int().nonnegative().optional(),
  client: z.string().max(512).optional(),
  recipient_id: numericIdSchema.optional(),
  content_type: z.string().max(128).optional(),
  avatar_url: z.string().max(8_192).nullable().optional(),
  flags: z.array(z.string().max(128)).max(1_000).optional(),
  mentioned: z.boolean().optional(),
  wildcard_mentions: z.boolean().optional(),
  alert_words: z.array(z.string().max(512)).max(1_000).optional(),
  topic_links: z.array(zulipTopicLinkSchema).max(1_000).optional(),
  reactions: z.array(zulipReactionSchema).max(10_000).optional(),
  submessages: z.array(z.unknown()).max(1_000).optional(),
  last_edit_timestamp: z.number().int().nonnegative().optional(),
  edit_history: z.array(z.unknown()).max(1_000).optional()
})

export const zulipMessageEventSchema = z.strictObject({
  id: z.number().int(),
  type: z.literal('message'),
  message: zulipMessageSchema,
  flags: z.array(z.string().trim().min(1).max(128)).max(1_000).optional()
})

export const zulipHeartbeatEventSchema = z.strictObject({
  id: z.number().int(),
  type: z.literal('heartbeat')
})

export const zulipUpdateMessageEventSchema = z.strictObject({
  id: z.number().int(),
  type: z.literal('update_message'),
  user_id: eventNumericIdSchema.nullable(),
  rendering_only: z.boolean(),
  message_id: eventNumericIdSchema,
  message_ids: z.array(eventNumericIdSchema).min(1).max(10_000),
  flags: z.array(z.string().max(128)).max(1_000),
  edit_timestamp: z.number().int().nonnegative().max(10_000_000_000),
  stream_name: z.string().trim().min(1).max(200).optional(),
  stream_id: eventNumericIdSchema.optional(),
  new_stream_id: eventNumericIdSchema.optional(),
  propagate_mode: z.enum(['change_one', 'change_later', 'change_all']).optional(),
  orig_subject: z.string().trim().min(1).max(200).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  topic_links: z.array(zulipTopicLinkSchema).max(1_000).optional(),
  orig_content: z.string().max(100_000).optional(),
  orig_rendered_content: z.string().max(100_000).optional(),
  content: z.string().max(100_000).optional(),
  rendered_content: z.string().max(100_000).optional(),
  is_me_message: z.boolean().optional()
})

export const zulipRawEventSchema = z.discriminatedUnion('type', [
  zulipMessageEventSchema,
  zulipUpdateMessageEventSchema,
  zulipHeartbeatEventSchema
])

export const zulipUserResponseSchema = z.strictObject({
  ...successEnvelope,
  user_id: numericIdSchema,
  email: z.string().trim().min(3).max(320),
  full_name: z.string().trim().min(1).max(512),
  is_bot: z.boolean(),
  is_imported_stub: z.boolean().optional(),
  bot_type: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4)
  ]).nullable().optional(),
  bot_owner_id: eventNumericIdSchema.nullable().optional(),
  max_message_id: eventNumericIdSchema.optional(),
  is_active: z.boolean().optional(),
  role: z.number().int().optional(),
  timezone: z.string().max(256).optional(),
  date_joined: z.string().max(128).optional(),
  delivery_email: z.string().max(320).optional(),
  avatar_url: z.string().max(8_192).nullable().optional(),
  avatar_version: z.number().int().optional(),
  is_admin: z.boolean().optional(),
  is_owner: z.boolean().optional(),
  is_guest: z.boolean().optional(),
  is_billing_admin: z.boolean().optional(),
  is_mirror_dummy: z.boolean().optional(),
  profile_data: z.record(z.string(), z.unknown()).optional()
})

export const zulipSubscriptionsResponseSchema = z.strictObject({
  ...successEnvelope,
  subscriptions: z.array(z.strictObject({
    stream_id: numericIdSchema,
    name: z.string().trim().min(1).max(512),
    description: z.string().max(100_000).optional(),
    rendered_description: z.string().max(100_000).optional(),
    creator_id: eventNumericIdSchema.nullable().optional(),
    date_created: z.number().int().nonnegative().max(10_000_000_000).optional(),
    folder_id: eventNumericIdSchema.nullable().optional(),
    invite_only: z.boolean().optional(),
    is_web_public: z.boolean().optional(),
    history_public_to_subscribers: z.boolean().optional(),
    is_announcement_only: z.boolean().optional(),
    is_archived: z.boolean().optional(),
    is_recently_active: z.boolean().optional(),
    in_home_view: z.boolean().optional(),
    is_muted: z.boolean().optional(),
    pin_to_top: z.boolean().optional(),
    desktop_notifications: z.boolean().nullable().optional(),
    email_notifications: z.boolean().nullable().optional(),
    push_notifications: z.boolean().nullable().optional(),
    audible_notifications: z.boolean().nullable().optional(),
    wildcard_mentions_notify: z.boolean().nullable().optional(),
    color: z.string().max(128).optional(),
    stream_post_policy: z.number().int().optional(),
    topics_policy: z.enum([
      'inherit',
      'allow_empty_topic',
      'disable_empty_topic',
      'empty_topic_only'
    ]).optional(),
    message_retention_days: z.number().int().nullable().optional(),
    first_message_id: numericIdSchema.nullable().optional(),
    stream_weekly_traffic: z.number().int().nonnegative().safe().nullable().optional(),
    subscriber_count: z.number().int().nonnegative().safe().optional(),
    can_add_subscribers_group: zulipGroupSettingSchema.optional(),
    can_administer_channel_group: zulipGroupSettingSchema.optional(),
    can_create_topic_group: zulipGroupSettingSchema.optional(),
    can_delete_any_message_group: zulipGroupSettingSchema.optional(),
    can_delete_own_message_group: zulipGroupSettingSchema.optional(),
    can_move_messages_out_of_channel_group: zulipGroupSettingSchema.optional(),
    can_move_messages_within_channel_group: zulipGroupSettingSchema.optional(),
    can_send_message_group: zulipGroupSettingSchema.optional(),
    can_remove_subscribers_group: zulipGroupSettingSchema.optional(),
    can_resolve_topics_group: zulipGroupSettingSchema.optional(),
    can_subscribe_group: zulipGroupSettingSchema.optional()
  })).max(10_000)
})

export const zulipTopicsResponseSchema = z.strictObject({
  ...successEnvelope,
  topics: z.array(z.strictObject({
    name: z.string().trim().min(1).max(1_024),
    max_id: z.number().int().nonnegative().optional()
  })).max(100_000)
})

export const zulipSendResponseSchema = z.strictObject({
  ...successEnvelope,
  id: numericIdSchema
})

export const zulipUpdateMessageResponseSchema = z.strictObject({
  ...successEnvelope
})

export const zulipRegisterResponseSchema = z.strictObject({
  ...successEnvelope,
  queue_id: queueIdSchema,
  last_event_id: z.number().int(),
  idle_queue_timeout_secs: z.number().int().min(1).max(604_800).optional(),
  zulip_version: z.string().trim().min(1).max(256).optional(),
  zulip_feature_level: z.number().int().nonnegative().safe().optional(),
  zulip_merge_base: z.string().max(256).optional(),
  events: z.array(zulipRawEventSchema).max(10_000).optional()
})

export const zulipEventsResponseSchema = z.strictObject({
  ...successEnvelope,
  queue_id: queueIdSchema.optional(),
  events: z.array(zulipRawEventSchema).max(10_000)
})

export const zulipMessagesResponseSchema = z.strictObject({
  ...successEnvelope,
  anchor: numericIdSchema.optional(),
  found_newest: z.boolean().optional(),
  found_oldest: z.boolean().optional(),
  found_anchor: z.boolean().optional(),
  history_limited: z.boolean().optional(),
  messages: z.array(zulipMessageSchema).max(10_000)
})

export type ZulipMessage = z.infer<typeof zulipMessageSchema>
export type ZulipRawEvent = z.infer<typeof zulipRawEventSchema>
export type ZulipMessageEvent = z.infer<typeof zulipMessageEventSchema>
export type ZulipUpdateMessageEvent = z.infer<typeof zulipUpdateMessageEventSchema>
