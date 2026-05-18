import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { promisify } from 'node:util';

import { tryRunLocalTabularAnalysisRuntime } from './local-tabular-analysis-runtime.js';

const execFileAsync = promisify(execFile);

const deliveryOf = (artifact: unknown): { role?: string; previewPolicy?: string } => {
  if (!artifact || typeof artifact !== 'object') {
    return {};
  }
  const delivery = (artifact as { delivery?: unknown }).delivery;
  return delivery && typeof delivery === 'object' ? delivery as { role?: string; previewPolicy?: string } : {};
};

test('local tabular analysis runtime writes reproducible CSV analysis artifacts from inline messy CSV', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-'));
  const prompt = `Analyze this messy CSV with QC, cleaning, model, chart, sensitivity, rerun command, and limitations.
subject_id,group,site,batch,baseline_value,baseline_unit,week8_value,week8_unit,adherence_pct,note
S001,treatment,A,b1,12.4,mg/L,8.1,mg/L,96,ok
S002,treatment,A,b1,9500,ug/L,6400,ug/L,93,unit ug/L
S003,placebo,A,b1,11.1,mg/L,10.8,mg/L,88,ok
S004,placebo,A,b1,13.0,mg/L,12.7,mg/L,84,ok
S005,treatment,B,b2,14.2,mg/L,9.5,mg/L,80,ok
S006,treatment,B,b2,16.8,mg/L,10.4,mg/L,89,high baseline
S007,placebo,B,b2,13.7,mg/L,13.5,mg/L,77,ok
S008,placebo,B,b2,12.9,mg/L,13.1,mg/L,82,ok
S009,treatment,C,b3,9.8,mg/L,6.1,mg/L,98,ok
S010,treatment,C,b3,12.7,mg/L,,mg/L,86,missing week8
S011,placebo,C,b3,11.5,mg/L,40.0,mg/L,79,possible lab error outlier
S012,placebo,C,b3,bad,mg/L,12.4,mg/L,91,bad baseline
S013,treatment,D,b4,10.2,mg/L,6.9,mg/L,92,ok
S014,treatment,D,b4,14.5,mg/L,9.2,mg/L,95,ok
S015,placebo,D,b4,10.8,mg/L,10.9,mg/L,88,ok
S016,placebo,D,b4,13.8,mg/L,13.9,mg/L,87,ok
S014,treatment,D,b4,14.5,mg/L,9.1,mg/L,95,duplicate correction candidate`;

  const payload = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt,
    workspacePath: workspace,
    artifacts: [],
  });

  assert.ok(payload);
  assert.equal(payload?.displayIntent?.taskOutcome, 'satisfied');
  assert.match(payload?.message ?? '', /Primary model/);
  assert.match(payload?.message ?? '', /rerun script/);
  assert.deepEqual(payload?.uiManifest?.map((slot) => slot.componentId), ['report-viewer']);
  const refs = (payload?.objectReferences ?? []).map((ref) => String(ref.ref || ''));
  assert.ok(refs.some((ref) => ref.endsWith('analysis-report.md')));
  assert.ok(refs.some((ref) => ref.endsWith('rerun_analysis.py')));
  assert.equal(deliveryOf(payload?.artifacts?.find((artifact) => artifact.type === 'research-report')).role, 'primary-deliverable');
  assert.equal(payload?.artifacts?.filter((artifact) => artifact.type === 'figure').length, 2);
  assert.equal(deliveryOf(payload?.artifacts?.find((artifact) => String(artifact.id ?? '').endsWith('-chart'))).previewPolicy, 'open-system');
  assert.equal(payload?.verificationResults?.[0]?.verdict, 'pass');
  assert.match(String(payload?.executionUnits?.[0]?.verificationRef ?? ''), /^verification:local-tabular-rerun-/);
  const reportRef = refs.find((ref) => ref.endsWith('analysis-report.md'))!.replace(/^file:/, '');
  const qcChartRef = refs.find((ref) => ref.endsWith('qc-summary.svg'))!.replace(/^file:/, '');
  const report = await readFile(join(workspace, reportRef), 'utf8');
  const qcChart = await readFile(join(workspace, qcChartRef), 'utf8');
  assert.match(report, /## QC/);
  assert.match(report, /## Sensitivity/);
  assert.match(report, /## Design Diagnostics/);
  assert.match(report, /Approximate 95% CI/);
  assert.match(report, /Rerun Command/);
  assert.match(report, /QC inclusion chart/);
  assert.match(qcChart, /QC inclusion summary/);
});

test('local tabular analysis runtime reads referenced workspace CSV files', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-file-'));
  await mkdir(join(workspace, 'datasets'), { recursive: true });
  await writeFile(join(workspace, 'datasets', 'biomarker.csv'), [
    'subject,site,group,baseline_mg_l,week8_mg_l,unit,batch,notes',
    'S01,A,treatment,10.2,6.1,mg/L,b1,',
    'S02,A,treatment,9.8,5.9,mg/L,b1,',
    'S03,B,treatment,10.6,9000,ug/L,b2,unit conversion',
    'S04,B,treatment,9.9,1.1,mg/L,b2,outlier',
    'S05,A,placebo,10.1,10.2,mg/L,b1,',
    'S06,A,placebo,9.7,9.9,mg/L,b1,',
    'S07,B,placebo,bad,10.0,mg/L,b2,bad baseline',
    'S02,A,treatment,9.9,5.7,mg/L,b1,duplicate correction',
    'S08,B,placebo,10.6,18.8,mg/L,b2,outlier',
  ].join('\n'), 'utf8');

  const payload = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: 'Analyze datasets/biomarker.csv with QC, cleaning, statistical model, chart artifact, sensitivity, rerun command, and limitations.',
    workspacePath: workspace,
    artifacts: [],
  });

  assert.ok(payload);
  assert.match(payload?.message ?? '', /referenced workspace CSV\/TSV/);
  assert.match(payload?.message ?? '', /Primary model/);
  const refs = (payload?.objectReferences ?? []).map((ref) => String(ref.ref || ''));
  assert.ok(refs.some((ref) => ref.endsWith('analysis-report.md')));
  const reportRef = refs.find((ref) => ref.endsWith('analysis-report.md'))!.replace(/^file:/, '');
  const report = await readFile(join(workspace, reportRef), 'utf8');
  assert.match(report, /unit_converted_ug_l_to_mg_l/);
  assert.match(report, /Rerun Command/);
});

test('local tabular analysis runtime reads uploaded CSV refs from request references and artifacts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-upload-'));
  await mkdir(join(workspace, '.sciforge', 'uploads', 'session-1'), { recursive: true });
  await writeFile(join(workspace, '.sciforge', 'uploads', 'session-1', 'upload-1-survey.csv'), [
    'student_id,school,program,pre_survey,post_survey,notes',
    'ST01,North,standard,41,43,"ok, no issue"',
    'ST02,North,pilot,39,51,ok',
    'ST03,South,standard,42,41,ok',
    'ST04,South,pilot,40,53,ok',
    'ST05,East,standard,44,45,ok',
    'ST06,East,pilot,38,50,ok',
    'ST07,East,standard,bad,47,bad baseline',
    'ST08,North,pilot,37,80,outlier',
  ].join('\n'), 'utf8');

  const payload = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: 'Analyze the uploaded CSV with QC, cleaning, statistical model, chart, confidence interval, p value, sensitivity, rerun command, and limitations.',
    workspacePath: workspace,
    artifacts: [{
      id: 'upload-1',
      type: 'uploaded-data-file',
      dataRef: '.sciforge/uploads/session-1/upload-1-survey.csv',
      path: '.sciforge/uploads/session-1/upload-1-survey.csv',
      metadata: { source: 'user-upload', workspacePath: '.sciforge/uploads/session-1/upload-1-survey.csv' },
    }],
    references: [{
      id: 'ref-upload-1',
      kind: 'file',
      title: 'survey.csv',
      ref: '.sciforge/uploads/session-1/upload-1-survey.csv',
      sourceId: 'upload-1',
    }],
  });

  assert.ok(payload);
  assert.match(payload?.message ?? '', /referenced workspace CSV\/TSV/);
  assert.match(payload?.message ?? '', /Approximate 95% CI/);
  const refs = (payload?.objectReferences ?? []).map((ref) => String(ref.ref || ''));
  const reportRef = refs.find((ref) => ref.endsWith('analysis-report.md'))!.replace(/^file:/, '');
  const report = await readFile(join(workspace, reportRef), 'utf8');
  assert.match(report, /Approximate 95% CI/);
  assert.match(report, /approximate p=/);
  assert.match(report, /Design Diagnostics/);
});

test('local tabular analysis runtime supports cross-sectional continuous outcomes without pre-post columns', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-continuous-outcome-'));
  const prompt = `Analyze this messy A/B CSV with QC, cleaning, statistical model, chart, confidence interval, p value, sensitivity, rerun command, and limitations.
participant,clinic,arm,satisfaction_score,comment
C01,North,standard,71,ok
C02,North,coaching,82,ok
C03,North,coaching,85,ok
C04,South,standard,70,ok
C05,South,coaching,88,ok
C06,South,standard,69,ok
C07,East,standard,bad,bad outcome
C08,East,coaching,120,outlier entry
C03,North,coaching,86,duplicate correction`;

  const payload = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt,
    workspacePath: workspace,
    artifacts: [],
  });

  assert.ok(payload);
  assert.match(payload?.message ?? '', /coaching vs standard/);
  assert.match(payload?.message ?? '', /outcome_value ~ coaching/);
  const refs = (payload?.objectReferences ?? []).map((ref) => String(ref.ref || ''));
  const reportRef = refs.find((ref) => ref.endsWith('analysis-report.md'))!.replace(/^file:/, '');
  const report = await readFile(join(workspace, reportRef), 'utf8');
  assert.match(report, /mean outcome=/);
  assert.match(report, /Approximate 95% CI/);
  assert.match(report, /invalid_or_missing_outcome/);
  const scriptRef = refs.find((ref) => ref.endsWith('rerun_analysis.py'))!.replace(/^file:/, '');
  const rawRef = scriptRef.replace(/rerun_analysis\.py$/, 'input.csv');
  const outputRef = scriptRef.replace(/rerun_analysis\.py$/, 'rerun-output-continuous.json');
  await execFileAsync('python3', [scriptRef, rawRef, outputRef], { cwd: workspace });
  const rerun = JSON.parse(await readFile(join(workspace, outputRef), 'utf8')) as { analysisKind: string; responseKey: string; primaryModel: { formula: string } };
  assert.equal(rerun.analysisKind, 'cross-sectional-continuous');
  assert.equal(rerun.responseKey, 'outcome_value');
  assert.match(rerun.primaryModel.formula, /outcome_value ~ comparison_group/);
});

test('local tabular analysis runtime supports binary outcome risk-difference analyses', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-binary-outcome-'));
  const prompt = `Analyze this product experiment CSV with QC, cleaning, statistical model, chart, confidence interval, p value, sensitivity, rerun command, and limitations.
user_id,region,variant,converted,notes
U01,West,control,0,ok
U02,West,treatment,1,ok
U03,West,treatment,1,ok
U04,East,control,0,ok
U05,East,treatment,1,ok
U06,East,control,1,ok
U07,North,control,no,ok
U08,North,treatment,yes,ok
U09,North,treatment,not converted,late duplicate
U09,North,treatment,converted,duplicate correction`;

  const payload = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt,
    workspacePath: workspace,
    artifacts: [],
  });

  assert.ok(payload);
  assert.match(payload?.message ?? '', /treatment vs control/);
  assert.match(payload?.message ?? '', /event_value ~ treatment/);
  assert.match(payload?.message ?? '', /probability points/);
  const refs = (payload?.objectReferences ?? []).map((ref) => String(ref.ref || ''));
  const reportRef = refs.find((ref) => ref.endsWith('analysis-report.md'))!.replace(/^file:/, '');
  const chartRef = refs.find((ref) => ref.endsWith('change-by-group.svg'))!.replace(/^file:/, '');
  const report = await readFile(join(workspace, reportRef), 'utf8');
  const chart = await readFile(join(workspace, chartRef), 'utf8');
  assert.match(report, /event rate=/);
  assert.match(report, /linear probability risk-difference model/);
  assert.match(chart, /Event Rate by group/);
  const scriptRef = refs.find((ref) => ref.endsWith('rerun_analysis.py'))!.replace(/^file:/, '');
  const rawRef = scriptRef.replace(/rerun_analysis\.py$/, 'input.csv');
  const outputRef = scriptRef.replace(/rerun_analysis\.py$/, 'rerun-output-binary.json');
  await execFileAsync('python3', [scriptRef, rawRef, outputRef], { cwd: workspace });
  const rerun = JSON.parse(await readFile(join(workspace, outputRef), 'utf8')) as { analysisKind: string; responseKey: string; primaryModel: { formula: string } };
  assert.equal(rerun.analysisKind, 'binary-outcome');
  assert.equal(rerun.responseKey, 'event_value');
  assert.match(rerun.primaryModel.formula, /event_value ~ comparison_group/);
});

test('local tabular analysis runtime generalizes beyond treatment/placebo biomarker schemas', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-generic-'));
  const prompt = `Analyze this generic education CSV with QC, cleaning, model, chart, sensitivity, rerun command, and limitations.
participant,center,arm,pre_score,post_score,comment
P01,North,standard,62,64,
P02,North,coaching,61,70,
P03,North,coaching,59,68,
P04,South,standard,58,57,
P05,South,coaching,63,74,
P06,South,standard,60,61,
P03,North,coaching,59,69,duplicate correction
P07,South,standard,bad,63,bad baseline
P08,South,coaching,62,73,
P09,East,standard,64,65,
P10,East,coaching,60,70,`;

  const payload = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt,
    workspacePath: workspace,
    artifacts: [],
  });

  assert.ok(payload);
  assert.match(payload?.message ?? '', /coaching vs standard/);
  assert.doesNotMatch(payload?.message ?? '', /treatment coefficient|mg\/L/i);
  const refs = (payload?.objectReferences ?? []).map((ref) => String(ref.ref || ''));
  const reportRef = refs.find((ref) => ref.endsWith('analysis-report.md'))!.replace(/^file:/, '');
  const report = await readFile(join(workspace, reportRef), 'utf8');
  assert.match(report, /coaching vs standard/);
  assert.match(report, /analysis units/);
  assert.match(report, /Residual df=/);
  assert.doesNotMatch(report, /Treatment coefficient|Mean biomarker/i);
  assert.doesNotMatch(report, /ug\/L to mg\/L conversions/i);
  const cleanedRef = refs.find((ref) => ref.endsWith('cleaned.csv'))!.replace(/^file:/, '');
  const cleaned = await readFile(join(workspace, cleanedRef), 'utf8');
  assert.match(cleaned.split('\n')[0] ?? '', /baseline_value,followup_value,change_value/);
});

test('local tabular analysis runtime handles quoted CSV cells and generic id/program pre-post schemas', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-quoted-'));
  const prompt = `Analyze this survey CSV with QC, cleaning, model, chart, sensitivity, rerun command, and limitations.
student_id,school,program,pre_flag,pre_survey,post_survey,notes
ST01,North,standard,ok,41,43,"ok, no issue"
ST02,North,"pilot long-label intervention program",ok,39,51,"improved, attended"
ST03,South,standard,ok,42,41,"ok"
ST04,South,"pilot long-label intervention program",ok,40,53,"ok"
ST05,East,standard,ok,44,45,"ok"
ST06,East,"pilot long-label intervention program",ok,38,50,"ok"
ST04,South,"pilot long-label intervention program",ok,40,54,"duplicate correction, latest"
ST07,East,standard,bad,bad,47,"bad baseline, keep as missing"
ST08,North,"pilot long-label intervention program",ok,37,80,"outlier, survey entry error"`;

  const payload = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt,
    workspacePath: workspace,
    artifacts: [],
  });

  assert.ok(payload);
  assert.match(payload?.message ?? '', /pilot long-label intervention program vs standard/);
  const refs = (payload?.objectReferences ?? []).map((ref) => String(ref.ref || ''));
  const reportRef = refs.find((ref) => ref.endsWith('analysis-report.md'))!.replace(/^file:/, '');
  const cleanedRef = refs.find((ref) => ref.endsWith('cleaned.csv'))!.replace(/^file:/, '');
  const chartRef = refs.find((ref) => ref.endsWith('change-by-group.svg'))!.replace(/^file:/, '');
  const scriptRef = refs.find((ref) => ref.endsWith('rerun_analysis.py'))!.replace(/^file:/, '');
  const rawRef = scriptRef.replace(/rerun_analysis\.py$/, 'input.csv');
  const outputRef = scriptRef.replace(/rerun_analysis\.py$/, 'rerun-output-test.json');
  const report = await readFile(join(workspace, reportRef), 'utf8');
  assert.match(report, /rerun-output\.json/);
  assert.doesNotMatch(report, /\.sciforge\/local-tabular-analysis\/rerun-output\.json/);
  const cleaned = await readFile(join(workspace, cleanedRef), 'utf8');
  assert.match(cleaned, /"ok, no issue"/);
  assert.match(cleaned, /ST01,North,standard,ok,41,43/);
  assert.match(cleaned, /invalid_or_missing_baseline/);
  assert.match(cleaned, /note_flagged_outlier/);
  const chart = await readFile(join(workspace, chartRef), 'utf8');
  assert.match(chart, /pilot long-label/);
  assert.doesNotMatch(chart, /x="(?:6[4-9]\d|[7-9]\d\d)"/);
  await execFileAsync('python3', [scriptRef, rawRef, outputRef], { cwd: workspace });
  const rerun = JSON.parse(await readFile(join(workspace, outputRef), 'utf8')) as { includedCount: number; primaryModel: { primaryGroupCoefficient: number }; meanChangeDelta: number };
  assert.equal(rerun.includedCount, 6);
  assert.ok(rerun.primaryModel.primaryGroupCoefficient > 10);
  assert.ok((rerun.primaryModel as { diagnostics?: { confidenceInterval95?: number[] } }).diagnostics?.confidenceInterval95?.length);
  assert.equal(rerun.meanChangeDelta, 12);
});

test('local tabular analysis runtime answers robustness follow-ups from existing artifacts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-followup-'));
  const initial = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: `Analyze this education CSV with QC, cleaning, model, chart, sensitivity, rerun command, and limitations.
participant,center,arm,pre_score,post_score,comment
P01,North,standard,62,64,
P02,North,coaching,61,70,
P03,North,coaching,59,68,
P04,South,standard,58,57,
P05,South,coaching,63,74,
P06,South,standard,60,61,
P03,North,coaching,59,69,duplicate correction
P07,South,standard,bad,63,bad baseline
P08,South,coaching,62,73,
P09,East,standard,64,65,
P10,East,coaching,60,70,`,
    workspacePath: workspace,
    artifacts: [],
  });
  assert.ok(initial);

  const followup = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: 'Explain the robustness result and limitations from the current analysis.',
    workspacePath: workspace,
    artifacts: initial.artifacts ?? [],
    references: initial.objectReferences ?? [],
    uiState: { artifactIndex: initial.artifacts ?? [] },
  });

  assert.ok(followup);
  assert.equal(followup?.displayIntent?.taskOutcome, 'satisfied');
  assert.match(followup?.message ?? '', /answered from existing artifacts/);
  assert.match(followup?.message ?? '', /no AgentServer generation was started/);
  assert.match(followup?.message ?? '', /coaching vs standard/);
  assert.match(followup?.message ?? '', /Robustness:/);
  assert.match(followup?.message ?? '', /Limitations:/);
  assert.equal(followup?.executionUnits?.[0]?.tool, 'sciforge.local-tabular-analysis.csv.followup');
});

test('local tabular analysis runtime does not hijack explicit code-debug pytest turns', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-code-debug-'));
  const initial = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: `Analyze this education CSV with QC, cleaning, model, chart, sensitivity, rerun command, and limitations.
participant,center,arm,pre_score,post_score
P01,North,standard,62,64
P02,North,coaching,61,70
P03,North,coaching,59,68
P04,South,standard,58,57
P05,South,coaching,63,74
P06,South,standard,60,61
P07,East,standard,64,65
P08,East,coaching,60,70`,
    workspacePath: workspace,
    artifacts: [],
  });
  assert.ok(initial);

  const followup = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: 'Debug p3-debug/stats_impl.py. First run exactly: python -m pytest p3-debug/test_stats_impl.py -q, patch the implementation file, rerun tests, and report remaining risks.',
    workspacePath: workspace,
    artifacts: initial.artifacts ?? [],
    references: initial.objectReferences ?? [],
  });

  assert.equal(followup, undefined);
});

test('local tabular analysis runtime does not hijack durable methodology finalizer turns', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-methodology-'));
  const initial = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: `Analyze this education CSV with QC, cleaning, model, chart, sensitivity, rerun command, and limitations.
participant,center,arm,pre_score,post_score
P01,North,standard,62,64
P02,North,coaching,61,70
P03,North,coaching,59,68
P04,South,standard,58,57
P05,South,coaching,63,74
P06,South,standard,60,61
P07,East,standard,64,65
P08,East,coaching,60,70`,
    workspacePath: workspace,
    artifacts: [],
  });
  assert.ok(initial);

  const followup = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: '请基于刚才已有 methodology artifact 写回最终 protocol package，更新 sample/statistics table、risk register、execution checklist 和 preregistration notes。',
    workspacePath: workspace,
    artifacts: initial.artifacts ?? [],
    references: initial.objectReferences ?? [],
  });

  assert.equal(followup, undefined);
});

test('local tabular analysis runtime prefers newly referenced CSV over stale current-analysis artifacts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-fresh-over-followup-'));
  await mkdir(join(workspace, 'datasets'), { recursive: true });
  const initial = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: `Analyze this education CSV with QC, cleaning, model, chart, sensitivity, rerun command, and limitations.
participant,center,arm,pre_score,post_score,comment
P01,North,standard,62,64,
P02,North,coaching,61,70,
P03,North,coaching,59,68,
P04,South,standard,58,57,
P05,South,coaching,63,74,
P06,South,standard,60,61,`,
    workspacePath: workspace,
    artifacts: [],
  });
  assert.ok(initial);
  await writeFile(join(workspace, 'datasets', 'survey_quotes.csv'), [
    'student_id,school,program,pre_flag,pre_survey,post_survey,notes',
    'ST01,North,standard,ok,41,43,"ok, no issue"',
    'ST02,North,"pilot long-label intervention program",ok,39,51,"improved, attended"',
    'ST03,South,standard,ok,42,41,ok',
    'ST04,South,"pilot long-label intervention program",ok,40,53,ok',
    'ST05,East,standard,ok,44,45,ok',
    'ST06,East,"pilot long-label intervention program",ok,38,50,ok',
    'ST04,South,"pilot long-label intervention program",ok,40,54,"duplicate correction, latest"',
    'ST07,East,standard,bad,bad,47,"bad baseline, keep as missing"',
    'ST08,North,"pilot long-label intervention program",ok,37,80,"outlier, survey entry error"',
  ].join('\n'), 'utf8');

  const fresh = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: 'Analyze datasets/survey_quotes.csv with CSV QC, cleaning, statistical model, chart, sensitivity, rerun command, and limitations.',
    workspacePath: workspace,
    artifacts: initial.artifacts ?? [],
    references: initial.objectReferences ?? [],
  });

  assert.ok(fresh);
  assert.match(fresh?.message ?? '', /Reproducible tabular analysis completed/);
  assert.doesNotMatch(fresh?.message ?? '', /Current tabular analysis follow-up answered/);
  assert.match(fresh?.message ?? '', /pilot long-label intervention program vs standard/);
  const refs = (fresh?.objectReferences ?? []).map((ref) => String(ref.ref || ''));
  const cleanedRef = refs.find((ref) => ref.endsWith('cleaned.csv'))!.replace(/^file:/, '');
  const cleaned = await readFile(join(workspace, cleanedRef), 'utf8');
  assert.match(cleaned.split('\n')[0] ?? '', /pre_flag,pre_survey/);
  assert.match(cleaned, /note_flagged_outlier/);
});

test('local tabular analysis runtime answers rerun and chart follow-ups without re-analysis', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-rerun-followup-'));
  await mkdir(join(workspace, 'datasets'), { recursive: true });
  await writeFile(join(workspace, 'datasets', 'education.csv'), [
    'participant,center,arm,pre_score,post_score,comment',
    'P01,North,standard,62,64,',
    'P02,North,coaching,61,70,',
    'P03,North,coaching,59,68,',
    'P04,South,standard,58,57,',
    'P05,South,coaching,63,74,',
    'P06,South,standard,60,61,',
    'P03,North,coaching,59,69,duplicate correction',
    'P08,South,coaching,62,73,',
    'P09,East,standard,64,65,',
    'P10,East,coaching,60,70,',
  ].join('\n'), 'utf8');
  const initial = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: 'Analyze datasets/education.csv with QC, cleaning, statistical model, chart, sensitivity, rerun command, and limitations.',
    workspacePath: workspace,
    artifacts: [],
  });
  assert.ok(initial);

  const followup = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: 'Give the rerun command and chart path for the current analysis.',
    workspacePath: workspace,
    artifacts: initial.artifacts ?? [],
    references: initial.objectReferences ?? [],
  });

  assert.ok(followup);
  assert.match(followup?.message ?? '', /Rerun command:/);
  assert.match(followup?.message ?? '', /change-by-group\.svg/);
  assert.match(followup?.message ?? '', /rerun_analysis\.py/);
  assert.equal(followup?.artifacts?.length, initial.artifacts?.length);
});

test('local tabular analysis runtime prefers newest current analysis refs over stale context refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-newest-followup-'));
  const stale = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: `Analyze this education CSV with QC, cleaning, model, chart, sensitivity, rerun command, and limitations.
participant,center,arm,pre_score,post_score,comment
P01,North,standard,62,64,
P02,North,coaching,61,70,
P03,North,coaching,59,68,
P04,South,standard,58,57,
P05,South,coaching,63,74,
P06,South,standard,60,61,`,
    workspacePath: workspace,
    artifacts: [],
  });
  assert.ok(stale);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const current = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: `Analyze this survey CSV with QC, cleaning, model, chart, sensitivity, rerun command, and limitations.
student_id,school,program,pre_survey,post_survey,notes
ST01,North,standard,41,43,ok
ST02,North,pilot,39,51,ok
ST03,South,standard,42,41,ok
ST04,South,pilot,40,53,ok
ST05,East,standard,44,45,ok
ST06,East,pilot,38,50,ok`,
    workspacePath: workspace,
    artifacts: [],
  });
  assert.ok(current);

  const followup = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: 'Give the rerun command and QC summary for the current analysis.',
    workspacePath: workspace,
    artifacts: [...(current.artifacts ?? []), ...(stale.artifacts ?? [])],
    references: [...(current.objectReferences ?? []), ...(stale.objectReferences ?? [])],
    uiState: { artifactIndex: [...(current.artifacts ?? []), ...(stale.artifacts ?? [])] },
  });

  assert.ok(followup);
  assert.match(followup?.message ?? '', /pilot vs standard/);
  assert.doesNotMatch(followup?.message ?? '', /coaching vs standard/);
  assert.match(followup?.message ?? '', /Rerun command:/);
});

test('local tabular analysis runtime answers selected chart diagnostics from current artifacts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-chart-followup-'));
  const initial = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: `Analyze this education CSV with QC, cleaning, model, chart, sensitivity, rerun command, confidence interval, p value, and limitations.
participant,center,arm,pre_score,post_score,comment
P01,North,standard,62,64,
P02,North,coaching,61,70,
P03,North,coaching,59,68,
P04,South,standard,58,57,
P05,South,coaching,63,74,
P06,South,standard,60,61,
P07,East,standard,64,65,
P08,East,coaching,60,70,`,
    workspacePath: workspace,
    artifacts: [],
  });
  assert.ok(initial);

  const followup = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: 'Using the selected chart/current chart, explain what it shows and whether it is enough without model diagnostics, confidence interval, p value, sample size, and batch/site balance.',
    workspacePath: workspace,
    artifacts: initial.artifacts ?? [],
    references: initial.objectReferences?.filter((ref) => /change-by-group\.svg/.test(String(ref.ref))) ?? [],
  });

  assert.ok(followup);
  assert.match(followup?.message ?? '', /Chart interpretation:/);
  assert.match(followup?.message ?? '', /Design diagnostics:/);
  assert.match(followup?.message ?? '', /Group imbalance ratio .*: 1/);
  assert.match(followup?.message ?? '', /mean change/);
  assert.match(followup?.message ?? '', /confidence intervals, and p values are descriptive/);
});

test('local tabular analysis runtime answers cleaning follow-ups from the report sections', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-cleaning-followup-'));
  const initial = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: `Analyze this education CSV with QC, cleaning, model, chart, sensitivity, rerun command, and limitations.
participant,center,arm,pre_score,post_score,comment
P01,North,standard,62,64,
P02,North,coaching,61,70,
P03,North,coaching,59,68,
P04,South,standard,58,57,
P05,South,coaching,63,74,
P06,South,standard,60,61,
P03,North,coaching,59,69,duplicate correction
P07,South,standard,bad,63,bad baseline
P08,South,coaching,62,73,
P09,East,standard,64,65,
P10,East,coaching,60,70,`,
    workspacePath: workspace,
    artifacts: [],
  });
  assert.ok(initial);

  const followup = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: 'What cleaning did you apply and why for this current dataset?',
    workspacePath: workspace,
    artifacts: initial.artifacts ?? [],
    references: initial.objectReferences ?? [],
  });

  assert.ok(followup);
  assert.match(followup?.message ?? '', /Cleaning strategy:/);
  assert.match(followup?.message ?? '', /latest duplicate subject\/sample\/participant row/);
  assert.match(followup?.message ?? '', /QC:/);
  assert.doesNotMatch(followup?.message ?? '', /notebook-timeline|change-by-group\.svg: import csv/i);
});

test('local tabular analysis runtime recovers current follow-up when structured refs are missing', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-tabular-analysis-latest-followup-'));
  const initial = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: `Analyze this survey CSV with QC, cleaning, model, chart, sensitivity, rerun command, and limitations.
student_id,school,program,pre_survey,post_survey,notes
ST01,North,standard,41,43,"ok, no issue"
ST02,North,"pilot long-label intervention program",39,51,"improved, attended"
ST03,South,standard,42,41,"ok"
ST04,South,"pilot long-label intervention program",40,53,"ok"
ST05,East,standard,44,45,"ok"
ST06,East,"pilot long-label intervention program",38,50,"ok"
ST04,South,"pilot long-label intervention program",40,54,"duplicate correction, latest"
ST07,East,standard,bad,47,"bad baseline, keep as missing"
ST08,North,"pilot long-label intervention program",37,80,"outlier, survey entry error"`,
    workspacePath: workspace,
    artifacts: [],
  });
  assert.ok(initial);

  const followup = await tryRunLocalTabularAnalysisRuntime({
    skillDomain: 'literature',
    prompt: 'Show the rerun command, chart path, and QC flags for this current analysis.',
    workspacePath: workspace,
    artifacts: [],
    references: [],
  });

  assert.ok(followup);
  assert.match(followup?.message ?? '', /Current tabular analysis follow-up answered/);
  assert.match(followup?.message ?? '', /Rerun command:/);
  assert.match(followup?.message ?? '', /invalid_or_missing_baseline/);
  assert.match(followup?.message ?? '', /change-by-group\.svg/);
});
