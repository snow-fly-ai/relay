import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from '../lib/config';
import type { Message } from '../lib/types';
import {
  cancelClaude,
  describeTool,
  runClaude,
  saveConfig,
  type BridgeConfig,
  type HostInfo,
  type RunResult,
} from './claude';

export interface LogEntry {
  id: number;
  at: number;
  kind: 'info' | 'task' | 'tool' | 'done' | 'error';
  text: string;
}

export interface EngineSnapshot {
  running: boolean;
  busy: boolean;
  activity: string | null;
  current: Message | null;
  log: LogEntry[];
  config: BridgeConfig;
}

const HEARTBEAT_MS = 20_000;
const POLL_MS = 15_000;

function systemPrompt(host: HostInfo, cwd: string) {
  return [
    `You are Claude, running headlessly on the user's Windows PC "${host.machine}" through Relay, a chat app.`,
    `The user is messaging you from the Relay app on their Android phone. They cannot see your terminal or tool output, only your final reply, which arrives as a push notification and chat message.`,
    `Work autonomously and finish the task end-to-end; don't stop to ask for confirmation on routine steps. If you truly need a decision, ask one clear question and stop.`,
    `Finish with a concise, phone-friendly reply: lead with the outcome, then short bullets. Avoid long code blocks unless asked.`,
    `Working directory: ${cwd}.`,
  ].join('\n');
}

export class BridgeEngine {
  readonly client: SupabaseClient;
  private config: BridgeConfig;
  private host: HostInfo;
  private version: string;
  private listeners = new Set<() => void>();
  private timers: number[] = [];
  private logSeq = 0;
  private lastActivityPush = 0;
  private pendingActivity: number | undefined;
  private snapshot: EngineSnapshot;

  constructor(config: BridgeConfig, host: HostInfo, version: string) {
    this.config = config;
    this.host = host;
    this.version = version;
    this.client = createClient(SUPABASE_URL, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.snapshot = { running: false, busy: false, activity: null, current: null, log: [], config };
  }

  // ---- store plumbing for React -------------------------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;
  private set(patch: Partial<EngineSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }
  private log(kind: LogEntry['kind'], text: string) {
    const entry = { id: ++this.logSeq, at: Date.now(), kind, text };
    this.set({ log: [...this.snapshot.log.slice(-299), entry] });
  }

  async updateConfig(patch: Partial<BridgeConfig>) {
    this.config = { ...this.config, ...patch };
    await saveConfig(this.config);
    this.set({ config: this.config });
  }

  // ---- lifecycle -------------------------------------------------------------------
  async start() {
    if (this.snapshot.running) return;
    this.set({ running: true });
    this.log('info', `Bridge started on ${this.host.machine}`);
    await this.recoverInterrupted();

    this.client
      .channel('bridge-inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'sender=eq.user' }, (p) => {
        const m = p.new as Message;
        if (m.body.trim() === '/stop') this.stopCurrent(m);
        else this.kick();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') this.log('info', 'Listening for messages (realtime)');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') this.log('error', `Realtime ${status.toLowerCase()}; polling instead`);
      });

    this.heartbeat();
    this.timers.push(window.setInterval(() => this.heartbeat(), HEARTBEAT_MS));
    this.timers.push(window.setInterval(() => this.kick(), POLL_MS));
    window.addEventListener('beforeunload', this.goOffline);
    this.kick();
  }

  async stop() {
    this.timers.forEach((t) => window.clearInterval(t));
    this.timers = [];
    await this.client.removeAllChannels();
    await this.goOffline();
    this.set({ running: false });
    this.log('info', 'Bridge paused');
  }

  private goOffline = async () => {
    await this.client.from('agent_state').update({ online: false, activity: null }).eq('id', 1);
  };

  private async heartbeat() {
    const { error } = await this.client
      .from('agent_state')
      .update({
        online: true,
        last_seen: new Date().toISOString(),
        machine: this.host.machine,
        version: this.version,
        session_id: this.config.sessionId || null,
        activity: this.snapshot.activity,
      })
      .eq('id', 1);
    if (error) this.log('error', `Heartbeat failed: ${error.message}`);
  }

  private setActivity(text: string | null, force = false) {
    this.set({ activity: text });
    const push = () => {
      this.lastActivityPush = Date.now();
      this.pendingActivity = undefined;
      this.client.from('agent_state').update({ activity: this.snapshot.activity, last_seen: new Date().toISOString() }).eq('id', 1).then();
    };
    const wait = 1200 - (Date.now() - this.lastActivityPush);
    if (force || wait <= 0) {
      window.clearTimeout(this.pendingActivity);
      push();
    } else if (this.pendingActivity === undefined) {
      this.pendingActivity = window.setTimeout(push, wait);
    }
  }

  /** A task left "processing" means the bridge died mid-run; don't silently re-run it. */
  private async recoverInterrupted() {
    const { data } = await this.client.from('messages').select('id').eq('sender', 'user').eq('status', 'processing');
    for (const m of data ?? []) {
      await this.client.from('messages').update({ status: 'error' }).eq('id', m.id);
      await this.reply(m.id, 'That task was interrupted because the Relay bridge restarted. Send it again if you still need it.', 'system');
    }
  }

  // ---- queue -------------------------------------------------------------------------
  private async claimNext(): Promise<Message | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: next } = await this.client
        .from('messages')
        .select('*')
        .eq('sender', 'user')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!next) return null;
      const { data: claimed } = await this.client
        .from('messages')
        .update({ status: 'processing' })
        .eq('id', next.id)
        .eq('status', 'queued')
        .select()
        .maybeSingle();
      if (claimed) return claimed as Message;
    }
    return null;
  }

  kick = async () => {
    if (!this.snapshot.running || this.snapshot.busy) return;
    this.set({ busy: true });
    try {
      let m: Message | null;
      while (this.snapshot.running && (m = await this.claimNext())) {
        this.set({ current: m });
        await this.handle(m);
        this.set({ current: null });
      }
    } catch (e) {
      this.log('error', `Queue error: ${String(e)}`);
    } finally {
      this.set({ busy: false, current: null });
      this.setActivity(null, true);
    }
  };

  private async reply(replyTo: string | null, body: string, sender: 'claude' | 'system' = 'claude', meta: object = {}) {
    const { error } = await this.client.from('messages').insert({ sender, body, status: 'sent', reply_to: replyTo, meta });
    if (error) this.log('error', `Could not post reply: ${error.message}`);
  }

  private async finish(m: Message, status: Message['status']) {
    await this.client.from('messages').update({ status }).eq('id', m.id);
  }

  private async handle(m: Message) {
    const body = m.body.trim();
    this.log('task', body.length > 140 ? `${body.slice(0, 139)}…` : body);

    if (body === '/new') {
      await this.updateConfig({ sessionId: '' });
      await this.reply(m.id, 'Started a fresh session. I won’t remember the previous conversation.', 'system');
      return this.finish(m, 'done');
    }
    if (body === '/stop') {
      return this.finish(m, 'done');
    }
    if (body === '/status') {
      await this.reply(
        m.id,
        `**Bridge:** ${this.host.machine} · v${this.version}\n\n**Workspace:** \`${this.workspace()}\`\n\n**Permissions:** ${this.config.permissionMode || 'bypassPermissions'}\n\n**Session:** ${this.config.sessionId ? `\`${this.config.sessionId.slice(0, 8)}\`` : 'new'}`,
      );
      return this.finish(m, 'done');
    }
    await this.runTask(m);
  }

  private workspace() {
    return this.config.workspace || this.host.home;
  }

  /** Cancels the running task. `stopMsg` is the phone's /stop message, if any. */
  stopCurrent(stopMsg?: Message) {
    const cur = this.snapshot.current;
    if (cur) {
      this.log('info', stopMsg ? 'Stop requested from phone' : 'Stop requested');
      cancelClaude(cur.id);
    }
    // Mark the /stop itself handled so it never runs as a task.
    if (stopMsg) this.client.from('messages').update({ status: 'done' }).eq('id', stopMsg.id).eq('status', 'queued').then();
  }

  private async runTask(m: Message, retried = false): Promise<void> {
    const claudePath = this.config.claudePath || this.host.claudePath;
    if (!claudePath) {
      await this.reply(m.id, 'I can’t find Claude Code on the PC. Open the Relay bridge and set the Claude path.', 'system');
      return this.finish(m, 'error');
    }
    const cwd = this.workspace();
    this.setActivity('Thinking…', true);
    let steps = 0;
    let res: RunResult;
    try {
      res = await runClaude(
        {
          runId: m.id,
          prompt: m.body,
          cwd,
          claudePath,
          permissionMode: this.config.permissionMode || 'bypassPermissions',
          sessionId: this.config.sessionId || undefined,
          model: this.config.model || undefined,
          appendSystemPrompt: systemPrompt(this.host, cwd),
        },
        (e) => {
          if (e.type === 'system' && e.subtype === 'init' && e.session_id) {
            if (e.session_id !== this.config.sessionId) this.updateConfig({ sessionId: e.session_id });
          }
          if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
            for (const c of e.message.content) {
              if (c.type === 'tool_use') {
                steps++;
                const text = describeTool(c.name, c.input);
                this.log('tool', text);
                this.setActivity(text);
              } else if (c.type === 'text' && c.text?.trim()) {
                this.setActivity('Writing a reply…');
              } else if (c.type === 'thinking') {
                this.setActivity('Thinking…');
              }
            }
          }
        },
      );
    } catch (e) {
      this.log('error', String(e));
      await this.reply(m.id, `I couldn't start Claude Code: ${String(e)}`, 'system');
      return this.finish(m, 'error');
    }

    if (res.cancelled) {
      this.log('info', 'Task stopped');
      await this.reply(m.id, 'Stopped. Anything already changed stays as it is.', 'system');
      return this.finish(m, 'cancelled');
    }

    const r = res.result;
    const staleSession = /No conversation found|session.*not found/i.test(`${res.stderr} ${r?.result ?? ''}`);
    if (!retried && this.config.sessionId && staleSession) {
      this.log('info', 'Previous session not found; starting a new one');
      await this.updateConfig({ sessionId: '' });
      return this.runTask(m, true);
    }

    if (!r) {
      const tail = res.stderr.trim().split('\n').slice(-6).join('\n') || `exit code ${res.exitCode}`;
      this.log('error', tail);
      await this.reply(m.id, `Claude Code exited without a result:\n\n\`\`\`\n${tail}\n\`\`\``, 'system');
      return this.finish(m, 'error');
    }

    if (r.session_id) await this.updateConfig({ sessionId: r.session_id });
    const text = (r.result || '').trim() || (r.is_error ? `Something went wrong (${r.subtype}).` : 'Done.');
    const loginHint = /not logged in|\/login/i.test(text)
      ? '\n\nThe Claude Code CLI on the PC isn’t signed in. Run `claude auth login` on the PC once.'
      : '';
    await this.reply(m.id, text + loginHint, 'claude', {
      cost_usd: r.total_cost_usd,
      duration_ms: r.duration_ms,
      session_id: r.session_id,
      turns: r.num_turns,
      is_error: r.is_error,
    });
    this.log(r.is_error ? 'error' : 'done', `${r.is_error ? 'Failed' : 'Done'} · ${steps} steps · ${Math.round((r.duration_ms || 0) / 1000)}s`);
    return this.finish(m, r.is_error ? 'error' : 'done');
  }

  /** Lets the desktop post a message to the phone as Claude. */
  async sendAsClaude(body: string) {
    await this.reply(null, body, 'claude');
  }
}
