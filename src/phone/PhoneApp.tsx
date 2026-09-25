import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { phoneClient } from './client';
import { AuthScreen } from './AuthScreen';
import { ChatScreen } from './ChatScreen';

export function PhoneApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    phoneClient.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = phoneClient.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="splash" />;
  return session ? <ChatScreen session={session} /> : <AuthScreen />;
}
