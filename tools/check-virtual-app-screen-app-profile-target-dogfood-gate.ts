import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
  evaluateVirtualAppScreenAppProfileTargetDogfoodPassGate,
} from '../src/runtime/computer-use/virtual-app-screen-app-profiles.js';
import {
  VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_ARTIFACT_SCHEMA,
} from './virtual-app-screen-app-profile-preflight.js';

async function main(): Promise<void> {
  const profile = requiredCliArg('--profile');
  const vscodeManifestPath = requiredCliArg('--vscode-manifest');
  const preflightManifestPath = requiredCliArg('--preflight-manifest');
  const targetManifestPath = requiredCliArg('--target-manifest');
  const gate = evaluateVirtualAppScreenAppProfileTargetDogfoodPassGate({
    profile,
    vsCodeRealClosedLoopEvidenceManifest: await readJson(vscodeManifestPath),
    evidenceManifestRef: vscodeManifestPath,
    appProfilePreflightManifest: selectPreflightManifestForProfile(await readJson(preflightManifestPath), profile),
    appProfilePreflightRef: preflightManifestPath,
    targetRealSessionEvidenceManifest: await readJson(targetManifestPath),
    targetEvidenceManifestRef: targetManifestPath,
  });

  if (gate.status !== 'passed') {
    process.stderr.write([
      `[failed] VirtualAppScreen app-profile target dogfood gate profile=${profile}`,
      'sequencingOnly=false',
      'realDogfoodPassClaim=false',
      `issue=${gate.blockedReason}`,
    ].join(' ') + '\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write([
    `[passed] VirtualAppScreen app-profile target dogfood gate profile=${gate.profileId}`,
    `targetAppRef=${gate.targetAppRef}`,
    'sequencingOnly=false',
    'realDogfoodPassClaim=true',
    `vscodeManifest=${gate.evidenceManifestRef ?? vscodeManifestPath}`,
    `preflightManifest=${gate.appProfilePreflightRef ?? preflightManifestPath}`,
    `targetManifest=${gate.targetEvidenceManifestRef ?? targetManifestPath}`,
  ].join(' ') + '\n');
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function selectPreflightManifestForProfile(manifest: unknown, profile: string): unknown {
  if (!isRecord(manifest) || manifest.schemaVersion !== VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_ARTIFACT_SCHEMA) {
    return manifest;
  }
  const preflights = Array.isArray(manifest.preflights) ? manifest.preflights : [];
  return preflights.find((entry) => isRecord(entry) && entry.profileId === profile);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requiredCliArg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
