-- Na Régua 1.1.28
-- Produtos + comandas do barbeiro

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) >= 2),
  price_cents integer not null check (price_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create index if not exists products_tenant_active_idx
  on public.products (tenant_id, active, name);

create table if not exists public.commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  barber_id uuid not null,
  number integer,
  customer_name text,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, number),
  foreign key (tenant_id, barber_id)
    references public.users(tenant_id, id) on delete cascade
);

create index if not exists commands_tenant_barber_status_idx
  on public.commands (tenant_id, barber_id, status, created_at desc);

-- Numeração sequencial independente para cada barbearia.
create or replace function public.set_command_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.number is null then
    perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text, 0));
    select coalesce(max(c.number), 0) + 1
      into new.number
    from public.commands c
    where c.tenant_id = new.tenant_id;
  end if;
  return new;
end;
$$;

revoke all on function public.set_command_number() from public;

DROP TRIGGER IF EXISTS commands_set_number ON public.commands;
create trigger commands_set_number
before insert on public.commands
for each row execute function public.set_command_number();

create table if not exists public.command_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  command_id uuid not null,
  product_id uuid not null,
  quantity integer not null default 1 check (quantity > 0 and quantity <= 999),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (command_id, product_id),
  foreign key (tenant_id, command_id)
    references public.commands(tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id)
    references public.products(tenant_id, id) on delete restrict
);

create index if not exists command_items_command_idx
  on public.command_items (tenant_id, command_id);

-- updated_at
DROP TRIGGER IF EXISTS products_set_updated_at ON public.products;
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();

DROP TRIGGER IF EXISTS commands_set_updated_at ON public.commands;
create trigger commands_set_updated_at before update on public.commands
for each row execute function public.set_updated_at();

DROP TRIGGER IF EXISTS command_items_set_updated_at ON public.command_items;
create trigger command_items_set_updated_at before update on public.command_items
for each row execute function public.set_updated_at();

-- Helper seguro para as políticas de itens da comanda.
create or replace function public.can_access_command(p_command_id uuid, p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.is_super_admin()
    or (
      public.tenant_is_active(p_tenant_id)
      and public.current_tenant_id() = p_tenant_id
      and exists (
        select 1
        from public.commands c
        where c.id = p_command_id
          and c.tenant_id = p_tenant_id
          and (
            public.current_app_role() = 'owner'
            or c.barber_id = (select auth.uid())
          )
      )
    ),
    false
  );
$$;

revoke all on function public.can_access_command(uuid, uuid) from public;
grant execute on function public.can_access_command(uuid, uuid) to authenticated;

alter table public.products enable row level security;
alter table public.commands enable row level security;
alter table public.command_items enable row level security;

revoke all on table public.products from anon, authenticated;
revoke all on table public.commands from anon, authenticated;
revoke all on table public.command_items from anon, authenticated;

grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.commands to authenticated;
grant select, insert, update, delete on public.command_items to authenticated;

-- Produtos: todos os membros ativos leem; somente dono gerencia.
DROP POLICY IF EXISTS products_select ON public.products;
create policy products_select on public.products
for select to authenticated
using (
  public.is_super_admin()
  or (public.is_member_of(tenant_id) and public.tenant_is_active(tenant_id))
);

DROP POLICY IF EXISTS products_insert ON public.products;
create policy products_insert on public.products
for insert to authenticated
with check (
  public.is_super_admin()
  or (public.is_owner_of(tenant_id) and public.tenant_is_active(tenant_id))
);

DROP POLICY IF EXISTS products_update ON public.products;
create policy products_update on public.products
for update to authenticated
using (
  public.is_super_admin()
  or (public.is_owner_of(tenant_id) and public.tenant_is_active(tenant_id))
)
with check (
  public.is_super_admin()
  or (public.is_owner_of(tenant_id) and public.tenant_is_active(tenant_id))
);

DROP POLICY IF EXISTS products_delete ON public.products;
create policy products_delete on public.products
for delete to authenticated
using (
  public.is_super_admin()
  or (public.is_owner_of(tenant_id) and public.tenant_is_active(tenant_id))
);

-- Comandas: dono acessa todas; barbeiro acessa somente as próprias.
DROP POLICY IF EXISTS commands_select ON public.commands;
create policy commands_select on public.commands
for select to authenticated
using (
  public.is_super_admin()
  or (
    public.is_member_of(tenant_id)
    and public.tenant_is_active(tenant_id)
    and (public.current_app_role() = 'owner' or barber_id = (select auth.uid()))
  )
);

DROP POLICY IF EXISTS commands_insert ON public.commands;
create policy commands_insert on public.commands
for insert to authenticated
with check (
  public.is_super_admin()
  or (
    public.is_member_of(tenant_id)
    and public.tenant_is_active(tenant_id)
    and (public.current_app_role() = 'owner' or barber_id = (select auth.uid()))
  )
);

DROP POLICY IF EXISTS commands_update ON public.commands;
create policy commands_update on public.commands
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
    public.is_member_of(tenant_id)
    and public.tenant_is_active(tenant_id)
    and (public.current_app_role() = 'owner' or barber_id = (select auth.uid()))
  )
);

DROP POLICY IF EXISTS commands_delete ON public.commands;
create policy commands_delete on public.commands
for delete to authenticated
using (
  public.is_super_admin()
  or (
    public.is_member_of(tenant_id)
    and public.tenant_is_active(tenant_id)
    and (public.current_app_role() = 'owner' or barber_id = (select auth.uid()))
  )
);

-- Itens seguem a permissão da comanda.
DROP POLICY IF EXISTS command_items_select ON public.command_items;
create policy command_items_select on public.command_items
for select to authenticated
using (public.can_access_command(command_id, tenant_id));

DROP POLICY IF EXISTS command_items_insert ON public.command_items;
create policy command_items_insert on public.command_items
for insert to authenticated
with check (public.can_access_command(command_id, tenant_id));

DROP POLICY IF EXISTS command_items_update ON public.command_items;
create policy command_items_update on public.command_items
for update to authenticated
using (public.can_access_command(command_id, tenant_id))
with check (public.can_access_command(command_id, tenant_id));

DROP POLICY IF EXISTS command_items_delete ON public.command_items;
create policy command_items_delete on public.command_items
for delete to authenticated
using (public.can_access_command(command_id, tenant_id));
