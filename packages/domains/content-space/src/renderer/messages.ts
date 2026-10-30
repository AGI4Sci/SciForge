export const CONTENT_SPACE_TRANSLATION_NAMESPACE = 'common'

export const contentSpaceMessages = Object.freeze({
  en: Object.freeze({
    rightPanelContentSpace: 'Content Space'
  }),
  zh: Object.freeze({
    rightPanelContentSpace: '内容空间'
  })
})

export const contentSpaceI18nResourceContribution = Object.freeze({
  namespace: CONTENT_SPACE_TRANSLATION_NAMESPACE,
  resources: contentSpaceMessages
})

export type ContentSpaceI18nResourceContribution =
  typeof contentSpaceI18nResourceContribution
