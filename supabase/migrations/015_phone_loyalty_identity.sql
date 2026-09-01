-- Na Régua v1.1.71
-- Fidelidade simplificada: o cliente é identificado pelo WhatsApp/telefone.
-- Não existe código OTP, e-mail ou conexão com Meta para participar da fidelidade.
-- A chave única já existente (tenant_id, phone_key) garante:
--   mesmo nome + WhatsApp diferente = clientes diferentes;
--   mesmo WhatsApp na mesma barbearia = mesmo cliente/histórico.

-- Informação pública do programa, sem dependência de integração externa.
create or replace function public.get_public_loyalty_program(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'enabled',coalesce(ls.enabled,false),
    'visits_required',coalesce(ls.visits_required,10),
    'reward_name',coalesce(ls.reward_name,'1 serviço grátis')
  )
  from public.tenants t
  left join public.loyalty_settings ls on ls.tenant_id=t.id
  where t.slug=lower(trim(p_slug))
    and t.status='active' and t.expires_at>now()
  limit 1;
$$;

revoke all on function public.get_public_loyalty_program(text) from public;
grant execute on function public.get_public_loyalty_program(text) to anon, authenticated;

-- O passe do agendamento devolve o token do cliente identificado pelo telefone.
create or replace function public.get_public_appointment_pass(
  p_slug text,
  p_appointment_id uuid,
  p_customer_phone text
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'appointment_id',a.id,
    'starts_at',a.starts_at,
    'customer_name',a.customer_name,
    'service_name',s.name,
    'barber_name',u.full_name,
    'checkin_code',ci.code,
    'validated_at',ci.validated_at,
    'loyalty_credited',ci.loyalty_credited,
    'customer_token',c.public_token,
    'loyalty',jsonb_build_object(
      'program_enabled',coalesce(ls.enabled,false),
      'enabled',coalesce(ls.enabled,false),
      'visits_required',coalesce(ls.visits_required,10),
      'reward_name',coalesce(ls.reward_name,'1 serviço grátis'),
      'visits_balance',c.visits_balance,
      'rewards_available',c.rewards_available,
      'total_validated_visits',c.total_validated_visits
    )
  )
  from public.tenants t
  join public.appointments a on a.tenant_id=t.id and a.id=p_appointment_id
  join public.appointment_checkins ci on ci.appointment_id=a.id and ci.tenant_id=t.id
  join public.loyalty_customers c on c.id=ci.customer_id and c.tenant_id=t.id
  join public.services s on s.id=a.service_id and s.tenant_id=t.id
  join public.users u on u.id=a.barber_id and u.tenant_id=t.id
  left join public.loyalty_settings ls on ls.tenant_id=t.id
  where t.slug=lower(trim(p_slug))
    and public.normalize_customer_phone(p_customer_phone)=c.phone_key
    and t.status='active' and t.expires_at>now()
  limit 1;
$$;

revoke all on function public.get_public_appointment_pass(text,uuid,text) from public;
grant execute on function public.get_public_appointment_pass(text,uuid,text) to anon, authenticated;

-- Histórico do cliente pelo token aleatório salvo no aparelho.
create or replace function public.get_public_customer_portal(
  p_slug text,
  p_customer_token uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'customer',jsonb_build_object(
      'name',c.customer_name,
      'phone',c.phone,
      'visits_balance',c.visits_balance,
      'rewards_available',c.rewards_available,
      'total_validated_visits',c.total_validated_visits,
      'last_visit_at',c.last_visit_at
    ),
    'loyalty',jsonb_build_object(
      'enabled',coalesce(ls.enabled,false),
      'visits_required',coalesce(ls.visits_required,10),
      'reward_name',coalesce(ls.reward_name,'1 serviço grátis')
    ),
    'appointments',coalesce((
      select jsonb_agg(x.item order by x.starts_at desc)
      from (
        select a.starts_at,
          jsonb_build_object(
            'id',a.id,
            'starts_at',a.starts_at,
            'status',a.status,
            'price_cents',a.price_cents,
            'service_name',s.name,
            'barber_name',u.full_name,
            'checkin_code',ci.code,
            'validated_at',ci.validated_at,
            'loyalty_credited',ci.loyalty_credited
          ) item
        from public.appointment_checkins ci
        join public.appointments a on a.id=ci.appointment_id and a.tenant_id=ci.tenant_id
        join public.services s on s.id=a.service_id and s.tenant_id=a.tenant_id
        join public.users u on u.id=a.barber_id and u.tenant_id=a.tenant_id
        where ci.customer_id=c.id and ci.tenant_id=c.tenant_id
        order by a.starts_at desc
        limit 50
      ) x
    ),'[]'::jsonb)
  )
  from public.tenants t
  join public.loyalty_customers c on c.tenant_id=t.id and c.public_token=p_customer_token
  left join public.loyalty_settings ls on ls.tenant_id=t.id
  where t.slug=lower(trim(p_slug))
    and t.status='active' and t.expires_at>now()
  limit 1;
$$;

revoke all on function public.get_public_customer_portal(text,uuid) from public;
grant execute on function public.get_public_customer_portal(text,uuid) to anon, authenticated;

-- Ao validar a chegada, soma imediatamente a visita na fidelidade quando o programa estiver ativo.
create or replace function public.validate_appointment_checkin(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.user_role;
  v_tenant_id uuid;
  v_barber_id uuid;
  v_appointment_id uuid;
  v_customer_id uuid;
  v_customer_name text;
  v_status public.appointment_status;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_validated_at timestamptz;
  v_credited boolean;
  v_enabled boolean := false;
  v_required integer := 10;
  v_reward text := '1 serviço grátis';
  v_balance integer;
  v_rewards integer;
  v_total integer;
  v_earned integer := 0;
  v_was_validated boolean := false;
begin
  if auth.uid() is null then raise exception 'Faça login para validar a chegada.'; end if;
  v_role := public.current_app_role();
  v_tenant_id := public.current_tenant_id();
  if v_role not in ('owner','barber') or v_tenant_id is null then raise exception 'Sem permissão para validar este QR.'; end if;

  select ci.appointment_id,ci.customer_id,ci.validated_at,ci.loyalty_credited,
         a.barber_id,a.status,a.starts_at,a.ends_at,c.customer_name
    into v_appointment_id,v_customer_id,v_validated_at,v_credited,
         v_barber_id,v_status,v_starts_at,v_ends_at,v_customer_name
  from public.appointment_checkins ci
  join public.appointments a on a.id=ci.appointment_id and a.tenant_id=ci.tenant_id
  join public.loyalty_customers c on c.id=ci.customer_id and c.tenant_id=ci.tenant_id
  where ci.tenant_id=v_tenant_id and upper(trim(ci.code))=upper(trim(p_code))
  for update of ci;

  if not found then raise exception 'QR de chegada inválido para esta barbearia.'; end if;
  if v_role='barber' and v_barber_id<>auth.uid() then raise exception 'Este cliente está agendado com outro barbeiro.'; end if;
  if v_status in ('cancelled','no_show') or (v_status='completed' and v_validated_at is null) then raise exception 'Este agendamento não pode ter a chegada validada.'; end if;
  if v_validated_at is null and (now() < v_starts_at - interval '2 hours' or now() > v_ends_at + interval '4 hours') then
    raise exception 'A chegada só pode ser validada próximo ao horário do agendamento.';
  end if;

  select coalesce(ls.enabled,false),coalesce(ls.visits_required,10),coalesce(ls.reward_name,'1 serviço grátis')
    into v_enabled,v_required,v_reward
  from public.loyalty_settings ls where ls.tenant_id=v_tenant_id;
  if not found then v_enabled:=false;v_required:=10;v_reward:='1 serviço grátis'; end if;

  v_was_validated := v_validated_at is not null;

  if not v_was_validated then
    update public.appointment_checkins
      set validated_at=now(),validated_by=auth.uid()
    where appointment_id=v_appointment_id;
    v_validated_at:=now();

    update public.appointments
      set status='in_progress'
    where id=v_appointment_id and tenant_id=v_tenant_id and status in ('pending','confirmed');
  end if;

  select visits_balance,rewards_available,total_validated_visits
    into v_balance,v_rewards,v_total
  from public.loyalty_customers
  where id=v_customer_id and tenant_id=v_tenant_id
  for update;

  if v_enabled and not v_was_validated and not coalesce(v_credited,false) then
    v_balance:=coalesce(v_balance,0)+1;
    v_earned:=floor(v_balance::numeric/greatest(v_required,2))::integer;
    v_balance:=mod(v_balance,greatest(v_required,2));
    v_rewards:=coalesce(v_rewards,0)+v_earned;
    v_total:=coalesce(v_total,0)+1;

    update public.loyalty_customers
      set visits_balance=v_balance,
          rewards_available=v_rewards,
          total_validated_visits=v_total,
          last_visit_at=v_validated_at,
          updated_at=now()
    where id=v_customer_id and tenant_id=v_tenant_id;

    update public.appointment_checkins
      set loyalty_credited=true
    where appointment_id=v_appointment_id;
    v_credited:=true;
  end if;

  return jsonb_build_object(
    'ok',true,
    'already_validated',v_was_validated,
    'appointment_id',v_appointment_id,
    'customer_name',v_customer_name,
    'validated_at',v_validated_at,
    'loyalty_enabled',v_enabled,
    'loyalty_eligible',v_enabled,
    'loyalty_credited',coalesce(v_credited,false),
    'visits_balance',coalesce(v_balance,0),
    'visits_required',v_required,
    'rewards_available',coalesce(v_rewards,0),
    'reward_name',v_reward,
    'reward_earned',v_earned
  );
end;
$$;

revoke all on function public.validate_appointment_checkin(text) from public;
grant execute on function public.validate_appointment_checkin(text) to authenticated;

-- Resgate sem exigência de OTP/WhatsApp verificado.
create or replace function public.redeem_loyalty_reward(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_name text;
  v_rewards integer;
begin
  select c.tenant_id,c.customer_name,c.rewards_available
    into v_tenant_id,v_name,v_rewards
  from public.loyalty_customers c
  where c.id=p_customer_id
  for update;

  if not found then raise exception 'Cliente não encontrado.'; end if;
  if not public.is_owner_of(v_tenant_id) then raise exception 'Somente o dono pode resgatar recompensas.'; end if;
  if not public.tenant_is_active(v_tenant_id) then raise exception 'A barbearia está indisponível.'; end if;
  if coalesce(v_rewards,0)<1 then raise exception 'Este cliente não possui recompensa disponível.'; end if;

  update public.loyalty_customers
    set rewards_available=rewards_available-1,updated_at=now()
  where id=p_customer_id and tenant_id=v_tenant_id;

  return jsonb_build_object('ok',true,'customer_name',v_name,'rewards_available',v_rewards-1);
end;
$$;

revoke all on function public.redeem_loyalty_reward(uuid) from public;
grant execute on function public.redeem_loyalty_reward(uuid) to authenticated;
