import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { phoneClient } from './client';
import { ensureNotifyPermission, notify } from './notify';
import { useConversation, useNow } from '../lib/useConversation';
import { checkPhoneUpdate, type PhoneUpdate } from '../lib/updates';
import { openExternal } from '../lib/open';
import { ONLINE_WINDOW_MS } from '../lib/config';
import type { Message } from '../lib/types';
import { MessageList } from '../ui/MessageList';
import { Composer } from '../ui/Composer';
import { ActivityBar } from '../ui/ActivityBar';
import { Logo, MoreIcon } from '../ui/icons';
import { ago } from '../ui/time';

const SUGGESTIONS = [
  'What are you able to do on my PC?',
  'Summarize what changed in my ironlog project today',
  'Check disk space and tell me what is taking the most room',
];

const isHiddenCommand = (m: Message) => m.sender === 'user' && m.body.trim() === '/stop';

export function ChatScreen({ session }: { session: Session }) {
  const now = useNow();
  const [menu, setMenu] = useState(false);
  const [update, setUpdate] = useState<PhoneUpdate | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const startedAt = useRef(Date.now());

  const { messages, agent, live, upsert } = useConversation(phoneClient, (m) => {
    if (m.sender === 'user') return;
    if (Date.parse(m.created_at) < startedAt.current) return;
    if (document.visibilityState !== 'visible') notify(m.sender === 'claude' ? 'Claude' : 'Relay', m.body);
  });

  useEffect(() => {
    ensureNotifyPermission();
    checkPhoneUpdate().then(setUpdate).catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const visible = useMemo(() => messages.filter((m) => !isHiddenCommand(m)), [messages]);
  const online = !!agent?.last_seen && now - Date.parse(agent.last_seen) < ONLINE_WINDOW_MS && agent.online;
  const working = messages.some((m) => m.sender === 'user' && m.status === 'processing');
  const queued = messages.filter((m) => m.sender === 'user' && m.status === 'queued').length;

  const send = async (body: string) => {
    const { data, error } = await phoneClient
      .from('messages')
      .insert({ sender: 'user', body, status: 'queued' })
      .select()
      .single();
    if (error) {
      setToast(error.message);
      throw error;
    }
    upsert(data as Message);
  };

  const cancel = async (m: Message) => {
    const { error } = await phoneClient.from('messages').update({ status: 'cancelled' }).eq('id', m.id).eq('status', 'queued');
    if (error) setToast(error.message);
  };

  const statusLine = working
    ? 'working…'
    : online
      ? queued
        ? `online · ${queued} queued`
        : 'online'
      : `offline · seen ${ago(agent?.last_seen ?? null, now)}`;

  return (
    <div className="phone">
      <header className="chat-head">
        <div className="avatar">
          <Logo size={40} />
          <span className={`presence ${online ? 'on' : ''}`} />
        </div>
        <div className="who">
          <div className="name">Claude</div>
          <div className={`sub ${working ? 'accent' : ''}`}>
            {statusLine}
            {!live && <span className="reconnecting"> · reconnecting</span>}
          </div>
        </div>
        <button className="icon-btn" onClick={() => setMenu((v) => !v)} aria-label="Menu">
          <MoreIcon />
        </button>
        {menu && (
          <>
            <div className="scrim" onClick={() => setMenu(false)} />
            <div className="menu">
              <div className="menu-meta">
                Signed in as
                <b>{session.user.email}</b>
                {agent?.machine && <span>Bridge: {agent.machine}{agent.version ? ` · v${agent.version}` : ''}</span>}
              </div>
              <button onClick={() => { setMenu(false); send('/new').catch(() => {}); }}>Start a fresh session</button>
              <button
                onClick={async () => {
                  setMenu(false);
                  const u = await checkPhoneUpdate().catch(() => null);
                  setUpdate(u);
                  if (!u) setToast("You're on the latest version");
                }}
              >
                Check for updates
              </button>
              <button className="danger" onClick={() => phoneClient.auth.signOut()}>Sign out</button>
            </div>
          </>
        )}
      </header>

      {update && (
        <button className="update-banner" onClick={() => openExternal(update.url)}>
          <span>Relay {update.version} is available</span>
          <b>Download</b>
        </button>
      )}

      <MessageList
        messages={visible}
        self="user"
        onCancel={cancel}
        empty={
          <div className="empty">
            <Logo size={56} />
            <h2>What should I work on?</h2>
            <p>Send a task. I'll run it on your PC and message you when it's done.</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s).catch(() => {})}>{s}</button>
              ))}
            </div>
          </div>
        }
      />

      <ActivityBar agent={agent} working={working} onStop={() => send('/stop').catch(() => {})} />
      <Composer placeholder={online ? 'Message Claude' : 'Message Claude (runs when your PC is back)'} onSend={send} enterSends={false} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
