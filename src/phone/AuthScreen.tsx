import { useState } from 'react';
import { phoneClient } from './client';
import { Logo, MailIcon } from '../ui/icons';

export function AuthScreen() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    // Codes are delivered to the Relay bridge on the PC (see supabase/functions/request-code).
    const { data, error } = await phoneClient.functions.invoke('request-code', {
      body: { email: email.trim().toLowerCase() },
    });
    setBusy(false);
    if (error || data?.error) {
      setError(data?.error || error?.message || 'Could not send a code');
      return;
    }
    setStep('code');
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    const { error } = await phoneClient.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (error) setError(/expired|invalid/i.test(error.message) ? 'That code is wrong or expired. Request a new one.' : error.message);
  };

  return (
    <div className="auth">
      <div className="auth-glow" />
      <div className="auth-card">
        <Logo size={64} />
        <h1>Relay</h1>
        <p className="lede">Message Claude on your PC from anywhere. It works while you're away and pings you when it's done.</p>

        {step === 'email' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendCode();
            }}
          >
            <label className="field">
              <MailIcon width={18} height={18} />
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </label>
            <button className="primary" disabled={busy || !/\S+@\S+\.\S+/.test(email)}>
              {busy ? 'Sending…' : 'Get a sign-in code'}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verify();
            }}
          >
            <p className="hint">
              Your code for <b>{email}</b> is showing in the Relay bridge on your PC.
            </p>
            <input
              className="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
            <button className="primary" disabled={busy || code.length < 6}>
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <button type="button" className="ghost" onClick={() => { setStep('email'); setCode(''); setError(null); }}>
              Use a different email
            </button>
          </form>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
