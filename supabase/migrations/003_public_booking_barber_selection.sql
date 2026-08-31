-- v1.1.8
-- Se um serviço ainda não possui vínculos explícitos em barber_services,
-- todos os barbeiros ativos da barbearia podem ser escolhidos.
-- Assim que houver ao menos um vínculo ativo para o serviço, somente os vinculados aparecem/agenda.

create or replace function public.get_public_available_slots(
  p_slug text,
  p_service_id uuid,
  p_barber_id uuid,
  p_date date,
  p_step_minutes integer default 15
)
returns table(starts_at timestamptz, ends_at timestamptz, local_time text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ctx as (
    select t.id tenant_id,t.timezone,t.operating_hours,s.duration_minutes
    from public.tenants t
    join public.services s on s.tenant_id=t.id and s.id=p_service_id and s.active
    join public.users u on u.tenant_id=t.id and u.id=p_barber_id and u.role='barber' and u.active
    where t.slug=lower(trim(p_slug)) and t.status='active' and t.expires_at>now()
      and (
        exists (
          select 1 from public.barber_services bs
          where bs.tenant_id=t.id and bs.service_id=s.id and bs.barber_id=u.id and bs.active
        )
        or not exists (
          select 1 from public.barber_services bs_any
          where bs_any.tenant_id=t.id and bs_any.service_id=s.id and bs_any.active
        )
      )
  ), duration_ctx as (
    select c.*,
      coalesce((
        select bs.duration_override_minutes
        from public.barber_services bs
        where bs.tenant_id=c.tenant_id and bs.service_id=p_service_id and bs.barber_id=p_barber_id and bs.active
        limit 1
      ),c.duration_minutes) effective_duration
    from ctx c
  ), periods as (
    select c.*, x->>'open' open_time, x->>'close' close_time
    from duration_ctx c
    cross join lateral jsonb_array_elements(coalesce(c.operating_hours->(extract(isodow from p_date)::int)::text,'[]'::jsonb)) x
  ), bounds as (
    select p.*,
      ((p_date::timestamp + (p.open_time)::time) at time zone p.timezone) period_start,
      ((case when (p.close_time)::time <= (p.open_time)::time then (p_date+1)::timestamp else p_date::timestamp end + (p.close_time)::time) at time zone p.timezone) period_end
    from periods p
  ), candidates as (
    select b.tenant_id,b.timezone,b.effective_duration,
      gs starts_at,
      gs + make_interval(mins=>b.effective_duration) ends_at
    from bounds b
    cross join lateral generate_series(
      b.period_start,
      b.period_end - make_interval(mins=>b.effective_duration),
      make_interval(mins=>greatest(p_step_minutes,1))
    ) gs
  )
  select c.starts_at,c.ends_at,to_char(c.starts_at at time zone c.timezone,'HH24:MI') local_time
  from candidates c
  where c.starts_at>now()
    and not exists (
      select 1 from public.appointments a
      where a.tenant_id=c.tenant_id and a.barber_id=p_barber_id
        and a.status in ('pending','confirmed','in_progress')
        and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(c.starts_at,c.ends_at,'[)')
    )
    and not exists (
      select 1 from public.barber_time_off o
      where o.tenant_id=c.tenant_id and o.barber_id=p_barber_id
        and tstzrange(o.starts_at,o.ends_at,'[)') && tstzrange(c.starts_at,c.ends_at,'[)')
    )
  order by c.starts_at;
$$;
revoke all on function public.get_public_available_slots(text,uuid,uuid,date,integer) from public;
grant execute on function public.get_public_available_slots(text,uuid,uuid,date,integer) to anon, authenticated;

create or replace function public.create_public_appointment(
  p_slug text,
  p_service_id uuid,
  p_barber_id uuid,
  p_starts_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid; v_duration int; v_price int; v_end timestamptz; v_id uuid; v_timezone text; v_local_date date;
begin
  if length(trim(coalesce(p_customer_name,'')))<2 then raise exception 'Nome inválido'; end if;
  if length(trim(coalesce(p_customer_phone,'')))<6 then raise exception 'Telefone inválido'; end if;

  select t.id,t.timezone,
         coalesce(bs.duration_override_minutes,s.duration_minutes),
         coalesce(bs.price_override_cents,s.price_cents)
    into v_tenant_id,v_timezone,v_duration,v_price
  from public.tenants t
  join public.services s on s.tenant_id=t.id and s.id=p_service_id and s.active
  join public.users u on u.tenant_id=t.id and u.id=p_barber_id and u.role='barber' and u.active
  left join public.barber_services bs
    on bs.tenant_id=t.id and bs.barber_id=u.id and bs.service_id=s.id and bs.active
  where t.slug=lower(trim(p_slug)) and t.status='active' and t.expires_at>now()
    and (
      bs.barber_id is not null
      or not exists (
        select 1 from public.barber_services bs_any
        where bs_any.tenant_id=t.id and bs_any.service_id=s.id and bs_any.active
      )
    );

  if v_tenant_id is null then raise exception 'Barbearia, barbeiro ou serviço indisponível'; end if;
  if p_starts_at<=now() then raise exception 'Horário inválido'; end if;
  v_end:=p_starts_at+make_interval(mins=>v_duration);
  v_local_date:=(p_starts_at at time zone v_timezone)::date;

  if not exists (
    select 1 from public.get_public_available_slots(p_slug,p_service_id,p_barber_id,v_local_date,15) s
    where s.starts_at=p_starts_at and s.ends_at=v_end
  ) then raise exception 'Este horário não está mais disponível'; end if;

  insert into public.appointments(tenant_id,barber_id,service_id,starts_at,ends_at,status,customer_name,customer_phone,customer_email,notes,price_cents)
  values(v_tenant_id,p_barber_id,p_service_id,p_starts_at,v_end,'confirmed',trim(p_customer_name),trim(p_customer_phone),nullif(trim(coalesce(p_customer_email,'')),''),nullif(trim(coalesce(p_notes,'')),''),v_price)
  returning id into v_id;
  return v_id;
exception when exclusion_violation then
  raise exception 'Este horário acabou de ser reservado. Escolha outro.';
end;
$$;
revoke all on function public.create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text) from public;
grant execute on function public.create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text) to anon, authenticated;
