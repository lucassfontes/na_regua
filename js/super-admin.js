let superProfile=null, tenantsById=new Map(), tenantsCache=[], deleteTenantTargetId=null, editTenantTargetId=null;


function superMenuInitial(name){
  const clean=String(name||'Administrador').trim();
  return (clean[0]||'A').toUpperCase();
}
function syncSuperUserMenu(){
  const name=superProfile?.full_name||'Administrador';
  setText('adminName',name);
  setText('superMenuName',name);
  setText('superUserAvatar',superMenuInitial(name));
  setText('superMenuAvatar',superMenuInitial(name));
}
function setSuperUserMenu(open){
  const menu=$('#superUserMenu'),button=$('#superUserMenuButton');
  if(!menu||!button)return;
  menu.classList.toggle('hidden',!open);
  button.setAttribute('aria-expanded',open?'true':'false');
}
function closeSuperUserMenu(){setSuperUserMenu(false)}
function toggleSuperUserMenu(){const menu=$('#superUserMenu');if(menu)setSuperUserMenu(menu.classList.contains('hidden'))}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function slugFromName(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'')}

async function syncTenantSlugsFromNames(items){
  let tenants=(items||[]).map(t=>({...t}));
  const needsSync=tenants.some(t=>{const expected=slugFromName(t.name);return expected&&t.slug!==expected});
  if(!needsSync)return {tenants,failed:0,conflicts:0};
  try{
    const result=await invokeEdgeFunction('admin-actions',{action:'sync_tenant_slugs'});
    if(Number(result?.updated||0)>0){
      const {data,error}=await sb.from('tenants').select('id,name,slug,status,expires_at,timezone,monthly_price_cents,created_at').order('created_at',{ascending:false});
      if(!error)tenants=(data||[]).map(t=>({...t}));
    }
    return {tenants,failed:Number(result?.failed||0),conflicts:Number(result?.conflicts||0)};
  }catch(error){
    console.warn('Sincronizacao automatica de links indisponivel:',error?.message||error);
    return {tenants,failed:0,conflicts:0,syncUnavailable:true};
  }
}
function getTenantState(t){
  const now=Date.now(), expiry=new Date(t.expires_at).getTime();
  if(t.status!=='active'||expiry<=now)return 'blocked';
  if(expiry<=now+7*86400000)return 'due';
  return 'active';
}
function getTenantStatusLabel(t){
  if(t.status==='suspended')return 'Bloqueada';
  const state=getTenantState(t);
  if(state==='blocked')return 'Vencida';
  if(state==='due')return 'Vence em breve';
  return 'Ativa';
}
function getTenantStatusClass(t){
  const state=getTenantState(t);
  return state==='active'?'badge-active':state==='due'?'badge-warning':'badge-suspended';
}
function tenantDateOnly(iso){
  if(!iso)return '-';
  try{return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(iso))}catch(_){return String(iso).slice(0,10)}
}
function daysUntil(iso){return Math.ceil((new Date(iso).getTime()-Date.now())/86400000)}
function tenantDateInputValue(iso,timezone){
  try{
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone||getDeviceTimezone(),year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));
    const get=t=>parts.find(p=>p.type===t)?.value||'';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }catch(_){return String(iso||'').slice(0,10)}
}
function tenantPublicUrl(t){const u=new URL('agendar.html',location.href);u.searchParams.set('slug',t.slug||'');return u.href}

async function copyTenantLink(id){
  const tenant=tenantsById.get(id);if(!tenant)return;
  const url=tenantPublicUrl(tenant);
  try{await navigator.clipboard.writeText(url);toast('Link de agendamento copiado.','success')}
  catch(_){toast('Não foi possível copiar o link.','error')}
}
function openTenantLink(id){const tenant=tenantsById.get(id);if(tenant)window.open(tenantPublicUrl(tenant),'_blank','noopener')}

function renderTenants(){
  const search=String($('#tenantSearch')?.value||'').trim().toLowerCase();
  const filter=$('#tenantStatusFilter')?.value||'all';
  const list=$('#tenantList'),empty=$('#tenantEmpty');
  if(!list)return;
  const filtered=tenantsCache.filter(t=>{
    const matchesText=!search||String(t.name||'').toLowerCase().includes(search)||String(t.slug||'').toLowerCase().includes(search);
    const matchesStatus=filter==='all'||getTenantState(t)===filter;
    return matchesText&&matchesStatus;
  });
  list.innerHTML=filtered.map(t=>{
    const statusLabel=getTenantStatusLabel(t),statusClass=getTenantStatusClass(t),state=getTenantState(t),days=daysUntil(t.expires_at);
    const dueText=state==='due'&&days>=0?`Faltam ${days} dia${days===1?'':'s'}`:state==='blocked'&&t.status==='active'?'Assinatura vencida':t.status==='suspended'?'Bloqueio manual':'Assinatura em dia';
    return `<article class="tenant-card">
      <div class="tenant-card-main">
        <div class="tenant-card-title-row">
          <div class="tenant-avatar">${escapeHtml(String(t.name||'B').trim().charAt(0).toUpperCase()||'B')}</div>
          <div class="tenant-title-copy"><h3>${escapeHtml(t.name)}</h3><span class="tenant-link-text">/${escapeHtml(t.slug)}</span></div>
          <span class="badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="tenant-info-grid">
          <div class="tenant-info"><span>Vencimento</span><strong>${tenantDateOnly(t.expires_at)}</strong><small class="${state==='blocked'?'text-danger':state==='due'?'text-warn':'muted'}">${dueText}</small></div>
          <div class="tenant-info"><span>Mensalidade</span><strong>${money(t.monthly_price_cents)}</strong><small class="muted">por mês</small></div>
          <div class="tenant-info tenant-info-link"><span>Agendamento</span><div class="tenant-link-buttons"><button class="mini-link-btn" type="button" onclick="openTenantLink('${t.id}')">Abrir link</button><button class="mini-link-btn" type="button" onclick="copyTenantLink('${t.id}')">Copiar</button></div><small class="muted">Link público da barbearia</small></div>
        </div>
      </div>
      <aside class="tenant-card-actions">
        <span class="tenant-actions-label">Ações</span>
        <button class="btn btn-sm" type="button" onclick="renew('${t.id}','30d')">Renovar +30 dias</button>
        <button class="btn btn-sm btn-outline" type="button" onclick="openEditTenantDialog('${t.id}')">Editar cadastro</button>
        <button class="btn btn-sm ${t.status==='suspended'?'btn-success':'btn-danger-soft'}" type="button" onclick="toggleSuspend('${t.id}')">${t.status==='suspended'?'Desbloquear acesso':'Bloquear acesso'}</button>
        <button class="btn btn-sm btn-danger" type="button" onclick="openDeleteTenantDialog('${t.id}')">Excluir barbearia</button>
      </aside>
    </article>`;
  }).join('');
  const hasAny=filtered.length>0;
  list.classList.toggle('hidden',!hasAny);empty?.classList.toggle('hidden',hasAny);
}

async function loadTenants(){
  const refreshButtons=[...document.querySelectorAll('[onclick="loadTenants()"]')];refreshButtons.forEach(b=>b.disabled=true);
  const {data,error}=await sb.from('tenants').select('id,name,slug,status,expires_at,timezone,monthly_price_cents,created_at').order('created_at',{ascending:false});
  refreshButtons.forEach(b=>b.disabled=false);
  if(error){toast(error.message,'error');return}
  const synced=await syncTenantSlugsFromNames(data||[]);
  tenantsCache=synced.tenants;tenantsById=new Map(tenantsCache.map(t=>[t.id,t]));
  if(synced.conflicts)toast(`${synced.conflicts} barbearia(s) têm o mesmo nome. Para manter links únicos, altere o nome de uma delas.`, 'warn');
  else if(synced.failed)toast('Não foi possível atualizar alguns links. Tente novamente.','warn');
  const now=Date.now(),active=tenantsCache.filter(t=>t.status==='active'&&new Date(t.expires_at).getTime()>now),due7=active.filter(t=>new Date(t.expires_at).getTime()<=now+7*86400000),blocked=tenantsCache.filter(t=>t.status!=='active'||new Date(t.expires_at).getTime()<=now);
  setText('mrr',money(active.reduce((a,t)=>a+(t.monthly_price_cents||0),0)));setText('activeCount',active.length);setText('due7Count',due7.length);setText('blockedCount',blocked.length);
  renderTenants();
}

function openCreateTenantDialog(){
  const dialog=$('#createTenantDialog');
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  setTimeout(()=>dialog.querySelector('[name="name"]')?.focus(),50);
}
function closeCreateTenantDialog(){const dialog=$('#createTenantDialog');if(dialog?.open)dialog.close();$('#createTenantForm')?.reset()}

async function renew(id,mode){
  const tenant=tenantsById.get(id);if(!tenant)return;
  const label=mode==='1y'?'1 ano':'30 dias';
  const {error}=await sb.rpc('sa_renew_tenant',{p_tenant_id:id,p_mode:mode});
  if(error)return toast(error.message,'error');toast(`${tenant.name}: renovada por ${label}.`,'success');await loadTenants();
}
async function toggleSuspend(id){
  const tenant=tenantsById.get(id);if(!tenant)return;
  const wasSuspended=tenant.status==='suspended';
  const {error}=await sb.rpc('sa_toggle_tenant_suspension',{p_tenant_id:id});
  if(error)return toast(error.message,'error');toast(wasSuspended?'Acesso desbloqueado.':'Acesso bloqueado.',wasSuspended?'success':'warn');await loadTenants();
}

async function openEditTenantDialog(id){
  const tenant=tenantsById.get(id);if(!tenant)return toast('Barbearia não encontrada. Atualize a lista.','error');
  editTenantTargetId=id;$('#editTenantName').value=tenant.name||'';$('#editOwnerName').value='';$('#editOwnerEmail').value='';$('#editOwnerPassword').value='';$('#editOwnerPasswordConfirm').value='';$('#editTenantExpiry').value=tenantDateInputValue(tenant.expires_at,tenant.timezone);$('#editTenantPrice').value=((Number(tenant.monthly_price_cents)||0)/100).toFixed(2);
  const dialog=$('#editTenantDialog'),loading=$('#editTenantLoading'),saveBtn=$('#saveTenantEditBtn');loading?.classList.remove('hidden');if(saveBtn)saveBtn.disabled=true;
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  try{
    const details=await invokeEdgeFunction('admin-actions',{action:'get_tenant_owner_details',tenantId:id});if(editTenantTargetId!==id)return;$('#editOwnerName').value=details?.ownerName||'';$('#editOwnerEmail').value=details?.ownerEmail||'';
  }catch(error){const msg=error?.message||'Não foi possível carregar os dados do dono.';toast(msg.includes('Ação desconhecida')?'Atualize/publice a Edge Function admin-actions desta versão para editar todos os dados.':msg,'error')}
  finally{loading?.classList.add('hidden');if(saveBtn)saveBtn.disabled=false;setTimeout(()=>$('#editTenantName')?.focus(),50)}
}
function closeEditTenantDialog(){const dialog=$('#editTenantDialog');if(dialog?.open)dialog.close();editTenantTargetId=null;const form=$('#editTenantForm');if(form)form.reset();$('#editTenantLoading')?.classList.add('hidden')}
async function saveTenantEdit(e){
  e.preventDefault();const id=editTenantTargetId,tenant=tenantsById.get(id),btn=$('#saveTenantEditBtn');if(!id||!tenant)return toast('Barbearia não selecionada.','error');
  const f=new FormData(e.currentTarget),name=String(f.get('name')||'').trim(),slug=slugFromName(name),ownerName=String(f.get('ownerName')||'').trim(),ownerEmail=String(f.get('ownerEmail')||'').trim().toLowerCase(),ownerPassword=String(f.get('ownerPassword')||''),ownerPasswordConfirm=String(f.get('ownerPasswordConfirm')||''),expiresDate=String(f.get('expiresDate')||''),monthlyPrice=Number(f.get('monthlyPrice'));
  if(name.length<2)return toast('Informe o nome da barbearia.','warn');if(!slug)return toast('Não foi possível gerar o link pelo nome da barbearia.','warn');if(ownerName.length<2)return toast('Informe o nome do dono.','warn');if(!/^\S+@\S+\.\S+$/.test(ownerEmail))return toast('Informe um e-mail válido para o dono.','warn');if(ownerPassword&&ownerPassword.length<6)return toast('A nova senha deve ter pelo menos 6 caracteres.','warn');if(ownerPassword!==ownerPasswordConfirm)return toast('As novas senhas não conferem.','warn');if(!expiresDate)return toast('Informe a data de vencimento.','warn');if(!Number.isFinite(monthlyPrice)||monthlyPrice<0)return toast('Informe um valor válido.','warn');
  btn.disabled=true;btn.textContent='Salvando...';
  try{await invokeEdgeFunction('admin-actions',{action:'update_tenant_owner',tenantId:id,name,slug,ownerName,ownerEmail,ownerPassword,expiresDate,monthlyPrice});closeEditTenantDialog();toast('Cadastro atualizado com sucesso.','success');await loadTenants()}
  catch(error){const msg=error?.message||'Não foi possível atualizar o painel.';toast(msg.includes('Ação desconhecida')?'Atualize/publice a Edge Function admin-actions desta versão antes de usar Editar.':msg,'error')}
  finally{btn.disabled=false;btn.textContent='Salvar alterações'}
}

function openDeleteTenantDialog(id){
  const tenant=tenantsById.get(id);if(!tenant)return toast('Barbearia não encontrada. Atualize a lista.','error');deleteTenantTargetId=id;setText('deleteTenantName',tenant.name);
  const input=$('#deleteTenantConfirmText'),btn=$('#confirmDeleteTenantBtn');input.value='';btn.disabled=true;const dialog=$('#deleteTenantDialog');if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');setTimeout(()=>input.focus(),50);
}
function closeDeleteTenantDialog(){const dialog=$('#deleteTenantDialog');if(dialog?.open)dialog.close();deleteTenantTargetId=null;const input=$('#deleteTenantConfirmText');if(input)input.value='';const btn=$('#confirmDeleteTenantBtn');if(btn)btn.disabled=true}
async function confirmDeleteTenant(){
  const id=deleteTenantTargetId,tenant=tenantsById.get(id),input=$('#deleteTenantConfirmText'),btn=$('#confirmDeleteTenantBtn');if(!id||!tenant)return toast('Barbearia não selecionada.','error');if(String(input.value||'').trim().toUpperCase()!=='EXCLUIR')return toast('Digite EXCLUIR para confirmar.','warn');btn.disabled=true;btn.textContent='Excluindo...';
  try{const result=await invokeEdgeFunction('admin-actions',{action:'delete_tenant_hierarchy',tenantId:id,confirmation:'EXCLUIR'});closeDeleteTenantDialog();const warningCount=Number(result?.authDeleteWarnings||0);toast(warningCount?`Painel e hierarquia excluídos. ${warningCount} acesso(s) do Auth exigem revisão.`:'Painel do dono e toda a hierarquia foram excluídos.',warningCount?'warn':'success');await loadTenants()}
  catch(error){const msg=error?.message||'Não foi possível excluir a barbearia.';toast(msg.includes('Ação desconhecida')?'Atualize/publice a Edge Function admin-actions desta versão antes de usar Excluir.':msg,'error')}
  finally{btn.textContent='Excluir tudo';if(deleteTenantTargetId)btn.disabled=String(input.value||'').trim().toUpperCase()!=='EXCLUIR'}
}

document.addEventListener('DOMContentLoaded',async()=>{
  superProfile=await guard(['super_admin']);syncSuperUserMenu();
  $('#superUserMenuButton')?.addEventListener('click',e=>{e.stopPropagation();toggleSuperUserMenu()});
  $('#superUserMenu')?.addEventListener('click',e=>e.stopPropagation());
  document.addEventListener('click',closeSuperUserMenu);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSuperUserMenu()});
  $('#superUserMenu')?.addEventListener('click',async e=>{
    const action=e.target.closest('[data-super-menu-action]')?.dataset.superMenuAction;
    if(!action)return;
    closeSuperUserMenu();
    if(action==='refresh')return loadTenants();
    if(action==='signout')return signOut();
  });
  $('#installApp')?.addEventListener('click',async()=>{closeSuperUserMenu();await installApp()});
  await loadTenants();
  $('#tenantSearch')?.addEventListener('input',renderTenants);$('#tenantStatusFilter')?.addEventListener('change',renderTenants);
  const editForm=$('#editTenantForm');editForm?.addEventListener('submit',saveTenantEdit);
  const deleteInput=$('#deleteTenantConfirmText');deleteInput?.addEventListener('input',()=>{$('#confirmDeleteTenantBtn').disabled=String(deleteInput.value||'').trim().toUpperCase()!=='EXCLUIR'});
  $('#createTenantForm')?.addEventListener('submit',async e=>{
    e.preventDefault();const btn=$('#createTenantBtn'),f=new FormData(e.target),name=String(f.get('name')||'').trim(),slug=slugFromName(name),ownerPassword=String(f.get('ownerPassword')||''),ownerPasswordConfirm=String(f.get('ownerPasswordConfirm')||'');
    if(name.length<2)return toast('Informe o nome da barbearia.','warn');if(ownerPassword.length<6)return toast('A senha do dono deve ter pelo menos 6 caracteres.','warn');if(ownerPassword!==ownerPasswordConfirm)return toast('As senhas do dono não conferem.','warn');
    btn.disabled=true;btn.textContent='Criando...';
    try{await invokeEdgeFunction('admin-actions',{action:'create_tenant_owner',name,slug,ownerName:f.get('ownerName'),ownerEmail:f.get('ownerEmail'),ownerPassword,expiresDate:f.get('expiresDate'),timezone:getDeviceTimezone(),monthlyPrice:f.get('monthlyPrice')});closeCreateTenantDialog();toast('Barbearia e dono criados com sucesso.','success');await loadTenants()}
    catch(error){toast(error?.message||'Não foi possível criar a barbearia.','error')}
    finally{btn.disabled=false;btn.textContent='Criar barbearia'}
  });
});
