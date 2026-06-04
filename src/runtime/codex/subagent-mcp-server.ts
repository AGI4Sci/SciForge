#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { callSubagentMcpTool } from './subagent-mcp-tools.js';
import { SUBAGENT_MCP_ENV, SUBAGENT_SPAWN_AGENT_TOOL_NAME } from './subagent-extension-manifest.js';
import type { AgentCliApprovalPolicy, AgentCliSandbox } from './agent-cli-adapter.js';

const options = runtimeOptionsFromEnv(process.env);
const server = new McpServer({ name: 'sciforge-subagents', version: '0.1.0' });

server.registerTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
  description: 'Spawn a local Runtime Codex sub-agent for delegated work and return only safe summary refs.',
  inputSchema: {
    prompt: z.string().optional(),
    message: z.string().optional(),
    task: z.string().optional(),
    instructions: z.string().optional(),
    input: z.string().optional(),
    agentType: z.string().optional(),
    agent_type: z.string().optional(),
    role: z.string().optional(),
    agentId: z.string().optional(),
    agent_id: z.string().optional(),
    runInBackground: z.boolean().optional(),
    run_in_background: z.boolean().optional(),
    background: z.union([z.boolean(), z.string()]).optional(),
    resumeRef: z.string().optional(),
    resume_ref: z.string().optional(),
    resumeCandidateRef: z.string().optional(),
    resume_candidate_ref: z.string().optional(),
    resumeAgentId: z.string().optional(),
    resume_agent_id: z.string().optional(),
    ref: z.string().optional(),
    refs: z.array(z.string()).optional(),
    contextRefs: z.array(z.string()).optional(),
    context_refs: z.array(z.string()).optional(),
    evidenceRefs: z.array(z.string()).optional(),
    evidence_refs: z.array(z.string()).optional(),
    items: z.array(z.object({
      type: z.string().optional(),
      text: z.string().optional(),
      path: z.string().optional(),
      name: z.string().optional(),
    })).optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
}, async (args: unknown) => callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, args as Record<string, unknown>, options) as never);

await server.connect(new StdioServerTransport());

function runtimeOptionsFromEnv(env: NodeJS.ProcessEnv) {
  const workspace = requiredEnv(env, SUBAGENT_MCP_ENV.workspace);
  const profile = requiredEnv(env, SUBAGENT_MCP_ENV.profile);
  const sandbox = requiredSandboxEnv(env, SUBAGENT_MCP_ENV.sandbox);
  const codexHome = requiredEnv(env, SUBAGENT_MCP_ENV.codexHome);
  return {
    workspace,
    profile,
    sandbox,
    approvalPolicy: approvalPolicyFromEnv(env[SUBAGENT_MCP_ENV.approvalPolicy]),
    codexHome,
    codexCommand: env[SUBAGENT_MCP_ENV.codexCommand]?.trim() || 'codex',
    transcriptRoot: env[SUBAGENT_MCP_ENV.transcriptRoot],
    parentCommandId: env[SUBAGENT_MCP_ENV.parentCommandId],
    parentAttemptId: env[SUBAGENT_MCP_ENV.parentAttemptId],
    timeoutMs: timeoutMsFromEnv(env.SCIFORGE_SUBAGENT_TIMEOUT_MS),
  };
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the SciForge sub-agent MCP server.`);
  return value;
}

function requiredSandboxEnv(env: NodeJS.ProcessEnv, name: string): AgentCliSandbox {
  const value = requiredEnv(env, name);
  if (value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access') return value;
  throw new Error(`${name} must be one of read-only, workspace-write, or danger-full-access.`);
}

function approvalPolicyFromEnv(value: string | undefined): AgentCliApprovalPolicy | undefined {
  const policy = value?.trim();
  if (policy === 'never' || policy === 'on-request' || policy === 'on-failure' || policy === 'untrusted') return policy;
  return undefined;
}

function timeoutMsFromEnv(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
