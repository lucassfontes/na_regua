import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

function slugFromName(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '')
}

function namedKey(jsonEnv: string, singleEnv: string, legacyEnv: string): string {
  const legacy = Deno.env.get(legacyEnv)
  if (legacy) return legacy

  const single = Deno.env.get(singleEnv)
  if (single) return single

  const raw = Deno.env.get(jsonEnv)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.default === 'string' && parsed.default) return parsed.default
      const first = Object.values(parsed || {}).find((value) => typeof value === 'string' && value)
      if (typeof first === 'string') return first
    } catch (_) {}
  }

  throw new Error(`Chave Supabase indisponível: ${legacyEnv}/${jsonEnv}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Método não permitido' }), { status: 405, headers: corsHeaders })
    }

    const url = Deno.env.get('SUPABASE_URL')
    if (!url) throw new Error('SUPABASE_URL não configurada')

    const publishableKey = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY')
    const adminKey = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY')

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) throw new Error('Não autenticado: token do usuário não recebido')

    const userClient = createClient(url, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      console.error('AUTH_USER_ERROR:', userError?.message || 'usuário ausente')
      throw new Error('Sessão inválida ou expirada. Entre novamente.')
    }

    const admin = createClient(url, adminKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: profile, error: profileLookupError } = await admin
      .from('users')
      .select('id,tenant_id,role,active')
      .eq('id', user.id)
      .single()

    if (profileLookupError) {
      console.error('PROFILE_LOOKUP_ERROR:', profileLookupError.message)
      throw new Error(`Perfil não encontrado: ${profileLookupError.message}`)
    }
    if (!profile?.active) throw new Error('Perfil inativo')

    const body = await req.json()
    const action = body?.action

    if (action === 'delete_tenant_hierarchy') {
      if (profile.role !== 'super_admin') throw new Error('Sem permissão: somente Super Admin pode excluir barbearias')

      const tenantId = String(body.tenantId || '').trim()
      const confirmation = String(body.confirmation || '').trim().toUpperCase()
      if (!tenantId) throw new Error('Barbearia não informada')
      if (confirmation !== 'EXCLUIR') throw new Error('Confirmação inválida')

      const { data: tenant, error: tenantLookupError } = await admin
        .from('tenants')
        .select('id,name,slug')
        .eq('id', tenantId)
        .single()
      if (tenantLookupError || !tenant) throw new Error('Barbearia não encontrada')

      const { data: members, error: membersError } = await admin
        .from('users')
        .select('id,role')
        .eq('tenant_id', tenantId)
      if (membersError) throw new Error(`Não foi possível localizar os usuários da hierarquia: ${membersError.message}`)

      // appointments possui FKs RESTRICT para barbeiro/serviço. Apagá-los primeiro
      // garante que a exclusão do tenant e dos demais filhos ocorra sem bloqueio.
      const { error: appointmentsDeleteError } = await admin
        .from('appointments')
        .delete()
        .eq('tenant_id', tenantId)
      if (appointmentsDeleteError) throw new Error(`Não foi possível excluir os agendamentos: ${appointmentsDeleteError.message}`)

      // tenant_id usa ON DELETE CASCADE para perfis, serviços, vínculos, folgas,
      // push subscriptions e eventos de assinatura.
      const { data: deletedTenant, error: tenantDeleteError } = await admin
        .from('tenants')
        .delete()
        .eq('id', tenantId)
        .select('id')
        .single()
      if (tenantDeleteError || !deletedTenant) {
        throw new Error(`Não foi possível excluir a barbearia: ${tenantDeleteError?.message || 'registro não removido'}`)
      }

      // A exclusão do tenant remove os perfis public.users, mas o Supabase Auth
      // precisa ser limpo pela Admin API para liberar os e-mails do dono/barbeiros.
      let authDeleteWarnings = 0
      for (const member of members || []) {
        const { error: authDeleteError } = await admin.auth.admin.deleteUser(member.id)
        if (authDeleteError) {
          authDeleteWarnings += 1
          console.error('AUTH_DELETE_WARNING:', member.id, authDeleteError.message)
        }
      }

      return new Response(JSON.stringify({
        ok: true,
        tenantId,
        tenantName: tenant.name,
        deletedUsers: (members || []).length,
        authDeleteWarnings,
        message: 'Painel do dono e toda a hierarquia foram excluídos',
      }), { status: 200, headers: corsHeaders })
    }

    if (action === 'reopen_command_with_owner_password') {
      if (profile.role !== 'barber' || !profile.tenant_id) throw new Error('Sem permissão para reabrir esta comanda')

      const commandId = String(body.commandId || '').trim()
      const ownerPassword = String(body.ownerPassword || '')
      if (!commandId) throw new Error('Comanda não informada')
      if (!ownerPassword) throw new Error('Digite a senha do dono')

      const { data: command, error: commandError } = await admin
        .from('commands')
        .select('id,tenant_id,barber_id,appointment_id,status,number')
        .eq('id', commandId)
        .eq('tenant_id', profile.tenant_id)
        .eq('barber_id', profile.id)
        .single()
      if (commandError || !command) throw new Error('Comanda não encontrada para este barbeiro')
      if (command.status === 'open') {
        return new Response(JSON.stringify({ ok: true, commandId: command.id, status: 'open', alreadyOpen: true }), { status: 200, headers: corsHeaders })
      }

      const { data: owner, error: ownerError } = await admin
        .from('users')
        .select('id,active')
        .eq('tenant_id', profile.tenant_id)
        .eq('role', 'owner')
        .eq('active', true)
        .maybeSingle()
      if (ownerError) throw new Error(`Não foi possível localizar o dono: ${ownerError.message}`)
      if (!owner) throw new Error('Dono ativo da barbearia não encontrado')

      const { data: ownerAuth, error: ownerAuthError } = await admin.auth.admin.getUserById(owner.id)
      const ownerEmail = String(ownerAuth?.user?.email || '').trim()
      if (ownerAuthError || !ownerEmail) throw new Error('Não foi possível validar o acesso do dono')

      const passwordVerifier = createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { error: passwordError } = await passwordVerifier.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword })
      if (passwordError) throw new Error('Senha do dono incorreta')

      const { error: reopenError } = await admin
        .from('commands')
        .update({ status: 'open', closed_at: null })
        .eq('id', command.id)
        .eq('tenant_id', profile.tenant_id)
        .eq('barber_id', profile.id)
      if (reopenError) throw new Error(`Não foi possível reabrir a comanda: ${reopenError.message}`)

      if (command.appointment_id) {
        const { error: appointmentError } = await admin
          .from('appointments')
          .update({ status: 'in_progress' })
          .eq('id', command.appointment_id)
          .eq('tenant_id', profile.tenant_id)
          .eq('barber_id', profile.id)
        if (appointmentError) throw new Error(`Comanda reaberta, mas não foi possível reabrir o atendimento: ${appointmentError.message}`)
      }

      return new Response(JSON.stringify({
        ok: true,
        commandId: command.id,
        number: command.number,
        status: 'open',
        message: 'Comanda reaberta com autorização do dono',
      }), { status: 200, headers: corsHeaders })
    }

    if (action === 'get_tenant_owner_details') {
      if (profile.role !== 'super_admin') throw new Error('Sem permissão: somente Super Admin pode consultar os dados do dono')

      const tenantId = String(body.tenantId || '').trim()
      if (!tenantId) throw new Error('Barbearia não informada')

      const { data: owner, error: ownerLookupError } = await admin
        .from('users')
        .select('id,full_name')
        .eq('tenant_id', tenantId)
        .eq('role', 'owner')
        .maybeSingle()
      if (ownerLookupError) throw new Error(`Não foi possível localizar o dono: ${ownerLookupError.message}`)
      if (!owner) throw new Error('Dono da barbearia não encontrado')

      const { data: authOwner, error: authOwnerError } = await admin.auth.admin.getUserById(owner.id)
      if (authOwnerError || !authOwner?.user) throw new Error(`Não foi possível carregar o acesso do dono: ${authOwnerError?.message || 'usuário não encontrado'}`)

      return new Response(JSON.stringify({
        ok: true,
        tenantId,
        ownerId: owner.id,
        ownerName: owner.full_name,
        ownerEmail: authOwner.user.email || '',
      }), { status: 200, headers: corsHeaders })
    }

    if (action === 'sync_owner_timezone') {
      if (profile.role !== 'owner' || !profile.tenant_id) throw new Error('Sem permissão para ajustar o fuso horário')

      const timezone = String(body.timezone || '').trim()
      if (!timezone) throw new Error('Fuso horário não informado')
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
      } catch (_) {
        throw new Error('Fuso horário do aparelho inválido')
      }

      const tenantId = profile.tenant_id
      const { data: tenant, error: tenantLookupError } = await admin
        .from('tenants')
        .select('id,timezone,status,expires_at')
        .eq('id', tenantId)
        .single()
      if (tenantLookupError || !tenant) throw new Error('Barbearia não encontrada')

      if (tenant.timezone === timezone) {
        return new Response(JSON.stringify({ ok: true, timezone: tenant.timezone, expires_at: tenant.expires_at, status: tenant.status }), { status: 200, headers: corsHeaders })
      }

      let expiryDate = String(tenant.expires_at || '').slice(0, 10)
      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tenant.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(new Date(tenant.expires_at))
        const part = (type: string) => parts.find((item) => item.type === type)?.value || ''
        expiryDate = `${part('year')}-${part('month')}-${part('day')}`
      } catch (_) {}

      const { data: resolvedExpiry, error: expiryError } = await admin.rpc('resolve_tenant_expiry', {
        p_date: expiryDate,
        p_timezone: timezone,
      })
      if (expiryError || !resolvedExpiry) throw new Error(`Não foi possível ajustar o vencimento ao fuso do aparelho: ${expiryError?.message || 'data não resolvida'}`)

      const expiresAt = new Date(resolvedExpiry)
      const nextStatus = tenant.status === 'suspended' ? 'suspended' : (expiresAt > new Date() ? 'active' : 'expired')
      const { error: updateError } = await admin.from('tenants').update({
        timezone,
        expires_at: expiresAt.toISOString(),
        status: nextStatus,
      }).eq('id', tenantId)
      if (updateError) throw new Error(`Não foi possível salvar o fuso horário do aparelho: ${updateError.message}`)

      return new Response(JSON.stringify({
        ok: true,
        timezone,
        expires_at: expiresAt.toISOString(),
        status: nextStatus,
      }), { status: 200, headers: corsHeaders })
    }

    if (action === 'sync_tenant_slugs') {
      if (profile.role !== 'super_admin') throw new Error('Sem permissão: somente Super Admin pode sincronizar os links')

      const { data: tenants, error: tenantsError } = await admin
        .from('tenants')
        .select('id,name,slug,created_at')
        .order('created_at', { ascending: true })
      if (tenantsError) throw new Error(`Não foi possível carregar as barbearias: ${tenantsError.message}`)

      const desiredGroups = new Map<string, Array<{ id: string, name: string, slug: string }>>()
      for (const tenant of tenants || []) {
        const desired = slugFromName(tenant.name)
        if (!desired) continue
        const group = desiredGroups.get(desired) || []
        group.push({ id: tenant.id, name: tenant.name, slug: tenant.slug })
        desiredGroups.set(desired, group)
      }

      const conflicts = new Set<string>()
      for (const group of desiredGroups.values()) {
        if (group.length > 1) for (const tenant of group) conflicts.add(tenant.id)
      }

      const candidates = (tenants || []).filter((tenant) => {
        const desired = slugFromName(tenant.name)
        return desired && tenant.slug !== desired && !conflicts.has(tenant.id)
      })

      let failed = 0
      const staged: Array<{ id: string, desired: string }> = []
      for (const tenant of candidates) {
        const temporary = `tmp-${String(tenant.id).toLowerCase()}`
        const { error: stageError } = await admin.from('tenants').update({ slug: temporary }).eq('id', tenant.id)
        if (stageError) {
          failed += 1
          console.error('SLUG_STAGE_ERROR:', tenant.id, stageError.message)
          continue
        }
        staged.push({ id: tenant.id, desired: slugFromName(tenant.name) })
      }

      let updated = 0
      for (const tenant of staged) {
        const { error: finalError } = await admin.from('tenants').update({ slug: tenant.desired }).eq('id', tenant.id)
        if (finalError) {
          failed += 1
          console.error('SLUG_FINAL_ERROR:', tenant.id, finalError.message)
          continue
        }
        updated += 1
      }

      return new Response(JSON.stringify({
        ok: true,
        updated,
        conflicts: conflicts.size,
        failed,
      }), { status: 200, headers: corsHeaders })
    }

    if (action === 'update_tenant_owner') {
      if (profile.role !== 'super_admin') throw new Error('Sem permissão: somente Super Admin pode editar barbearias')

      const tenantId = String(body.tenantId || '').trim()
      const name = String(body.name || '').trim()
      const slug = slugFromName(name)
      const ownerName = String(body.ownerName || '').trim()
      const ownerEmail = String(body.ownerEmail || '').trim().toLowerCase()
      const ownerPassword = String(body.ownerPassword || '')
      const expiresDate = String(body.expiresDate || '').trim()
      const monthlyPrice = Number(body.monthlyPrice)
      const monthlyPriceCents = Math.round(monthlyPrice * 100)

      if (!tenantId) throw new Error('Barbearia não informada')
      if (name.length < 2) throw new Error('Informe o nome da barbearia')
      if (!slug) throw new Error('Não foi possível gerar o link pelo nome da barbearia')
      if (ownerName.length < 2) throw new Error('Informe o nome do dono')
      if (!/^\S+@\S+\.\S+$/.test(ownerEmail)) throw new Error('E-mail do dono inválido')
      if (ownerPassword && ownerPassword.length < 6) throw new Error('A nova senha deve ter pelo menos 6 caracteres')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresDate)) throw new Error('Informe uma data de vencimento válida')
      if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) throw new Error('Mensalidade inválida')

      const { data: tenant, error: tenantLookupError } = await admin
        .from('tenants')
        .select('id,name,slug,timezone,status,expires_at,monthly_price_cents')
        .eq('id', tenantId)
        .single()
      if (tenantLookupError || !tenant) throw new Error('Barbearia não encontrada')
      const timezone = String(tenant.timezone || 'UTC').trim()

      const { data: duplicateSlug, error: duplicateSlugError } = await admin
        .from('tenants')
        .select('id')
        .eq('slug', slug)
        .neq('id', tenantId)
        .maybeSingle()
      if (duplicateSlugError) throw new Error(`Não foi possível validar o nome do link: ${duplicateSlugError.message}`)
      if (duplicateSlug) throw new Error('Já existe uma barbearia com esse nome de link')

      const { data: owner, error: ownerLookupError } = await admin
        .from('users')
        .select('id,full_name')
        .eq('tenant_id', tenantId)
        .eq('role', 'owner')
        .maybeSingle()
      if (ownerLookupError) throw new Error(`Não foi possível localizar o dono: ${ownerLookupError.message}`)
      if (!owner) throw new Error('Dono da barbearia não encontrado')

      const { data: currentAuthOwner, error: currentAuthOwnerError } = await admin.auth.admin.getUserById(owner.id)
      if (currentAuthOwnerError || !currentAuthOwner?.user) throw new Error(`Não foi possível carregar o acesso do dono: ${currentAuthOwnerError?.message || 'usuário não encontrado'}`)
      const currentOwnerEmail = String(currentAuthOwner.user.email || '').toLowerCase()

      if (ownerEmail !== currentOwnerEmail) {
        const { data: existingUsers, error: listUserError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
        if (listUserError) throw new Error(`Não foi possível validar o novo e-mail: ${listUserError.message}`)
        if (existingUsers?.users?.some((u) => u.id !== owner.id && String(u.email || '').toLowerCase() === ownerEmail)) {
          throw new Error('Já existe um usuário cadastrado com este e-mail')
        }
      }

      const { data: resolvedExpiry, error: expiryError } = await admin.rpc('resolve_tenant_expiry', {
        p_date: expiresDate,
        p_timezone: timezone,
      })
      if (expiryError || !resolvedExpiry) throw new Error(`Erro ao calcular vencimento: ${expiryError?.message || 'data não resolvida'}`)

      const expiresAt = new Date(resolvedExpiry)
      if (Number.isNaN(expiresAt.getTime())) throw new Error('Data de vencimento inválida')
      const nextStatus = tenant.status === 'suspended' ? 'suspended' : (expiresAt > new Date() ? 'active' : 'expired')

      const authUpdates: Record<string, unknown> = {
        email: ownerEmail,
        email_confirm: true,
        user_metadata: { ...(currentAuthOwner.user.user_metadata || {}), full_name: ownerName },
      }
      if (ownerPassword) authUpdates.password = ownerPassword
      const { error: ownerAuthUpdateError } = await admin.auth.admin.updateUserById(owner.id, authUpdates)
      if (ownerAuthUpdateError) throw new Error(`Não foi possível atualizar o acesso do dono: ${ownerAuthUpdateError.message}`)

      const { error: ownerProfileUpdateError } = await admin.from('users').update({
        full_name: ownerName,
      }).eq('id', owner.id)
      if (ownerProfileUpdateError) throw new Error(`Não foi possível atualizar o nome do dono: ${ownerProfileUpdateError.message}`)

      const { error: tenantUpdateError } = await admin.from('tenants').update({
        name,
        slug,
        timezone,
        expires_at: expiresAt.toISOString(),
        monthly_price_cents: monthlyPriceCents,
        status: nextStatus,
      }).eq('id', tenantId)
      if (tenantUpdateError) throw new Error(`Não foi possível atualizar o painel: ${tenantUpdateError.message}`)

      const { error: eventError } = await admin.from('tenant_subscription_events').insert({
        tenant_id: tenantId,
        event_type: 'expiry_changed',
        previous_expires_at: tenant.expires_at,
        new_expires_at: expiresAt.toISOString(),
        actor_user_id: user.id,
        metadata: {
          source: 'super_admin_edit',
          name_changed: tenant.name !== name,
          slug_changed: tenant.slug !== slug,
          owner_name_changed: owner.full_name !== ownerName,
          owner_email_changed: currentOwnerEmail !== ownerEmail,
          timezone_changed: false,
          monthly_price_cents: monthlyPriceCents,
        },
      })
      if (eventError) console.error('SUBSCRIPTION_EVENT_ERROR:', eventError.message)

      return new Response(JSON.stringify({
        ok: true,
        tenantId,
        message: 'Barbearia, dono e assinatura atualizados com sucesso',
      }), { status: 200, headers: corsHeaders })
    }

    if (action === 'create_tenant_owner') {
      if (profile.role !== 'super_admin') throw new Error('Sem permissão: somente Super Admin pode criar barbearias')

      const name = String(body.name || '').trim()
      const slug = slugFromName(name)
      const ownerName = String(body.ownerName || '').trim()
      const ownerEmail = String(body.ownerEmail || '').trim().toLowerCase()
      const ownerPassword = String(body.ownerPassword || '')
      const timezone = String(body.timezone || 'UTC').trim()
      const expiresDate = String(body.expiresDate || '').trim()
      const monthlyPrice = Number(body.monthlyPrice || 0)
      const monthlyPriceCents = Math.round(monthlyPrice * 100)

      if (name.length < 2) throw new Error('Informe o nome da barbearia')
      if (!slug) throw new Error('Não foi possível gerar o link pelo nome da barbearia')
      if (ownerName.length < 2) throw new Error('Informe o nome do dono')
      if (!/^\S+@\S+\.\S+$/.test(ownerEmail)) throw new Error('E-mail do dono inválido')
      if (ownerPassword.length < 6) throw new Error('A senha do dono deve ter pelo menos 6 caracteres')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresDate)) throw new Error('Informe uma data de vencimento válida')
      if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) throw new Error('Mensalidade inválida')
      try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date()) } catch (_) { throw new Error('Fuso horário do aparelho inválido') }

      const { data: existingTenant } = await admin.from('tenants').select('id').eq('slug', slug).maybeSingle()
      if (existingTenant) throw new Error('Já existe uma barbearia com esse nome de link')

      const { data: existingUsers, error: listUserError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (!listUserError && existingUsers?.users?.some((u) => String(u.email || '').toLowerCase() === ownerEmail)) {
        throw new Error('Já existe um usuário cadastrado com este e-mail')
      }

      const { data: resolvedExpiry, error: expiryError } = await admin.rpc('resolve_tenant_expiry', {
        p_date: expiresDate,
        p_timezone: timezone,
      })
      if (expiryError) {
        console.error('EXPIRY_RPC_ERROR:', expiryError.message)
        throw new Error(`Erro ao calcular vencimento: ${expiryError.message}`)
      }
      if (!resolvedExpiry) throw new Error('Não foi possível calcular a data de vencimento')

      const expiresAt = new Date(resolvedExpiry)
      if (Number.isNaN(expiresAt.getTime())) throw new Error('Data de vencimento inválida')

      const { data: tenant, error: tenantError } = await admin.from('tenants').insert({
        name,
        slug,
        timezone,
        expires_at: expiresAt.toISOString(),
        monthly_price_cents: monthlyPriceCents,
        status: expiresAt > new Date() ? 'active' : 'expired',
        created_by: user.id,
      }).select('id,expires_at').single()

      if (tenantError || !tenant) {
        console.error('TENANT_INSERT_ERROR:', tenantError?.message || 'tenant não retornado')
        throw new Error(`Não foi possível criar a barbearia: ${tenantError?.message || 'erro desconhecido'}`)
      }

      const { data: createdOwner, error: ownerAuthError } = await admin.auth.admin.createUser({
        email: ownerEmail,
        password: ownerPassword,
        email_confirm: true,
        user_metadata: { full_name: ownerName },
      })

      if (ownerAuthError || !createdOwner.user) {
        await admin.from('tenants').delete().eq('id', tenant.id)
        console.error('OWNER_AUTH_ERROR:', ownerAuthError?.message || 'usuário não retornado')
        throw new Error(`Não foi possível criar o acesso do dono: ${ownerAuthError?.message || 'erro desconhecido'}`)
      }

      const { error: profileError } = await admin.from('users').insert({
        id: createdOwner.user.id,
        tenant_id: tenant.id,
        role: 'owner',
        full_name: ownerName,
        active: true,
      })

      if (profileError) {
        await admin.auth.admin.deleteUser(createdOwner.user.id)
        await admin.from('tenants').delete().eq('id', tenant.id)
        console.error('OWNER_PROFILE_ERROR:', profileError.message)
        throw new Error(`Não foi possível criar o perfil do dono: ${profileError.message}`)
      }

      const { error: eventError } = await admin.from('tenant_subscription_events').insert({
        tenant_id: tenant.id,
        event_type: 'created',
        new_expires_at: tenant.expires_at,
        actor_user_id: user.id,
      })
      if (eventError) console.error('SUBSCRIPTION_EVENT_ERROR:', eventError.message)

      return new Response(JSON.stringify({
        ok: true,
        tenantId: tenant.id,
        ownerUserId: createdOwner.user.id,
        message: 'Barbearia e dono criados com sucesso',
      }), { status: 200, headers: corsHeaders })
    }

    if (action === 'create_barber') {
      if (profile.role !== 'owner' || !profile.tenant_id) throw new Error('Sem permissão')

      const { data: tenant } = await admin.from('tenants').select('status,expires_at').eq('id', profile.tenant_id).single()
      if (!tenant || tenant.status !== 'active' || new Date(tenant.expires_at) <= new Date()) throw new Error('Assinatura vencida')

      const fullName = String(body.fullName || '').trim()
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')
      const commissionPct = Number(body.commission || 0)
      if (fullName.length < 2) throw new Error('Informe o nome do barbeiro')
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('E-mail do barbeiro inválido')
      if (password.length < 6) throw new Error('A senha do barbeiro deve ter pelo menos 6 caracteres')
      if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100) throw new Error('Comissão inválida')

      const { data: existingUsers, error: listUserError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (listUserError) console.error('LIST_USERS_ERROR:', listUserError.message)
      if (!listUserError && existingUsers?.users?.some((u) => String(u.email || '').toLowerCase() === email)) {
        throw new Error('Já existe um usuário cadastrado com este e-mail')
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (createError || !created.user) throw new Error(`Acesso do barbeiro não criado: ${createError?.message || 'erro desconhecido'}`)

      const { error: pError } = await admin.from('users').insert({
        id: created.user.id,
        tenant_id: profile.tenant_id,
        role: 'barber',
        full_name: fullName,
        commission_pct: commissionPct,
        active: true,
      })
      if (pError) {
        await admin.auth.admin.deleteUser(created.user.id)
        throw new Error(`Perfil do barbeiro não criado: ${pError.message}`)
      }

      return new Response(JSON.stringify({ ok: true, userId: created.user.id, message: 'Barbeiro criado com sucesso' }), { status: 200, headers: corsHeaders })
    }

    if (action === 'get_barber') {
      if (profile.role !== 'owner' || !profile.tenant_id) throw new Error('Sem permissão')
      const barberId = String(body.barberId || '')
      if (!barberId) throw new Error('Barbeiro não informado')

      const { data: barberProfile, error: barberProfileError } = await admin
        .from('users')
        .select('id,tenant_id,role,full_name,commission_pct,active')
        .eq('id', barberId)
        .eq('tenant_id', profile.tenant_id)
        .eq('role', 'barber')
        .single()
      if (barberProfileError || !barberProfile) throw new Error('Barbeiro não encontrado')

      const { data: authData, error: authError } = await admin.auth.admin.getUserById(barberId)
      if (authError || !authData?.user) throw new Error(`Acesso do barbeiro não encontrado: ${authError?.message || 'erro desconhecido'}`)

      return new Response(JSON.stringify({
        ok: true,
        barber: {
          id: barberProfile.id,
          fullName: barberProfile.full_name,
          email: authData.user.email || '',
          commission: Number(barberProfile.commission_pct || 0),
          active: barberProfile.active,
        },
      }), { status: 200, headers: corsHeaders })
    }

    if (action === 'update_barber') {
      if (profile.role !== 'owner' || !profile.tenant_id) throw new Error('Sem permissão')

      const { data: tenant } = await admin.from('tenants').select('status,expires_at').eq('id', profile.tenant_id).single()
      if (!tenant || tenant.status !== 'active' || new Date(tenant.expires_at) <= new Date()) throw new Error('Assinatura vencida')

      const barberId = String(body.barberId || '')
      const fullName = String(body.fullName || '').trim()
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')
      const commissionPct = Number(body.commission || 0)
      const active = body.active !== false

      if (!barberId) throw new Error('Barbeiro não informado')
      if (fullName.length < 2) throw new Error('Informe o nome do barbeiro')
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('E-mail do barbeiro inválido')
      if (password && password.length < 6) throw new Error('A nova senha deve ter pelo menos 6 caracteres')
      if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100) throw new Error('Comissão inválida')

      const { data: barberProfile, error: barberProfileError } = await admin
        .from('users')
        .select('id,tenant_id,role')
        .eq('id', barberId)
        .eq('tenant_id', profile.tenant_id)
        .eq('role', 'barber')
        .single()
      if (barberProfileError || !barberProfile) throw new Error('Barbeiro não encontrado nesta barbearia')

      const authUpdates: any = {
        email,
        user_metadata: { full_name: fullName },
      }
      if (password) authUpdates.password = password

      const { error: authUpdateError } = await admin.auth.admin.updateUserById(barberId, authUpdates)
      if (authUpdateError) throw new Error(`Não foi possível atualizar o acesso do barbeiro: ${authUpdateError.message}`)

      const { error: profileUpdateError } = await admin.from('users').update({
        full_name: fullName,
        commission_pct: commissionPct,
        active,
      }).eq('id', barberId).eq('tenant_id', profile.tenant_id).eq('role', 'barber')
      if (profileUpdateError) throw new Error(`Não foi possível atualizar o perfil do barbeiro: ${profileUpdateError.message}`)

      return new Response(JSON.stringify({ ok: true, userId: barberId, message: 'Barbeiro atualizado com sucesso' }), { status: 200, headers: corsHeaders })
    }

    throw new Error('Ação desconhecida')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('ADMIN_ACTIONS_ERROR:', message)
    console.error(error)
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: corsHeaders })
  }
})
