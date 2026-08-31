-- Barber SaaS PWA - schema base Supabase/PostgreSQL
-- Execute via Supabase CLI migration or SQL Editor.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.tenant_status as enum ('active', 'expired', 'suspended');
create type public.user_role as enum ('super_admin', 'owner', 'barber');
create type public.appointment_status as enum (
  'pending',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'no_show'
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) >= 2),
  slug text not null check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  logo_url text,
  whatsapp text,
  timezone text not null default 'America/Sao_Paulo',
  operating_hours jsonb not null default
    '{
      "1":[{"open":"09:00","close":"19:00"}],
      "2":[{"open":"09:00","close":"19:00"}],
      "3":[{"open":"09:00","close":"19:00"}],
      "4":[{"open":"09:00","close":"19:00"}],
      "5":[{"open":"09:00","close":"19:00"}],
      "6":[{"open":"09:00","close":"18:00"}],
      "7":[]
    }'::jsonb,
  status public.tenant_status not null default 'active',
  expires_at timestamptz not null default (now() + interval '30 days'),
  monthly_price_cents integer not null default 0 check (monthly_price_cents >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index tenants_slug_uidx on public.tenants (slug);
create index tenants_status_expires_idx on public.tenants (status, expires_at);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  role public.user_role not null,
  full_name text not null,
  phone text,
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_role_tenant_ck check (
    (role = 'super_admin' and tenant_id is null)
    or (role in ('owner', 'barber') and tenant_id is not null)
  ),
  unique (tenant_id, id)
);

create index users_tenant_role_idx on public.users (tenant_id, role) where active;

create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create index services_tenant_active_idx on public.services (tenant_id, active);

create table public.barber_services (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  barber_id uuid not null,
  service_id uuid not null,
  price_override_cents integer check (price_override_cents is null or price_override_cents >= 0),
  duration_override_minutes integer check (
    duration_override_minutes is null or duration_override_minutes between 5 and 720
  ),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (barber_id, service_id),
  foreign key (tenant_id, barber_id)
    references public.users(tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_id)
    references public.services(tenant_id, id) on delete cascade
);

create index barber_services_tenant_barber_idx
  on public.barber_services (tenant_id, barber_id) where active;

create table public.barber_time_off (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  barber_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (tenant_id, barber_id)
    references public.users(tenant_id, id) on delete cascade
);

create index barber_time_off_lookup_idx
  on public.barber_time_off (tenant_id, barber_id, starts_at, ends_at);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  barber_id uuid not null,
  service_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'confirmed',
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  notes text,
  price_cents integer not null check (price_cents >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (tenant_id, barber_id)
    references public.users(tenant_id, id) on delete restrict,
  foreign key (tenant_id, service_id)
    references public.services(tenant_id, id) on delete restrict
);

create index appointments_tenant_start_idx on public.appointments (tenant_id, starts_at);
create index appointments_barber_start_idx on public.appointments (tenant_id, barber_id, starts_at);
create index appointments_status_idx on public.appointments (tenant_id, status, starts_at);

-- Defesa final contra overbooking concorrente.
-- Dois INSERTs simultâneos não podem ocupar o mesmo intervalo do barbeiro.
alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    tenant_id with =,
    barber_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status in ('pending', 'confirmed', 'in_progress'));

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_subscriptions_tenant_user_idx
  on public.push_subscriptions (tenant_id, user_id);

create table public.tenant_subscription_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'renewed', 'suspended', 'unsuspended', 'expired', 'expiry_changed')),
  previous_expires_at timestamptz,
  new_expires_at timestamptz,
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index tenant_subscription_events_idx
  on public.tenant_subscription_events (tenant_id, created_at desc);

-- updated_at genérico
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tenants_set_updated_at before update on public.tenants
for each row execute function public.set_updated_at();
create trigger users_set_updated_at before update on public.users
for each row execute function public.set_updated_at();
create trigger services_set_updated_at before update on public.services
for each row execute function public.set_updated_at();
create trigger barber_services_set_updated_at before update on public.barber_services
for each row execute function public.set_updated_at();
create trigger appointments_set_updated_at before update on public.appointments
for each row execute function public.set_updated_at();
create trigger push_subscriptions_set_updated_at before update on public.push_subscriptions
for each row execute function public.set_updated_at();

-- Helpers RLS. SECURITY DEFINER evita recursão ao consultar public.users dentro de políticas de public.users.
create or replace function public.current_app_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.role
  from public.users u
  where u.id = (select auth.uid()) and u.active
  limit 1;
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.tenant_id
  from public.users u
  where u.id = (select auth.uid()) and u.active
  limit 1;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_app_role() = 'super_admin', false);
$$;

create or replace function public.is_owner_of(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.current_app_role() = 'owner'
    and public.current_tenant_id() = p_tenant_id,
    false
  );
$$;

create or replace function public.is_member_of(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_tenant_id() = p_tenant_id, false);
$$;

create or replace function public.tenant_is_active(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and t.status = 'active'
      and t.expires_at > now()
  );
$$;

revoke all on function public.current_app_role() from public;
revoke all on function public.current_tenant_id() from public;
revoke all on function public.is_super_admin() from public;
revoke all on function public.is_owner_of(uuid) from public;
revoke all on function public.is_member_of(uuid) from public;
revoke all on function public.tenant_is_active(uuid) from public;

grant execute on function public.current_app_role() to authenticated;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_owner_of(uuid) to authenticated;
grant execute on function public.is_member_of(uuid) to authenticated;
grant execute on function public.tenant_is_active(uuid) to authenticated;

-- RPC mínima usada pelo Proxy para bloquear link público vencido sem expor a tabela tenants.
create or replace function public.get_public_tenant_state(p_slug text)
returns table (
  id uuid,
  name text,
  slug text,
  logo_url text,
  status public.tenant_status,
  expires_at timestamptz,
  is_available boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    t.id,
    t.name,
    t.slug,
    t.logo_url,
    t.status,
    t.expires_at,
    (t.status = 'active' and t.expires_at > now()) as is_available
  from public.tenants t
  where t.slug = lower(trim(p_slug))
  limit 1;
$$;

revoke all on function public.get_public_tenant_state(text) from public;
grant execute on function public.get_public_tenant_state(text) to anon, authenticated;

-- Expiração idempotente. Segurança do app ainda checa expires_at em tempo real.
create or replace function public.expire_due_tenants()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  with expired as (
    update public.tenants
      set status = 'expired'
    where status = 'active'
      and expires_at <= now()
    returning id, expires_at
  ), logged as (
    insert into public.tenant_subscription_events (
      tenant_id, event_type, previous_expires_at, new_expires_at, metadata
    )
    select id, 'expired', expires_at, expires_at, '{"source":"cron"}'::jsonb
    from expired
    returning 1
  )
  select count(*) into affected from logged;

  return affected;
end;
$$;

revoke all on function public.expire_due_tenants() from public, anon, authenticated;

-- =========================
-- RLS + privilégios mínimos
-- =========================
alter table public.tenants enable row level security;
alter table public.users enable row level security;
alter table public.services enable row level security;
alter table public.barber_services enable row level security;
alter table public.barber_time_off enable row level security;
alter table public.appointments enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.tenant_subscription_events enable row level security;

revoke all on table public.tenants from anon, authenticated;
revoke all on table public.users from anon, authenticated;
revoke all on table public.services from anon, authenticated;
revoke all on table public.barber_services from anon, authenticated;
revoke all on table public.barber_time_off from anon, authenticated;
revoke all on table public.appointments from anon, authenticated;
revoke all on table public.push_subscriptions from anon, authenticated;
revoke all on table public.tenant_subscription_events from anon, authenticated;

-- Tenant: membros leem. Dono só edita dados operacionais, nunca billing/status.
grant select on public.tenants to authenticated;
grant update (name, logo_url, whatsapp, timezone, operating_hours) on public.tenants to authenticated;

create policy tenants_select on public.tenants
for select to authenticated
using (public.is_super_admin() or id = public.current_tenant_id());

create policy tenants_update on public.tenants
for update to authenticated
using (public.is_super_admin() or (public.is_owner_of(id) and public.tenant_is_active(id)))
with check (public.is_super_admin() or (public.is_owner_of(id) and public.tenant_is_active(id)));

-- Perfis: Super Admin vê tudo; dono vê sua equipe; barbeiro vê somente a si.
grant select on public.users to authenticated;
grant update (full_name, phone) on public.users to authenticated;

create policy users_select on public.users
for select to authenticated
using (
  public.is_super_admin()
  or id = (select auth.uid())
  or (
    public.current_app_role() = 'owner'
    and tenant_id = public.current_tenant_id()
    and public.tenant_is_active(tenant_id)
  )
);

create policy users_update_profile on public.users
for update to authenticated
using (
  public.is_super_admin()
  or (
    public.tenant_is_active(tenant_id)
    and (id = (select auth.uid()) or (public.current_app_role() = 'owner' and tenant_id = public.current_tenant_id()))
  )
)
with check (
  public.is_super_admin()
  or (
    public.tenant_is_active(tenant_id)
    and (id = (select auth.uid()) or (public.current_app_role() = 'owner' and tenant_id = public.current_tenant_id()))
  )
);

-- Serviços: membros leem; dono gerencia enquanto assinatura estiver ativa.
grant select, insert, update, delete on public.services to authenticated;

create policy services_select on public.services
for select to authenticated
using (public.is_super_admin() or (public.is_member_of(tenant_id) and public.tenant_is_active(tenant_id)));

create policy services_insert on public.services
for insert to authenticated
with check (
  public.is_super_admin()
  or (public.is_owner_of(tenant_id) and public.tenant_is_active(tenant_id))
);

create policy services_update on public.services
for update to authenticated
using (
  public.is_super_admin()
  or (public.is_owner_of(tenant_id) and public.tenant_is_active(tenant_id))
)
with check (
  public.is_super_admin()
  or (public.is_owner_of(tenant_id) and public.tenant_is_active(tenant_id))
);

create policy services_delete on public.services
for delete to authenticated
using (
  public.is_super_admin()
  or (public.is_owner_of(tenant_id) and public.tenant_is_active(tenant_id))
);

-- Serviços por barbeiro
grant select, insert, update, delete on public.barber_services to authenticated;

create policy barber_services_select on public.barber_services
for select to authenticated
using (public.is_super_admin() or (public.is_member_of(tenant_id) and public.tenant_is_active(tenant_id)));

create policy barber_services_insert on public.barber_services
for insert to authenticated
with check (
  public.is_super_admin()
  or (public.is_owner_of(tenant_id) and public.tenant_is_active(tenant_id))
);

create policy barber_services_update on public.barber_services
for update to authenticated
using (
  public.is_super_admin()
  or (public.is_owner_of(tenant_id) and public.tenant_is_active(tenant_id))
)
with check (
  public.is_super_admin()
  or (public.is_owner_of(tenant_id) and public.tenant_is_active(tenant_id))
);

create policy barber_services_delete on public.barber_services
for delete to authenticated
using (
  public.is_super_admin()
  or (public.is_owner_of(tenant_id) and public.tenant_is_active(tenant_id))
);

-- Folgas/bloqueios de agenda
grant select, insert, update, delete on public.barber_time_off to authenticated;

create policy time_off_select on public.barber_time_off
for select to authenticated
using (public.is_super_admin() or (public.is_member_of(tenant_id) and public.tenant_is_active(tenant_id)));

create policy time_off_insert on public.barber_time_off
for insert to authenticated
with check (
  public.is_super_admin()
  or (
    public.tenant_is_active(tenant_id)
    and public.is_member_of(tenant_id)
    and (public.current_app_role() = 'owner' or barber_id = (select auth.uid()))
  )
);

create policy time_off_update on public.barber_time_off
for update to authenticated
using (
  public.is_super_admin()
  or (public.is_member_of(tenant_id) and (public.current_app_role() = 'owner' or barber_id = (select auth.uid())))
)
with check (
  public.is_super_admin()
  or (
    public.tenant_is_active(tenant_id)
    and public.is_member_of(tenant_id)
    and (public.current_app_role() = 'owner' or barber_id = (select auth.uid()))
  )
);

create policy time_off_delete on public.barber_time_off
for delete to authenticated
using (
  public.is_super_admin()
  or (public.is_member_of(tenant_id) and (public.current_app_role() = 'owner' or barber_id = (select auth.uid())))
);

-- Agendamentos
grant select, insert, update, delete on public.appointments to authenticated;

create policy appointments_select on public.appointments
for select to authenticated
using (public.is_super_admin() or (public.is_member_of(tenant_id) and public.tenant_is_active(tenant_id)));

create policy appointments_insert on public.appointments
for insert to authenticated
with check (
  public.is_super_admin()
  or (
    public.tenant_is_active(tenant_id)
    and public.is_member_of(tenant_id)
    and (public.current_app_role() = 'owner' or barber_id = (select auth.uid()))
  )
);

create policy appointments_update on public.appointments
for update to authenticated
using (
  public.is_super_admin()
  or (
    public.is_member_of(tenant_id)
    and (public.current_app_role() = 'owner' or barber_id = (select auth.uid()))
  )
)
with check (
  public.is_super_admin()
  or (
    public.tenant_is_active(tenant_id)
    and public.is_member_of(tenant_id)
    and (public.current_app_role() = 'owner' or barber_id = (select auth.uid()))
  )
);

create policy appointments_delete on public.appointments
for delete to authenticated
using (
  public.is_super_admin()
  or (public.is_owner_of(tenant_id) and public.tenant_is_active(tenant_id))
);

-- Push subscription por usuário
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create policy push_select on public.push_subscriptions
for select to authenticated
using (public.is_super_admin() or user_id = (select auth.uid()));

create policy push_insert on public.push_subscriptions
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and tenant_id = public.current_tenant_id()
  and public.tenant_is_active(tenant_id)
);

create policy push_update on public.push_subscriptions
for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and tenant_id = public.current_tenant_id()
);

create policy push_delete on public.push_subscriptions
for delete to authenticated
using (user_id = (select auth.uid()));

-- Histórico de assinatura só Super Admin.
grant select on public.tenant_subscription_events to authenticated;
create policy subscription_events_select on public.tenant_subscription_events
for select to authenticated
using (public.is_super_admin());

-- Nota: INSERT/UPDATE administrativo em tenants/users/eventos é feito no servidor
-- com SUPABASE_SERVICE_ROLE_KEY após validar que o chamador é super_admin/owner.
