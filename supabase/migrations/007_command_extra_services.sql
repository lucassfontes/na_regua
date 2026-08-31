-- Na Régua 1.1.34
-- Permite adicionar serviços extras à comanda do cliente.

create table if not exists public.command_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  command_id uuid not null,
  service_id uuid not null,
  quantity integer not null default 1 check (quantity > 0 and quantity <= 99),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (command_id, service_id),
  foreign key (tenant_id, command_id)
    references public.commands(tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_id)
    references public.services(tenant_id, id) on delete restrict
);

create index if not exists command_services_command_idx
  on public.command_services (tenant_id, command_id);

DROP TRIGGER IF EXISTS command_services_set_updated_at ON public.command_services;
create trigger command_services_set_updated_at before update on public.command_services
for each row execute function public.set_updated_at();

alter table public.command_services enable row level security;

revoke all on table public.command_services from anon, authenticated;
grant select, insert, update, delete on public.command_services to authenticated;

DROP POLICY IF EXISTS command_services_select ON public.command_services;
create policy command_services_select on public.command_services
for select to authenticated
using (public.can_access_command(command_id, tenant_id));

DROP POLICY IF EXISTS command_services_insert ON public.command_services;
create policy command_services_insert on public.command_services
for insert to authenticated
with check (
  public.can_access_command(command_id, tenant_id)
  and exists (
    select 1
    from public.barber_services bs
    join public.commands c
      on c.id = command_services.command_id
     and c.tenant_id = command_services.tenant_id
    join public.services s
      on s.id = command_services.service_id
     and s.tenant_id = command_services.tenant_id
    where bs.tenant_id = command_services.tenant_id
      and bs.barber_id = c.barber_id
      and bs.service_id = command_services.service_id
      and bs.active = true
      and s.active = true
  )
);

DROP POLICY IF EXISTS command_services_update ON public.command_services;
create policy command_services_update on public.command_services
for update to authenticated
using (public.can_access_command(command_id, tenant_id))
with check (
  public.can_access_command(command_id, tenant_id)
  and exists (
    select 1
    from public.barber_services bs
    join public.commands c
      on c.id = command_services.command_id
     and c.tenant_id = command_services.tenant_id
    join public.services s
      on s.id = command_services.service_id
     and s.tenant_id = command_services.tenant_id
    where bs.tenant_id = command_services.tenant_id
      and bs.barber_id = c.barber_id
      and bs.service_id = command_services.service_id
      and bs.active = true
      and s.active = true
  )
);

DROP POLICY IF EXISTS command_services_delete ON public.command_services;
create policy command_services_delete on public.command_services
for delete to authenticated
using (public.can_access_command(command_id, tenant_id));
