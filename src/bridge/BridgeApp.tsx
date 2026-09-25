import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { enable as enableAutostart, isEnabled as autostartEnabled, disable as disableAutostart } from '@tauri-apps/plugin-autostart';
import { check as checkUpdate } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { hostInfo, loadConfig, saveConfig, type BridgeConfig, type HostInfo } from './claude';
import { BridgeEngine } from './engine';
import { appVersion } from '../lib/updates';
import { useConversation, useNow } from '../lib/useConversation';
import { AGENT_EMAIL, OWNER_EMAIL } from '../lib/config';
import { MessageList } from '../ui/MessageList';
import { Composer } from '../ui/Composer';
import { ActivityBar } from '../ui/ActivityBar';
import { Logo, RefreshIcon } from '../ui/icons';
import { clock } from '../ui/time';

const UPDATE_CHECK_MS = 3 * 60 * 60 * 1000;

export function BridgeApp() {
  const [boot, setBoot] = useState<{ config: BridgeConfig; host: HostInfo; version: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadConfig(), hostInfo(), appVersion()])
      .then(([config, host, version]) => setBoot({ config, host, version }))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="bridge-setup"><p className="error-text">{error}</p></div>;
  if (!boot) return <div className="splash" />;
  if (!boot.config.serviceKey) return <Setup boot={boot} onDone={(config) => setBoot({ ...boot, config })} />;
  return <Dashboard {...boot} />;
}

function Setup({ boot, onDone }: { boot: { config: BridgeConfig; host: HostInfo }; onDone: (c: BridgeConfig) => void }) {
  const [key, setKey] = useState('');
  return (
    <div className="bridge-setup">
      <div className="auth-card">
        <Logo size={56} />
        <h1>Relay bridge</h1>
        <p className="lede">This PC runs Claude for your phone. Paste the bridge key to connect it to the Relay backend.</p>
        <input className="plain-input" placeholder="Bridge key" value={key} onChange={(e) => setKey(e.target.value)} />
        <button
          className="primary"
          disabled={key.trim().length < 20}
          onClick={async () => {
            const config = { ...boot.config, serviceKey: key.trim() };
            await saveConfig(config);
            onDone(config);
          }}
        >
          Connect
        </button>
      </div>
    </div>
  );
}

function Dashboard({ config, host, version }: { config: BridgeConfig; host: HostInfo; version: string }) {
  const engine = useMemo(() => new BridgeEngine(config, host, version), [config, host, version]);
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const { messages, agent, live } = useConversation(engine.client);
  const now = useNow(1000);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [updateState, setUpdateState] = useState<string>('');

  useEffect(() => {
    engine.start();
    return () => {
      engine.stop();
    };
  }, [engine]);

  // Start with Windows by default so the phone can always reach Claude.
  useEffect(() => {
    (async () => {
      let on = await autostartEnabled();
      if (!on && !localStorage.getItem('relay.autostart.touched')) {
        await enableAutostart();
        localStorage.setItem('relay.autostart.touched', '1');
        on = true;
      }
      setAutostart(on);
    })().catch(() => setAutostart(false));
  }, []);

  // Self-update: check on launch and every few hours; install when idle.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setUpdateState('Checking for updates…');
        const update = await checkUpdate();
        if (cancelled) return;
        if (!update) return setUpdateState(`Up to date · checked ${clock(new Date().toISOString())}`);
        while (engine.getSnapshot().busy) await new Promise((r) => setTimeout(r, 5000));
        setUpdateState(`Installing v${update.version}…`);
        await update.downloadAndInstall();
        await relaunch();
      } catch (e) {
        if (!cancelled) setUpdateState(`Update check failed: ${String(e).slice(0, 80)}`);
      }
    };
    run();
    const t = window.setInterval(run, UPDATE_CHECK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [engine]);

  const c = snap.config;
  const working = !!snap.current;

  return (
    <div className="bridge">
      <aside className="side">
        <div className="brand">
          <Logo size={34} />
          <div>
            <div className="brand-name">Relay</div>
            <div className="brand-sub">Bridge · v{version}</div>
          </div>
        </div>

        <section className="card status-card">
          <div className="status-top">
            <span className={`big-dot ${snap.running ? (working ? 'busy' : 'on') : ''}`} />
            <div>
              <div className="status-title">{!snap.running ? 'Paused' : working ? 'Working' : 'Online'}</div>
              <div className="status-sub">{snap.activity || (live ? 'Waiting for messages' : 'Connecting…')}</div>
            </div>
          </div>
          <button className="secondary" onClick={() => (snap.running ? engine.stop() : engine.start())}>
            {snap.running ? 'Pause bridge' : 'Resume bridge'}
          </button>
        </section>

        <section className="card">
          <Row label="Agent" value={AGENT_EMAIL} />
          <Row label="Owner" value={OWNER_EMAIL} />
          <Row label="Machine" value={host.machine} />
          <Row label="Claude Code" value={c.claudePath || host.claudePath || 'Not found'} mono warn={!(c.claudePath || host.claudePath)} />
        </section>

        <section className="card">
          <label className="setting">
            <span>Workspace</span>
            <input defaultValue={c.workspace || host.home} onBlur={(e) => engine.updateConfig({ workspace: e.target.value.trim() })} />
          </label>
          <label className="setting">
            <span>Permissions</span>
            <select value={c.permissionMode || 'bypassPermissions'} onChange={(e) => engine.updateConfig({ permissionMode: e.target.value })}>
              <option value="bypassPermissions">Full access</option>
              <option value="acceptEdits">Edit files only</option>
              <option value="default">Read only (ask = deny)</option>
            </select>
          </label>
          <label className="setting">
            <span>Model</span>
            <select value={c.model} onChange={(e) => engine.updateConfig({ model: e.target.value })}>
              <option value="">Default</option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </label>
          <div className="setting inline">
            <span>Session</span>
            <code>{c.sessionId ? c.sessionId.slice(0, 8) : 'new'}</code>
            <button className="link" onClick={() => engine.updateConfig({ sessionId: '' })}>Reset</button>
          </div>
          <label className="setting inline toggle">
            <span>Start with Windows</span>
            <input
              type="checkbox"
              checked={!!autostart}
              onChange={async (e) => {
                localStorage.setItem('relay.autostart.touched', '1');
                if (e.target.checked) await enableAutostart();
                else await disableAutostart();
                setAutostart(await autostartEnabled());
              }}
            />
          </label>
        </section>

        <div className="update-line">
          <RefreshIcon width={13} height={13} /> {updateState}
        </div>
      </aside>

      <main className="main">
        <header className="main-head">
          <div>
            <div className="main-title">Conversation</div>
            <div className="main-sub">
              {live ? 'Live' : 'Reconnecting…'} · phone {agent?.online ? 'can reach this PC' : 'sees you offline'}
            </div>
          </div>
        </header>
        {snap.loginCode && Date.parse(snap.loginCode.expires_at) > now && (
          <div className="login-code">
            <div>
              <div className="login-code-label">Phone sign-in code for {snap.loginCode.email}</div>
              <div className="login-code-value">{snap.loginCode.code}</div>
            </div>
            <button className="link" onClick={() => engine.dismissLoginCode()}>Dismiss</button>
          </div>
        )}
        <MessageList messages={messages} self="claude" empty={<div className="empty"><p>No messages yet. Anything sent from the phone shows up here.</p></div>} />
        <ActivityBar agent={agent} working={working} onStop={() => engine.stopCurrent()} />
        <Composer placeholder="Send a note to the phone as Claude" onSend={(t) => engine.sendAsClaude(t)} enterSends />
      </main>

      <aside className="log">
        <div className="log-head">Activity</div>
        <div className="log-list">
          {snap.log
            .slice()
            .reverse()
            .map((l) => (
              <div key={l.id} className={`log-item ${l.kind}`}>
                <span className="log-time">{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                <span className="log-text">{l.text}</span>
              </div>
            ))}
          <div className="log-foot">{Math.round((now - (snap.log[0]?.at ?? now)) / 60000)} min of history</div>
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value, mono, warn }: { label: string; value: string; mono?: boolean; warn?: boolean }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <b className={`${mono ? 'mono' : ''} ${warn ? 'warn' : ''}`} title={value}>{value}</b>
    </div>
  );
}
