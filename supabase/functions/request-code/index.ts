// Issues a one-time Supabase Auth sign-in code for an allow-listed email and
// hands it to the desktop bridge (via public.login_codes) instead of emailing it.
// The free tier's built-in mailer only reaches org members and can't carry codes.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const { email: raw } = await req.json().catch(() => ({ email: '' }));
  const email = String(raw || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Enter a valid email' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: allowed } = await admin.from('allowed_users').select('email').eq('email', email).maybeSingle();
  // Same response either way so the endpoint can't be used to probe the allowlist.
  if (!allowed) return json({ ok: true });

  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await admin.from('login_codes').select('id', { count: 'exact', head: true }).eq('email', email).gt('created_at', since);
  if ((count ?? 0) >= 5) return json({ error: 'Too many codes requested. Try again in a few minutes.' }, 429);

  // Make sure the user exists (the signup guard trigger enforces the allowlist too).
  await admin.auth.admin.createUser({ email, email_confirm: true }).catch(() => {});

  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const code = data?.properties?.email_otp;
  if (error || !code) return json({ error: error?.message || 'Could not create a code' }, 500);

  await admin.from('login_codes').delete().lt('expires_at', new Date().toISOString());
  const { error: insertError } = await admin.from('login_codes').insert({ email, code });
  if (insertError) return json({ error: insertError.message }, 500);

  return json({ ok: true });
});
