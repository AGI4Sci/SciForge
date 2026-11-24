/**
 * Strings for the user-decision questionnaire.
 *
 * They live in the package's own i18n resource so the card always speaks the
 * same language as the rest of the app: the host deep-merges this namespace into
 * the active i18next instance, and the language therefore follows the user's
 * interface-language setting instead of a hand-rolled lookup.
 */
export const userDecisionsI18nResourceContribution = Object.freeze({
  namespace: 'userDecisions',
  resources: Object.freeze({
    en: Object.freeze({
      title: 'Your decision',
      answered: 'Answered',
      cancelled: 'Cancelled',
      answerQuestions: 'Answer questions ({{count}})',
      answerLater: 'Answer later',
      moveHint: 'Drag the title bar to move this window. You can keep reading and using the app.',
      questionCounter: '{{current}} / {{total}}',
      other: 'Other',
      recommended: ' (Recommended)',
      answerLabel: 'Your answer',
      contextLabel: 'Additional context (optional)',
      later: 'Later',
      cancelRequest: 'Cancel request',
      back: 'Back',
      next: 'Next',
      submit: 'Submit and continue',
      submitting: 'Submitting…',
      moveWindowLabel: 'Move questionnaire window with arrow keys'
    }),
    zh: Object.freeze({
      title: '需要你决定',
      answered: '已回答',
      cancelled: '已取消',
      answerQuestions: '回答问题（{{count}}）',
      answerLater: '稍后处理',
      moveHint: '拖动标题栏可移动窗口。你可以继续阅读对话或操作其他功能。',
      questionCounter: '{{current}} / {{total}}',
      other: '其他',
      recommended: '（推荐）',
      answerLabel: '请输入你的回答',
      contextLabel: '补充说明（可选）',
      later: '稍后处理',
      cancelRequest: '取消请求',
      back: '上一题',
      next: '下一题',
      submit: '提交并继续',
      submitting: '正在提交…',
      moveWindowLabel: '移动问卷窗口，方向键移动'
    })
  })
})

export type UserDecisionsI18nResourceContribution =
  typeof userDecisionsI18nResourceContribution
