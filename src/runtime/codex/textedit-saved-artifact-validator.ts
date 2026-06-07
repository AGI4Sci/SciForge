import { stat as defaultStat, readFile as defaultReadFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import type { AppiumMac2SavedArtifactValidator } from './appium-mac2-webdriver-client.js';

const DEFAULT_MAX_BYTES = 256 * 1024;

export function createTextEditSavedArtifactValidator(options: {
  artifactPath?: string;
  maxBytes?: number;
  stat?: typeof defaultStat;
  readFile?: typeof defaultReadFile;
}): AppiumMac2SavedArtifactValidator | undefined {
  const artifactPath = safeArtifactPath(options.artifactPath);
  if (!artifactPath) return undefined;
  const maxBytes = Math.max(1, Math.min(options.maxBytes ?? DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES));
  const statImpl = options.stat ?? defaultStat;
  const readFileImpl = options.readFile ?? defaultReadFile;

  return async ({ sourceXml, request }) => {
    try {
      if (request.action !== 'save' || request.bundleId !== 'com.apple.TextEdit') throw new Error('invalid-request');
      const expectedText = textEditTextFromSourceXml(sourceXml);
      if (!expectedText) throw new Error('missing-source-text');
      const fileStat = await statImpl(artifactPath);
      if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > maxBytes) throw new Error('invalid-file');
      const savedText = await readFileImpl(artifactPath, 'utf8');
      if (normalizeText(savedText) !== normalizeText(expectedText)) throw new Error('content-mismatch');
      const actionPart = safeRefPart(request.actionId) ?? 'save-action';
      return `appium-mac2:textedit/actions/${actionPart}/artifact-validator/content-match`;
    } catch {
      throw new Error('TextEdit saved artifact validation failed.');
    }
  };
}

function safeArtifactPath(value: string | undefined): string | undefined {
  if (!value || value.length > 1024 || !isAbsolute(value)) return undefined;
  if (/https?:\/\/|data:|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(value)) return undefined;
  return value;
}

function textEditTextFromSourceXml(sourceXml: string): string | undefined {
  if (!sourceXml || sourceXml.length > 1024 * 1024) return undefined;
  const value = /\bAXTextArea\b[^>]*\bvalue="([^"]*)"/i.exec(sourceXml)?.[1]
    ?? /\bAXTextArea\b[^>]*\bAXValue="([^"]*)"/i.exec(sourceXml)?.[1];
  const decoded = decodeXmlAttribute(value);
  return decoded && decoded.trim() ? decoded : undefined;
}

function decodeXmlAttribute(value: string | undefined): string | undefined {
  return value
    ?.replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trimEnd();
}

function safeRefPart(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 160) return undefined;
  const cleaned = value.trim().replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 120);
  return cleaned || undefined;
}
