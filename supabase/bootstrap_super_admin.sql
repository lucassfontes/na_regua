-- 1) Crie um usuário no Supabase Auth.
-- 2) Troque o e-mail abaixo e rode este SQL uma única vez.
insert into public.users (id, tenant_id, role, full_name, active)
select id, null, 'super_admin', coalesce(raw_user_meta_data->>'full_name', email), true
from auth.users
where email = 'lucassfontessantos@gmail.com'
on conflict (id) do update
set role = 'super_admin', tenant_id = null, active = true;
