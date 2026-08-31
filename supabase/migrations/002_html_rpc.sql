-- RPCs necessárias para o front-end HTML/JS estático.
-- Mantém a anon key segura no navegador e toda autorização sensível no PostgreSQL.

create or replace function public.get_public_booking_catalog(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'logo_url', t.logo_url,
      'status', t.status, 'expires_at', t.expires_at, 'timezone', t.timezone,
      'is_available', (t.status='active' and t.expires_at>now())
    ),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'price_cents',s.price_cents,'duration_minutes',s.duration_minutes) order by s.name)
      from public.services s where s.tenant_id=t.id and s.active
    ), '[]'::jsonb),
    'barbers', coalesce((
      select jsonb_agg(jsonb_build_object('id',u.id,'full_name',u.full_name) order by u.full_name)
      from public.users u where u.tenant_id=t.id and u.role='barber' and u.active
    ), '[]'::jsonb),
    'barber_services', coalesce((
      select jsonb_agg(jsonb_build_object('barber_id',bs.barber_id,'service_id',bs.service_id))
      from public.barber_services bs where bs.tenant_id=t.id and bs.active
    ), '[]'::jsonb)
  )
  from public.tenants t
  where t.slug=lower(trim(p_slug))
  limit 1;
$$;
revoke all on function public.get_public_booking_catalog(text) from public;
grant execute on function public.get_public_booking_catalog(text) to anon, authenticated;

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
    select t.id tenant_id,t.timezone,t.operating_hours,
           coalesce(bs.duration_override_minutes,s.duration_minutes) duration_minutes
    from public.tenants t
    join public.services s on s.tenant_id=t.id and s.id=p_service_id and s.active
    join public.users u on u.tenant_id=t.id and u.id=p_barber_id and u.role='barber' and u.active
    join public.barber_services bs on bs.tenant_id=t.id and bs.barber_id=u.id and bs.service_id=s.id and bs.active
    where t.slug=lower(trim(p_slug)) and t.status='active' and t.expires_at>now()
  ), periods as (
    select c.*, x->>'open' open_time, x->>'close' close_time
    from ctx c
    cross join lateral jsonb_array_elements(coalesce(c.operating_hours->(extract(isodow from p_date)::int)::text,'[]'::jsonb)) x
  ), bounds as (
    select p.*,
      ((p_date::timestamp + (p.open_time)::time) at time zone p.timezone) period_start,
      ((case when (p.close_time)::time <= (p.open_time)::time then (p_date+1)::timestamp else p_date::timestamp end + (p.close_time)::time) at time zone p.timezone) period_end
    from periods p
  ), candidates as (
    select b.tenant_id,b.timezone,b.duration_minutes,
      gs starts_at,
      gs + make_interval(mins=>b.duration_minutes) ends_at
    from bounds b
    cross join lateral generate_series(
      b.period_start,
      b.period_end - make_interval(mins=>b.duration_minutes),
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
  select t.id,t.timezone,coalesce(bs.duration_override_minutes,s.duration_minutes),coalesce(bs.price_override_cents,s.price_cents)
    into v_tenant_id,v_timezone,v_duration,v_price
  from public.tenants t
  join public.services s on s.tenant_id=t.id and s.id=p_service_id and s.active
  join public.users u on u.tenant_id=t.id and u.id=p_barber_id and u.role='barber' and u.active
  join public.barber_services bs on bs.tenant_id=t.id and bs.barber_id=u.id and bs.service_id=s.id and bs.active
  where t.slug=lower(trim(p_slug)) and t.status='active' and t.expires_at>now();
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

create or replace function public.sa_renew_tenant(p_tenant_id uuid,p_mode text)
returns timestamptz language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old timestamptz; v_new timestamptz;
begin
  if not public.is_super_admin() then raise exception 'Sem permissão'; end if;
  select expires_at into v_old from public.tenants where id=p_tenant_id for update;
  if v_old is null then raise exception 'Tenant não encontrado'; end if;
  v_new:=greatest(v_old,now()) + case when p_mode='30d' then interval '30 days' when p_mode='1y' then interval '1 year' else interval '0' end;
  if p_mode not in ('30d','1y') then raise exception 'Modo inválido'; end if;
  update public.tenants set expires_at=v_new,status='active' where id=p_tenant_id;
  insert into public.tenant_subscription_events(tenant_id,event_type,previous_expires_at,new_expires_at,actor_user_id,metadata)
  values(p_tenant_id,'renewed',v_old,v_new,auth.uid(),jsonb_build_object('mode',p_mode,'source','html-rpc'));
  return v_new;
end;$$;
revoke all on function public.sa_renew_tenant(uuid,text) from public;
grant execute on function public.sa_renew_tenant(uuid,text) to authenticated;

create or replace function public.sa_set_tenant_expiry(p_tenant_id uuid,p_date date)
returns timestamptz language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old timestamptz; v_new timestamptz; v_tz text; v_status public.tenant_status;
begin
  if not public.is_super_admin() then raise exception 'Sem permissão'; end if;
  select expires_at,timezone,status into v_old,v_tz,v_status from public.tenants where id=p_tenant_id for update;
  if v_old is null then raise exception 'Tenant não encontrado'; end if;
  v_new:=((p_date::timestamp + time '23:59:59.999') at time zone v_tz);
  update public.tenants set expires_at=v_new,status=(case when v_status='suspended' then 'suspended'::public.tenant_status when v_new>now() then 'active'::public.tenant_status else 'expired'::public.tenant_status end) where id=p_tenant_id;
  insert into public.tenant_subscription_events(tenant_id,event_type,previous_expires_at,new_expires_at,actor_user_id)
  values(p_tenant_id,'expiry_changed',v_old,v_new,auth.uid()); return v_new;
end;$$;
revoke all on function public.sa_set_tenant_expiry(uuid,date) from public;
grant execute on function public.sa_set_tenant_expiry(uuid,date) to authenticated;

create or replace function public.sa_toggle_tenant_suspension(p_tenant_id uuid)
returns public.tenant_status language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.tenant_status; v_exp timestamptz; v_new public.tenant_status;
begin
  if not public.is_super_admin() then raise exception 'Sem permissão'; end if;
  select status,expires_at into v_old,v_exp from public.tenants where id=p_tenant_id for update;
  if v_old is null then raise exception 'Tenant não encontrado'; end if;
  v_new:=case when v_old='suspended' then (case when v_exp>now() then 'active'::public.tenant_status else 'expired'::public.tenant_status end) else 'suspended'::public.tenant_status end;
  update public.tenants set status=v_new where id=p_tenant_id;
  insert into public.tenant_subscription_events(tenant_id,event_type,previous_expires_at,new_expires_at,actor_user_id)
  values(p_tenant_id,case when v_new='suspended' then 'suspended' else 'unsuspended' end,v_exp,v_exp,auth.uid()); return v_new;
end;$$;
revoke all on function public.sa_toggle_tenant_suspension(uuid) from public;
grant execute on function public.sa_toggle_tenant_suspension(uuid) to authenticated;

-- Helper usado somente pela Edge Function para converter fim do dia do tenant para UTC corretamente.
create or replace function public.resolve_tenant_expiry(p_date date,p_timezone text)
returns timestamptz
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select ((p_date::timestamp + time '23:59:59.999') at time zone p_timezone);
$$;
revoke all on function public.resolve_tenant_expiry(date,text) from public, anon, authenticated;
grant execute on function public.resolve_tenant_expiry(date,text) to service_role;
