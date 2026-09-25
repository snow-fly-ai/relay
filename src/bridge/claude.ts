import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface BridgeConfig {
  serviceKey: string;
  workspace: string;
  permissionMode: string;
  claudePath: string;
  sessionId: string;
  model: string;
}

export interface HostInfo {
  machine: string;
  home: string;
  claudePath: string | null;
}

export interface ClaudeResultEvent {
  type: 'result';
  subtype: string;
  is_error: boolean;
  result?: string;
  session_id: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
}

export interface RunResult {
  exitCode: number | null;
  result: ClaudeResultEvent | null;
  stderr: string;
  cancelled: boolean;
}

export interface RunArgs {
  runId: string;
  prompt: string;
  cwd: string;
  claudePath: string;
  permissionMode: string;
  sessionId?: string;
  model?: string;
  appendSystemPrompt?: string;
}

export const loadConfig = () => invoke<BridgeConfig>('load_config');
export const saveConfig = (config: BridgeConfig) => invoke<void>('save_config', { config });
export const hostInfo = () => invoke<HostInfo>('host_info');
export const cancelClaude = (runId: string) => invoke<boolean>('cancel_claude', { runId });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StreamEvent = any;

export async function runClaude(args: RunArgs, onEvent: (e: StreamEvent) => void): Promise<RunResult> {
  const unlisten = await listen<{ runId: string; event: StreamEvent }>('claude-event', (e) => {
    if (e.payload.runId === args.runId) onEvent(e.payload.event);
  });
  try {
    return await invoke<RunResult>('run_claude', { args });
  } finally {
    unlisten();
  }
}

const base = (p: string) => String(p || '').split(/[\\/]/).pop() || p;
const clip = (s: string, n = 90) => {
  const one = String(s || '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** One-line, human description of a tool call for the phone's activity bar. */
export function describeTool(name: string, input: Record<string, unknown> = {}): string {
  const i = input as Record<string, string>;
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return `Running ${clip(i.description || i.command, 80)}`;
    case 'Read':
      return `Reading ${base(i.file_path)}`;
    case 'Write':
      return `Writing ${base(i.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Editing ${base(i.file_path || i.notebook_path)}`;
    case 'Grep':
      return `Searching for “${clip(i.pattern, 40)}”`;
    case 'Glob':
      return `Finding files ${clip(i.pattern, 40)}`;
    case 'WebSearch':
      return `Searching the web: ${clip(i.query, 60)}`;
    case 'WebFetch':
      return `Reading ${clip(i.url, 60)}`;
    case 'Task':
    case 'Agent':
      return `Delegating: ${clip(i.description, 60)}`;
    case 'TodoWrite':
      return 'Planning next steps';
    default:
      return `Using ${name.replace(/^mcp__[^_]+__/, '')}`;
  }
}
