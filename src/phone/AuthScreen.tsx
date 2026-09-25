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
    const { error } = await phoneClient.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) {
      setError(/not allowed|Database error/i.test(error.message) ? 'This email is not allowed to use Relay.' : error.message);
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
    if (error) setError(error.message);
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
              {busy ? 'Sending…' : 'Email me a sign-in code'}
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
              Enter the code we sent to <b>{email}</b>
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
