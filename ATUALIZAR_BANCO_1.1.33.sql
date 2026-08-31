-- Na Régua 1.1.33
-- Correção: produtos cadastrados pelo dono devem aparecer na comanda do barbeiro.

alter table public.products enable row level security;
grant select on table public.products to authenticated;

DROP POLICY IF EXISTS products_select ON public.products;
create policy products_select on public.products
for select to authenticated
using (
  public.is_super_admin()
  or (
    public.current_tenant_id() = tenant_id
    and public.tenant_is_active(tenant_id)
  )
);

-- Leitura segura usada como fallback pelo painel do barbeiro.
create or replace function public.barber_active_products()
returns table (
  id uuid,
  name text,
  price_cents integer,
  active boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.name, p.price_cents, p.active
  from public.products p
  where p.tenant_id = public.current_tenant_id()
    and p.active = true
    and public.tenant_is_active(p.tenant_id)
    and public.current_app_role() in ('owner', 'barber')
  order by p.name;
$$;

revoke all on function public.barber_active_products() from public;
grant execute on function public.barber_active_products() to authenticated;
