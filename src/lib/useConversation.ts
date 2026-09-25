import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentState, Message } from './types';

const PAGE = 200;

const byTime = (a: Message, b: Message) => a.created_at.localeCompare(b.created_at);

/**
 * Live view of the conversation and the agent's status. Realtime drives
 * updates; a periodic refetch covers dropped sockets and app resumes.
 */
export function useConversation(client: SupabaseClient | null, onInsert?: (m: Message) => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [agent, setAgent] = useState<AgentState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState(false);
  const onInsertRef = useRef(onInsert);
  onInsertRef.current = onInsert;

  const upsert = useCallback((m: Message) => {
    setMessages((prev) => {
      const i = prev.findIndex((x) => x.id === m.id);
      if (i === -1) return [...prev, m].sort(byTime);
      const next = prev.slice();
      next[i] = m;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!client) return;
    const [msgs, state] = await Promise.all([
      client.from('messages').select('*').order('created_at', { ascending: false }).limit(PAGE),
      client.from('agent_state').select('*').eq('id', 1).maybeSingle(),
    ]);
    if (msgs.data) setMessages((msgs.data as Message[]).reverse());
    if (state.data) setAgent(state.data as AgentState);
    if (!msgs.error) setLoaded(true);
  }, [client]);

  useEffect(() => {
    if (!client) return;
    refresh();
    const channel = client
      .channel('relay-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (p) => {
        if (p.eventType === 'DELETE') {
          const id = (p.old as Partial<Message>).id;
          setMessages((prev) => prev.filter((m) => m.id !== id));
          return;
        }
        const m = p.new as Message;
        upsert(m);
        if (p.eventType === 'INSERT') onInsertRef.current?.(m);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_state' }, (p) => {
        if (p.new && 'id' in p.new) setAgent(p.new as AgentState);
      })
      .subscribe((status) => {
        setLive(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') refresh();
      });

    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    const poll = window.setInterval(refresh, 30_000);
    return () => {
      client.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(poll);
    };
  }, [client, refresh, upsert]);

  return { messages, agent, loaded, live, upsert, refresh };
}

/** Re-renders on an interval so relative times and presence stay fresh. */
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
