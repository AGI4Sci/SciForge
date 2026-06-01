import type { RuntimeExecutionUnit, SciForgeRun } from '../../domain';
import { boundedRightPaneText, rightPaneInlineLabel } from './previewSafety';
import { resultText, type ResultLocale } from './resultLocale';

export function terminalStatusForRightPane(units: RuntimeExecutionUnit[], activeRun: SciForgeRun | undefined) {
  if (activeRun?.status === 'running' || units.some((unit) => unit.status === 'running')) return 'running';
  if (activeRun?.status === 'failed' || units.some((unit) => terminalExecutionUnitFailed(unit))) return 'error';
  if (!units.length) return 'empty';
  if (activeRun?.status === 'completed' || units.some((unit) => unit.status === 'done' || unit.status === 'self-healed')) return 'completed';
  return 'stopped';
}

export function terminalTranscriptRefForRightPane(units: RuntimeExecutionUnit[], activeRun: SciForgeRun | undefined) {
  const explicitRef = units
    .flatMap((unit) => [unit.stdoutRef, unit.stderrRef, unit.outputRef])
    .find((ref): ref is string => typeof ref === 'string' && Boolean(ref.trim()));
  if (explicitRef) return explicitRef;
  if (activeRun?.id) return `terminal-transcript:${rightPaneInlineLabel(activeRun.id)}`;
  return 'terminal-transcript:right-pane';
}

export function terminalPtyTranscriptRefForRightPane(units: RuntimeExecutionUnit[], activeRun: SciForgeRun | undefined) {
  const terminalUnit = units.find((unit) => unit.tool === 'shell_command' || unit.language === 'bash' || unit.language === 'shell');
  if (terminalUnit?.hash) return `pty-transcript:${rightPaneInlineLabel(terminalUnit.hash)}`;
  if (activeRun?.id) return `pty-transcript:${rightPaneInlineLabel(activeRun.id)}`;
  return 'pty-transcript:right-pane';
}

export function terminalExecutionUnitFailed(unit: RuntimeExecutionUnit) {
  return unit.status === 'failed'
    || unit.status === 'failed-with-reason'
    || unit.status === 'repair-needed'
    || Boolean(unit.failureReason);
}

export function terminalTranscriptForRightPane(units: RuntimeExecutionUnit[], locale?: ResultLocale) {
  if (!units.length) {
    return '';
  }
  return units.slice(-8).flatMap((unit, index) => {
    const command = terminalCommandForExecutionUnit(unit, index);
    const lines = [
      `$ ${boundedRightPaneText(command, 220)}`,
      terminalStatusLineForExecutionUnit(unit, locale),
      unit.stdoutRef ? `[stdout] ${rightPaneInlineLabel(unit.stdoutRef)}` : undefined,
      unit.stderrRef ? `[stderr] ${rightPaneInlineLabel(unit.stderrRef)}` : undefined,
      unit.outputRef ? `[output] ${rightPaneInlineLabel(unit.outputRef)}` : undefined,
      unit.failureReason ? `[failed] ${boundedRightPaneText(unit.failureReason, 220)}` : undefined,
    ].filter((line): line is string => Boolean(line));
    return index === 0 ? lines : ['', ...lines];
  }).join('\n');
}

function terminalCommandForExecutionUnit(unit: RuntimeExecutionUnit, index: number) {
  if (unit.code?.trim()) return unit.code.trim();
  const paramsCommand = terminalCommandFromParams(unit.params);
  if (paramsCommand) return paramsCommand;
  return unit.tool || `step-${index + 1}`;
}

function terminalCommandFromParams(params: string | undefined) {
  if (!params?.trim()) return '';
  try {
    const parsed = JSON.parse(params) as unknown;
    if (isRecord(parsed)) {
      const direct = firstStringField(parsed, ['cmd', 'command', 'script']);
      if (direct) return direct;
      const args = parsed.args;
      if (Array.isArray(args) && args.every((item) => typeof item === 'string')) return args.join(' ');
    }
  } catch {
    // Params can be plain text for legacy execution units.
  }
  return params.length <= 160 && !/[{}\[\]"]/u.test(params) ? params.trim() : '';
}

function terminalStatusLineForExecutionUnit(unit: RuntimeExecutionUnit, locale?: ResultLocale) {
  const status = terminalExecutionUnitFailed(unit) ? 'failed' : unit.status || 'recorded';
  const details = [
    unit.time ? unit.time : undefined,
    typeof unit.attempt === 'number' ? `attempt ${unit.attempt}` : undefined,
  ].filter(Boolean).join(' · ');
  const label = resultText(locale, {
    'zh-CN': status === 'running'
      ? '运行中'
      : status === 'done'
        ? '完成'
        : status === 'failed'
          ? '失败'
          : '记录',
    'en-US': status === 'running'
      ? 'running'
      : status === 'done'
        ? 'done'
        : status === 'failed'
          ? 'failed'
          : 'recorded',
  });
  return details ? `# ${label} · ${details}` : `# ${label}`;
}

function firstStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
