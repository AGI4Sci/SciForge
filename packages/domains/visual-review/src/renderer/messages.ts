export type VisualReviewI18nResourceContribution = Readonly<{
  namespace: string
  resources: Readonly<Record<string, Readonly<Record<string, string>>>>
}>

export const visualReviewI18nResourceContribution: VisualReviewI18nResourceContribution =
  Object.freeze({
    namespace: 'common',
    resources: Object.freeze({
      en: Object.freeze({
        rightPanelVisualReview: 'Visual Review',
        visualReviewPanelTitle: 'Visual Review'
      }),
      zh: Object.freeze({
        rightPanelVisualReview: '图片审改',
        visualReviewPanelTitle: '图片审改'
      })
    })
  })
