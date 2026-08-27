export const CONTENT_SPACE_TRANSLATION_NAMESPACE = 'common'

export const contentSpaceMessages = Object.freeze({
  en: Object.freeze({
    contentSpaceCollaborationCenterFiles: 'Files',
    contentSpaceCollaborationCenterFilesDescription:
      'Shared inputs, Worker outputs, and exact deliverables'
  }),
  zh: Object.freeze({
    contentSpaceCollaborationCenterFiles: '文件',
    contentSpaceCollaborationCenterFilesDescription:
      '共享输入、Worker 输出与精确交付物'
  })
})

export const contentSpaceI18nResourceContribution = Object.freeze({
  namespace: CONTENT_SPACE_TRANSLATION_NAMESPACE,
  resources: contentSpaceMessages
})

export type ContentSpaceI18nResourceContribution =
  typeof contentSpaceI18nResourceContribution
