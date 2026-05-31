const SAME_CHAT_CONTINUITY_PROMPT =
  /\b(?:previous turn|last (?:answer|response|message)|that passphrase|the passphrase|remember(?:ed)?|earlier|at the beginning|first asked|start(?:ed)? with|original(?: question| request)?)\b|(?:还记得|记不记得|记得|一开始|最开始|开始问|开头问|之前|前面|前文|上文|上一轮|上(?:一)?条|刚才|刚刚|原先|最初)/i;

export function sameChatContinuityPrompt(prompt: string) {
  return SAME_CHAT_CONTINUITY_PROMPT.test(prompt);
}
