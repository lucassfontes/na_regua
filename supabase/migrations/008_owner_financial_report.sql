-- Na Régua 1.1.41
-- Financeiro completo do painel do dono.
-- Salva o fechamento financeiro da comanda e disponibiliza um relatório seguro por período.

alter table public.commands
  add column if not exists service_total_cents bigint,
  add column if not exists product_total_cents bigint,
  add column if not exists gross_total_cents bigint,
  add column if not exists commission_pct_snapshot numeric(5,2),
  add column if not exists commission_cents bigint,
  add column if not exists shop_net_cents bigint;

create or replace function public.capture_command_financials()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_main_service bigint := 0;
  v_extra_services bigint := 0;
  v_products bigint := 0;
  v_commission_pct numeric(5,2) := 0;
  v_service_total bigint := 0;
  v_gross_total bigint := 0;
  v_commission bigint := 0;
  v_should_capture boolean := false;
begin
  if new.status = 'closed' then
    if tg_op = 'INSERT' then
      v_should_capture := true;
    elsif old.status is distinct from 'closed' or new.commission_cents is null then
      v_should_capture := true;
    end if;
  end if;

  if v_should_capture then

    if new.appointment_id is not null then
      select coalesce(a.price_cents, 0)::bigint
        into v_main_service
      from public.appointments a
      where a.id = new.appointment_id
        and a.tenant_id = new.tenant_id;
    end if;

    select coalesce(sum(cs.quantity::bigint * cs.unit_price_cents::bigint), 0)
      into v_extra_services
    from public.command_services cs
    where cs.tenant_id = new.tenant_id
      and cs.command_id = new.id;

    select coalesce(sum(ci.quantity::bigint * ci.unit_price_cents::bigint), 0)
      into v_products
    from public.command_items ci
    where ci.tenant_id = new.tenant_id
      and ci.command_id = new.id;

    select coalesce(u.commission_pct, 0)
      into v_commission_pct
    from public.users u
    where u.id = new.barber_id
      and u.tenant_id = new.tenant_id
    limit 1;

    v_service_total := coalesce(v_main_service, 0) + coalesce(v_extra_services, 0);
    v_gross_total := v_service_total + coalesce(v_products, 0);
    v_commission := round(v_service_total::numeric * coalesce(v_commission_pct, 0) / 100)::bigint;

    new.service_total_cents := v_service_total;
    new.product_total_cents := coalesce(v_products, 0);
    new.gross_total_cents := v_gross_total;
    new.commission_pct_snapshot := coalesce(v_commission_pct, 0);
    new.commission_cents := v_commission;
    new.shop_net_cents := v_gross_total - v_commission;
  end if;

  return new;
end;
$$;

revoke all on function public.capture_command_financials() from public;

DROP TRIGGER IF EXISTS commands_capture_financials ON public.commands;
create trigger commands_capture_financials
before insert or update on public.commands
for each row execute function public.capture_command_financials();

-- Preenche os fechamentos antigos que ainda não possuem fotografia financeira.
-- O UPDATE de status dispara o trigger acima sem mudar o estado da comanda.
update public.commands
set status = status
where status = 'closed'
  and commission_cents is null;

create or replace function public.owner_financial_report(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  entry_id uuid,
  command_id uuid,
  command_number integer,
  appointment_id uuid,
  barber_id uuid,
  barber_name text,
  commission_pct numeric,
  customer_name text,
  occurred_at timestamptz,
  service_revenue_cents bigint,
  product_revenue_cents bigint,
  gross_revenue_cents bigint,
  barber_commission_cents bigint,
  shop_net_cents bigint,
  service_details jsonb,
  product_details jsonb,
  source_type text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with ctx as (
  select public.current_tenant_id() as tenant_id,
         public.current_app_role() as app_role
),
command_rows as (
  select
    c.id as entry_id,
    c.id as command_id,
    c.number as command_number,
    c.appointment_id,
    c.barber_id,
    coalesce(u.full_name, 'Barbeiro')::text as barber_name,
    coalesce(c.commission_pct_snapshot, u.commission_pct, 0)::numeric as commission_pct,
    coalesce(a.customer_name, c.customer_name, 'Cliente')::text as customer_name,
    coalesce(c.closed_at, c.updated_at, c.created_at) as occurred_at,
    coalesce(c.service_total_cents, coalesce(a.price_cents, 0)::bigint + coalesce(es.total_cents, 0))::bigint as service_revenue_cents,
    coalesce(c.product_total_cents, coalesce(pi.total_cents, 0))::bigint as product_revenue_cents,
    coalesce(
      c.gross_total_cents,
      coalesce(a.price_cents, 0)::bigint + coalesce(es.total_cents, 0) + coalesce(pi.total_cents, 0)
    )::bigint as gross_revenue_cents,
    coalesce(
      c.commission_cents,
      round((coalesce(a.price_cents, 0)::bigint + coalesce(es.total_cents, 0))::numeric * coalesce(u.commission_pct, 0) / 100)::bigint
    )::bigint as barber_commission_cents,
    coalesce(
      c.shop_net_cents,
      (coalesce(a.price_cents, 0)::bigint + coalesce(es.total_cents, 0) + coalesce(pi.total_cents, 0))
      - round((coalesce(a.price_cents, 0)::bigint + coalesce(es.total_cents, 0))::numeric * coalesce(u.commission_pct, 0) / 100)::bigint
    )::bigint as shop_net_cents,
    (
      case when a.id is not null then
        jsonb_build_array(jsonb_build_object(
          'name', coalesce(s.name, 'Serviço'),
          'quantity', 1,
          'unit_price_cents', coalesce(a.price_cents, 0),
          'subtotal_cents', coalesce(a.price_cents, 0),
          'kind', 'scheduled'
        ))
      else '[]'::jsonb end
      || coalesce(es.details, '[]'::jsonb)
    ) as service_details,
    coalesce(pi.details, '[]'::jsonb) as product_details,
    'command'::text as source_type
  from ctx
  join public.commands c on c.tenant_id = ctx.tenant_id
  left join public.users u
    on u.id = c.barber_id and u.tenant_id = c.tenant_id
  left join public.appointments a
    on a.id = c.appointment_id and a.tenant_id = c.tenant_id
  left join public.services s
    on s.id = a.service_id and s.tenant_id = a.tenant_id
  left join lateral (
    select
      coalesce(sum(cs.quantity::bigint * cs.unit_price_cents::bigint), 0)::bigint as total_cents,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'name', coalesce(sx.name, 'Serviço adicional'),
            'quantity', cs.quantity,
            'unit_price_cents', cs.unit_price_cents,
            'subtotal_cents', cs.quantity::bigint * cs.unit_price_cents::bigint,
            'kind', 'extra'
          ) order by cs.created_at
        ),
        '[]'::jsonb
      ) as details
    from public.command_services cs
    left join public.services sx
      on sx.id = cs.service_id and sx.tenant_id = cs.tenant_id
    where cs.tenant_id = c.tenant_id
      and cs.command_id = c.id
  ) es on true
  left join lateral (
    select
      coalesce(sum(ci.quantity::bigint * ci.unit_price_cents::bigint), 0)::bigint as total_cents,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'name', coalesce(p.name, 'Produto'),
            'quantity', ci.quantity,
            'unit_price_cents', ci.unit_price_cents,
            'subtotal_cents', ci.quantity::bigint * ci.unit_price_cents::bigint
          ) order by ci.created_at
        ),
        '[]'::jsonb
      ) as details
    from public.command_items ci
    left join public.products p
      on p.id = ci.product_id and p.tenant_id = ci.tenant_id
    where ci.tenant_id = c.tenant_id
      and ci.command_id = c.id
  ) pi on true
  where ctx.app_role = 'owner'
    and c.status = 'closed'
    and coalesce(c.closed_at, c.updated_at, c.created_at) >= p_from
    and coalesce(c.closed_at, c.updated_at, c.created_at) < p_to
),
legacy_rows as (
  select
    a.id as entry_id,
    null::uuid as command_id,
    null::integer as command_number,
    a.id as appointment_id,
    a.barber_id,
    coalesce(u.full_name, 'Barbeiro')::text as barber_name,
    coalesce(u.commission_pct, 0)::numeric as commission_pct,
    a.customer_name::text as customer_name,
    a.starts_at as occurred_at,
    a.price_cents::bigint as service_revenue_cents,
    0::bigint as product_revenue_cents,
    a.price_cents::bigint as gross_revenue_cents,
    round(a.price_cents::numeric * coalesce(u.commission_pct, 0) / 100)::bigint as barber_commission_cents,
    (a.price_cents::bigint - round(a.price_cents::numeric * coalesce(u.commission_pct, 0) / 100)::bigint)::bigint as shop_net_cents,
    jsonb_build_array(jsonb_build_object(
      'name', coalesce(s.name, 'Serviço'),
      'quantity', 1,
      'unit_price_cents', a.price_cents,
      'subtotal_cents', a.price_cents,
      'kind', 'legacy'
    )) as service_details,
    '[]'::jsonb as product_details,
    'legacy'::text as source_type
  from ctx
  join public.appointments a on a.tenant_id = ctx.tenant_id
  left join public.users u
    on u.id = a.barber_id and u.tenant_id = a.tenant_id
  left join public.services s
    on s.id = a.service_id and s.tenant_id = a.tenant_id
  where ctx.app_role = 'owner'
    and a.status = 'completed'
    and a.starts_at >= p_from
    and a.starts_at < p_to
    and not exists (
      select 1
      from public.commands c
      where c.tenant_id = a.tenant_id
        and c.appointment_id = a.id
    )
)
select * from command_rows
union all
select * from legacy_rows
order by occurred_at desc, command_number desc nulls last;
$$;

revoke all on function public.owner_financial_report(timestamptz, timestamptz) from public;
grant execute on function public.owner_financial_report(timestamptz, timestamptz) to authenticated;
