export function composerPromptIsComputerUseSlashCommand(prompt: string) {
  return /^\/(?:computer-use|computer\s+use)\b/i.test(prompt);
}

export function composerComputerUseCommandRequiresExactTerminalText(prompt: string) {
  return /^\/(?:computer-use|computer\s+use)\s+(?:screen\s+(?:attach|reconnect)|permission-handoff|permission-recheck|input-intent|reject|continue|repair)\b/i.test(prompt.trim());
}

export function composerPromptMentionsRelativeModality(prompt: string) {
  return /\b(?:above|previous|prior|last|earlier|attached|attachment|this|that|current|selected)\b.*\b(?:image|picture|photo|screenshot|figure|chart|plot|diagram|file|attachment|audio|video|table|document|pdf)\b/i.test(prompt)
    || /\b(?:image|picture|photo|screenshot|figure|chart|plot|diagram|file|attachment|audio|video|table|document|pdf)\b.*\b(?:above|previous|prior|last|earlier|attached|attachment|this|that|current|selected)\b/i.test(prompt)
    || /(?:上面|前面|刚才|上一[个张份]|这个|这张|该|当前|选中|附件|上传).{0,16}(?:图片|图像|截图|图|照片|文件|附件|音频|视频|表格|文档|PDF)/i.test(prompt)
    || /(?:图片|图像|截图|图|照片|文件|附件|音频|视频|表格|文档|PDF).{0,16}(?:上面|前面|刚才|上一[个张份]|这个|这张|该|当前|选中|附件|上传)/i.test(prompt)
    || /(?:上面|前面|刚才|上一[个张份]|这个|这张|这份|该|当前|选中|附件|上传).{0,24}(?:凭证|发票|票据|收据|单据|订单|证件|表单|报表|图表|文献|论文|报告|材料)/i.test(prompt)
    || /(?:凭证|发票|票据|收据|单据|订单|证件|表单|报表|图表|文献|论文|报告|材料).{0,24}(?:上面|前面|刚才|上一[个张份]|这个|这张|这份|该|当前|选中|附件|上传)/i.test(prompt);
}
