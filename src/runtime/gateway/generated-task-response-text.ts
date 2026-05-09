import type { AgentServerGenerationResponse } from '../runtime-types.js';
import { safeWorkspaceRel } from '../gateway-utils.js';

export function hydrateGeneratedTaskResponseFromText(response: AgentServerGenerationResponse, text: string): AgentServerGenerationResponse {
  return {
    ...response,
    taskFiles: response.taskFiles.map((file) => file.content ? file : {
      ...file,
      content: fencedTaskFileContentForPath(text, file.path) ?? file.content,
    }),
  };
}

function fencedTaskFileContentForPath(text: string, path: string) {
  const normalizedPath = safeWorkspaceRel(path);
  for (const match of text.matchAll(/```([a-zA-Z0-9_+.-]*)\s*\n([\s\S]*?)```/g)) {
    const language = match[1]?.trim().toLowerCase() || '';
    if (language === 'json') continue;
    const body = match[2] ?? '';
    const lines = body.replace(/\r\n/g, '\n').split('\n');
    const firstMeaningfulIndex = lines.findIndex((line) => line.trim().length > 0);
    const firstMeaningful = firstMeaningfulIndex >= 0 ? lines[firstMeaningfulIndex].trim() : '';
    const declaredPath = firstMeaningful.match(/^#\s+(.+)$/)?.[1]?.trim();
    if (declaredPath && safeWorkspaceRel(declaredPath) !== normalizedPath) continue;
    if (!declaredPath && !languageLooksCompatibleWithPath(language, normalizedPath)) continue;
    const content = declaredPath ? lines.slice(firstMeaningfulIndex + 1).join('\n').trimStart() : body.trimStart();
    if (content.trim()) return content;
  }
  return undefined;
}

function languageLooksCompatibleWithPath(language: string, path: string) {
  if (!language) return false;
  if (path.endsWith('.py')) return /python|py/.test(language);
  if (path.endsWith('.js') || path.endsWith('.mjs')) return /javascript|js|node/.test(language);
  if (path.endsWith('.ts')) return /typescript|ts/.test(language);
  if (path.endsWith('.r') || path.endsWith('.R')) return /^r$|rscript/.test(language);
  if (path.endsWith('.sh')) return /bash|shell|sh|zsh/.test(language);
  return false;
}
