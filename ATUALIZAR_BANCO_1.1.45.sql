-- Na Régua 1.1.45
-- Controle completo de estoque de produtos.
-- Adiciona saldo, estoque mínimo, histórico de movimentações e baixa automática nas comandas.

alter table public.products
  add column if not exists stock_quantity integer not null default 0 check (stock_quantity >= 0),
  add column if not exists min_stock_quantity integer not null default 0 check (min_stock_quantity >= 0);

comment on column public.products.stock_quantity is 'Quantidade atual disponível em estoque';
comment on column public.products.min_stock_quantity is 'Quantidade mínima desejada para alerta de estoque baixo';

-- Produtos vendidos antes da instalação desta versão não devem alterar o saldo atual.
alter table public.command_items
  add column if not exists stock_applied_quantity integer;

update public.command_items
set stock_applied_quantity = 0
where stock_applied_quantity is null;

alter table public.command_items
  alter column stock_applied_quantity set default 0,
  alter column stock_applied_quantity set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'command_items_stock_applied_quantity_check'
      and conrelid = 'public.command_items'::regclass
  ) then
    alter table public.command_items
      add constraint command_items_stock_applied_quantity_check
      check (stock_applied_quantity >= 0 and stock_applied_quantity <= quantity);
  end if;
end $$;

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  command_id uuid references public.commands(id) on delete set null,
  movement_type text not null check (movement_type in ('initial','entry','exit','adjustment','sale','return')),
  quantity_delta integer not null check (quantity_delta <> 0),
  balance_after integer not null check (balance_after >= 0),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, product_id)
    references public.products(tenant_id, id) on delete cascade
);

create index if not exists stock_movements_product_idx
  on public.stock_movements (tenant_id, product_id, created_at desc);
create index if not exists stock_movements_command_idx
  on public.stock_movements (tenant_id, command_id)
  where command_id is not null;

alter table public.stock_movements enable row level security;
revoke all on table public.stock_movements from anon, authenticated;
grant select on table public.stock_movements to authenticated;

DROP POLICY IF EXISTS stock_movements_select ON public.stock_movements;
create policy stock_movements_select on public.stock_movements
for select to authenticated
using (
  public.is_super_admin()
  or (public.is_owner_of(tenant_id) and public.tenant_is_active(tenant_id))
);

-- Registra o saldo inicial quando um produto novo já é criado com estoque.
create or replace function public.log_initial_product_stock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.stock_quantity,0) > 0 then
    insert into public.stock_movements(
      tenant_id, product_id, movement_type, quantity_delta, balance_after, note, created_by
    ) values (
      new.tenant_id, new.id, 'initial', new.stock_quantity, new.stock_quantity,
      'Estoque inicial do produto', auth.uid()
    );
  end if;
  return new;
end;
$$;

revoke all on function public.log_initial_product_stock() from public;
DROP TRIGGER IF EXISTS products_log_initial_stock ON public.products;
create trigger products_log_initial_stock
after insert on public.products
for each row execute function public.log_initial_product_stock();

-- Ajuste manual feito pelo dono: entrada, saída ou definição do saldo contado fisicamente.
create or replace function public.adjust_product_stock(
  p_product_id uuid,
  p_operation text,
  p_quantity integer,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_current integer;
  v_new integer;
  v_delta integer;
  v_type text;
begin
  if p_operation not in ('in','out','set') then
    raise exception 'Tipo de movimentação inválido.';
  end if;
  if p_quantity is null or p_quantity < 0 or (p_operation in ('in','out') and p_quantity < 1) then
    raise exception 'Quantidade inválida.';
  end if;

  select p.tenant_id, p.stock_quantity
    into v_tenant_id, v_current
  from public.products p
  where p.id = p_product_id
  for update;

  if not found then raise exception 'Produto não encontrado.'; end if;
  if not (public.is_super_admin() or public.is_owner_of(v_tenant_id)) then
    raise exception 'Sem permissão para movimentar este estoque.';
  end if;
  if not public.tenant_is_active(v_tenant_id) and not public.is_super_admin() then
    raise exception 'A barbearia está com o acesso indisponível.';
  end if;

  if p_operation = 'in' then
    v_delta := p_quantity;
    v_type := 'entry';
  elsif p_operation = 'out' then
    v_delta := -p_quantity;
    v_type := 'exit';
  else
    v_delta := p_quantity - v_current;
    v_type := 'adjustment';
  end if;

  v_new := v_current + v_delta;
  if v_new < 0 then
    raise exception 'Estoque insuficiente. Saldo atual: % unidade(s).', v_current;
  end if;
  if v_delta = 0 then return v_current; end if;

  update public.products
  set stock_quantity = v_new
  where id = p_product_id and tenant_id = v_tenant_id;

  insert into public.stock_movements(
    tenant_id, product_id, movement_type, quantity_delta, balance_after, note, created_by
  ) values (
    v_tenant_id, p_product_id, v_type, v_delta, v_new,
    nullif(trim(coalesce(p_note,'')),''), auth.uid()
  );

  return v_new;
end;
$$;

revoke all on function public.adjust_product_stock(uuid,text,integer,text) from public;
grant execute on function public.adjust_product_stock(uuid,text,integer,text) to authenticated;

-- Baixa e devolução automáticas do estoque conforme itens são adicionados/removidos da comanda.
create or replace function public.sync_command_item_stock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stock integer;
  v_delta integer;
  v_restore integer;
  v_applied integer;
begin
  if tg_op = 'INSERT' then
    select p.stock_quantity into v_stock
    from public.products p
    where p.id = new.product_id and p.tenant_id = new.tenant_id
    for update;
    if not found then raise exception 'Produto não encontrado no estoque.'; end if;
    if v_stock < new.quantity then
      raise exception 'Estoque insuficiente. Disponível: % unidade(s).', v_stock;
    end if;

    update public.products
    set stock_quantity = stock_quantity - new.quantity
    where id = new.product_id and tenant_id = new.tenant_id;

    new.stock_applied_quantity := new.quantity;
    insert into public.stock_movements(
      tenant_id, product_id, command_id, movement_type, quantity_delta, balance_after, note, created_by
    ) values (
      new.tenant_id, new.product_id, new.command_id, 'sale', -new.quantity, v_stock-new.quantity,
      'Produto lançado na comanda', auth.uid()
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.tenant_id <> old.tenant_id then
      raise exception 'Não é permitido mover item de comanda entre barbearias.';
    end if;

    if new.product_id <> old.product_id then
      if old.stock_applied_quantity > 0 then
        select p.stock_quantity into v_stock from public.products p
        where p.id=old.product_id and p.tenant_id=old.tenant_id for update;
        update public.products set stock_quantity=stock_quantity+old.stock_applied_quantity
        where id=old.product_id and tenant_id=old.tenant_id;
        insert into public.stock_movements(tenant_id,product_id,command_id,movement_type,quantity_delta,balance_after,note,created_by)
        values(old.tenant_id,old.product_id,old.command_id,'return',old.stock_applied_quantity,v_stock+old.stock_applied_quantity,'Produto substituído na comanda',auth.uid());
      end if;
      select p.stock_quantity into v_stock from public.products p
      where p.id=new.product_id and p.tenant_id=new.tenant_id for update;
      if not found then raise exception 'Produto não encontrado no estoque.'; end if;
      if v_stock < new.quantity then raise exception 'Estoque insuficiente. Disponível: % unidade(s).',v_stock; end if;
      update public.products set stock_quantity=stock_quantity-new.quantity
      where id=new.product_id and tenant_id=new.tenant_id;
      new.stock_applied_quantity:=new.quantity;
      insert into public.stock_movements(tenant_id,product_id,command_id,movement_type,quantity_delta,balance_after,note,created_by)
      values(new.tenant_id,new.product_id,new.command_id,'sale',-new.quantity,v_stock-new.quantity,'Produto substituído na comanda',auth.uid());
      return new;
    end if;

    v_delta := new.quantity - old.quantity;
    v_applied := coalesce(old.stock_applied_quantity,0);
    if v_delta > 0 then
      select p.stock_quantity into v_stock from public.products p
      where p.id=new.product_id and p.tenant_id=new.tenant_id for update;
      if v_stock < v_delta then raise exception 'Estoque insuficiente. Disponível: % unidade(s).',v_stock; end if;
      update public.products set stock_quantity=stock_quantity-v_delta
      where id=new.product_id and tenant_id=new.tenant_id;
      new.stock_applied_quantity:=v_applied+v_delta;
      insert into public.stock_movements(tenant_id,product_id,command_id,movement_type,quantity_delta,balance_after,note,created_by)
      values(new.tenant_id,new.product_id,new.command_id,'sale',-v_delta,v_stock-v_delta,'Quantidade adicionada à comanda',auth.uid());
    elsif v_delta < 0 then
      v_restore := least(-v_delta,v_applied);
      new.stock_applied_quantity:=v_applied-v_restore;
      if v_restore > 0 then
        select p.stock_quantity into v_stock from public.products p
        where p.id=new.product_id and p.tenant_id=new.tenant_id for update;
        update public.products set stock_quantity=stock_quantity+v_restore
        where id=new.product_id and tenant_id=new.tenant_id;
        insert into public.stock_movements(tenant_id,product_id,command_id,movement_type,quantity_delta,balance_after,note,created_by)
        values(new.tenant_id,new.product_id,new.command_id,'return',v_restore,v_stock+v_restore,'Quantidade removida da comanda',auth.uid());
      end if;
    else
      new.stock_applied_quantity:=v_applied;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_restore := coalesce(old.stock_applied_quantity,0);
    if v_restore > 0 then
      select p.stock_quantity into v_stock from public.products p
      where p.id=old.product_id and p.tenant_id=old.tenant_id for update;
      if found then
        update public.products set stock_quantity=stock_quantity+v_restore
        where id=old.product_id and tenant_id=old.tenant_id;
        insert into public.stock_movements(tenant_id,product_id,command_id,movement_type,quantity_delta,balance_after,note,created_by)
        values(old.tenant_id,old.product_id,old.command_id,'return',v_restore,v_stock+v_restore,'Produto removido da comanda',auth.uid());
      end if;
    end if;
    return old;
  end if;

  return null;
end;
$$;

revoke all on function public.sync_command_item_stock() from public;
DROP TRIGGER IF EXISTS command_items_stock_sync ON public.command_items;
create trigger command_items_stock_sync
before insert or update or delete on public.command_items
for each row execute function public.sync_command_item_stock();

-- Atualiza o fallback usado pelo painel do barbeiro para também informar o saldo.
drop function if exists public.barber_active_products();
create function public.barber_active_products()
returns table (
  id uuid,
  name text,
  price_cents integer,
  stock_quantity integer,
  active boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.name, p.price_cents, p.stock_quantity, p.active
  from public.products p
  where p.tenant_id = public.current_tenant_id()
    and p.active = true
    and public.tenant_is_active(p.tenant_id)
    and public.current_app_role() in ('owner', 'barber')
  order by p.name;
$$;

revoke all on function public.barber_active_products() from public;
grant execute on function public.barber_active_products() to authenticated;
