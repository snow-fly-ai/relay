-- Applied to the `relay` Supabase project (onbkumnokabovfduxzow).
create extension if not exists pgcrypto;

create table public.allowed_users (
  email text primary key,
  role text not null check (role in ('owner','agent'))
);
insert into public.allowed_users (email, role) values
  ('asnqln@gmail.com','owner'),
  ('snowfly.ai@gmail.com','agent');
alter table public.allowed_users enable row level security;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_users a
    where a.role = 'owner' and lower(a.email) = lower(coalesce(auth.jwt()->>'email','')));
$$;

-- Only allow-listed emails can ever create an account.
create or replace function public.guard_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.allowed_users where lower(email) = lower(new.email)) then
    raise exception 'This email is not allowed to use Relay';
  end if;
  return new;
end $$;
create trigger guard_signup before insert on auth.users
  for each row execute function public.guard_signup();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender text not null check (sender in ('user','claude','system')),
  body text not null check (length(body) between 1 and 100000),
  status text not null default 'sent'
    check (status in ('sent','queued','processing','done','error','cancelled')),
  reply_to uuid references public.messages(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index messages_created_idx on public.messages (created_at desc);
create index messages_queue_idx on public.messages (status, created_at) where sender = 'user';
alter table public.messages enable row level security;

create policy "owner reads messages" on public.messages
  for select to authenticated using (public.is_owner());
create policy "owner sends messages" on public.messages
  for insert to authenticated
  with check (public.is_owner() and sender = 'user' and status = 'queued');
create policy "owner cancels queued" on public.messages
  for update to authenticated
  using (public.is_owner() and sender = 'user' and status = 'queued')
  with check (status = 'cancelled');

create table public.agent_state (
  id int primary key default 1 check (id = 1),
  online boolean not null default false,
  activity text,
  machine text,
  session_id text,
  version text,
  last_seen timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.agent_state (id) values (1);
alter table public.agent_state enable row level security;
create policy "owner reads agent state" on public.agent_state
  for select to authenticated using (public.is_owner());

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger messages_touch before update on public.messages
  for each row execute function public.touch_updated_at();
create trigger agent_state_touch before update on public.agent_state
  for each row execute function public.touch_updated_at();

alter table public.messages replica identity full;
alter publication supabase_realtime add table public.messages, public.agent_state;
