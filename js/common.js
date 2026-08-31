const $=(s,r=document)=>r.querySelector(s); const $$=(s,r=document)=>[...r.querySelectorAll(s)];
function money(c){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(c)||0)/100)}
function dateBR(v){if(!v)return '-';return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v))}
function getDeviceTimezone(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'}catch(_){return 'UTC'}}
let appMessageResolve=null;

// v1.1.41 - todos os modais só fecham por uma ação explícita do usuário.
// Impede fechamento acidental ao clicar no backdrop e também pelo ESC.
document.addEventListener('click',e=>{
  const dialog=e.target;
  if(dialog instanceof HTMLDialogElement&&dialog.open&&e.target===dialog){
    e.preventDefault();
    e.stopImmediatePropagation();
  }
},true);
document.addEventListener('cancel',e=>{
  if(e.target instanceof HTMLDialogElement)e.preventDefault();
},true);

function ensureAppMessageModal(){
  let modal=$('#appMessageModal');
  if(modal)return modal;
  modal=document.createElement('dialog');
  modal.id='appMessageModal';
  modal.className='app-message-modal hidden';
  modal.setAttribute('aria-labelledby','appMessageTitle');
  modal.innerHTML=`<div class="app-message-card" role="document">
    <div id="appMessageIcon" class="app-message-icon" aria-hidden="true">✓</div>
    <div class="app-message-copy">
      <h2 id="appMessageTitle">Mensagem</h2>
      <p id="appMessageText"></p>
    </div>
    <div id="appMessageActions" class="app-message-actions">
      <button type="button" id="appMessageCancel" class="btn btn-outline hidden">Cancelar</button>
      <button type="button" id="appMessageOk" class="btn">OK</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  const finish=value=>{
    if(modal.open)modal.close();
    modal.classList.add('hidden');
    document.body.classList.remove('app-message-open');
    const resolve=appMessageResolve;appMessageResolve=null;
    if(resolve)resolve(value);
  };
  $('#appMessageOk',modal).addEventListener('click',()=>finish(true));
  $('#appMessageCancel',modal).addEventListener('click',()=>finish(false));
  modal.addEventListener('cancel',e=>e.preventDefault());
  return modal;
}
function showAppMessage(msg,type='ok',options={}){
  const modal=ensureAppMessageModal();
  const titleMap={ok:'Concluído',success:'Concluído',error:'Não foi possível concluir',warn:'Atenção',info:'Mensagem'};
  const iconMap={ok:'✓',success:'✓',error:'!',warn:'!',info:'i'};
  const normalized=type==='success'?'ok':type;
  modal.dataset.type=normalized;
  setText('appMessageTitle',options.title||titleMap[normalized]||'Mensagem');
  setText('appMessageText',String(msg??''));
  setText('appMessageIcon',iconMap[normalized]||'i');
  const cancel=$('#appMessageCancel',modal),ok=$('#appMessageOk',modal),actions=$('#appMessageActions',modal);
  cancel.classList.toggle('hidden',!options.confirm);
  // O botão Cancelar continua no DOM mesmo oculto; por isso :only-child não é confiável.
  // Marcamos explicitamente quando existe apenas uma ação para centralizar corretamente no iPhone.
  actions?.classList.toggle('single-action',!options.confirm);
  cancel.textContent=options.cancelText||'Cancelar';
  ok.textContent=options.okText||(options.confirm?'Confirmar':'OK');
  modal.classList.remove('hidden');
  document.body.classList.add('app-message-open');
  if(!modal.open){
    if(typeof modal.showModal==='function')modal.showModal();
    else modal.setAttribute('open','');
  }
  requestAnimationFrame(()=>ok.focus());
  return modal;
}
function toast(msg,type='ok'){showAppMessage(msg,type)}
function confirmMessage(msg,options={}){
  if(appMessageResolve){appMessageResolve(false);appMessageResolve=null}
  showAppMessage(msg,options.type||'warn',{...options,confirm:true});
  return new Promise(resolve=>{appMessageResolve=resolve});
}
async function signOut(){await sb.auth.signOut();location.href='login.html'}
async function currentProfile(){const {data:{user}}=await sb.auth.getUser();if(!user)return null;const {data,error}=await sb.from('users').select('id,tenant_id,role,full_name,commission_pct,active').eq('id',user.id).single();if(error||!data?.active)return null;return data}
async function guard(roles){const p=await currentProfile();if(!p){location.replace('login.html');throw new Error('unauthenticated')}if(!roles.includes(p.role)){location.replace('login.html?error=sem-permissao');throw new Error('forbidden')}if(p.tenant_id&&p.role!=='super_admin'){const {data:t}=await sb.from('tenants').select('id,name,status,expires_at,timezone,operating_hours,monthly_price_cents,slug,whatsapp,logo_url').eq('id',p.tenant_id).single();if(!t){location.replace('assinatura-vencida.html');throw new Error('expired')}if(p.role==='owner'){const deviceTimezone=getDeviceTimezone();if(deviceTimezone&&deviceTimezone!==t.timezone){try{const synced=await invokeEdgeFunction('admin-actions',{action:'sync_owner_timezone',timezone:deviceTimezone});if(synced?.timezone)t.timezone=synced.timezone;if(synced?.expires_at)t.expires_at=synced.expires_at;if(synced?.status)t.status=synced.status}catch(error){console.warn('Não foi possível sincronizar o fuso horário do aparelho:',error?.message||error)}}}if(t.status!=='active'||new Date(t.expires_at)<=new Date()){location.replace('assinatura-vencida.html');throw new Error('expired')}p.tenant=t}return p}
function qs(k){return new URLSearchParams(location.search).get(k)}
function setText(id,v){const e=document.getElementById(id);if(e)e.textContent=v??''}

// Chamada autenticada de Edge Function para projetos que usam Publishable Key.
// Envia explicitamente a chave pública e o JWT da sessão do usuário.
async function invokeEdgeFunction(functionName, body) {
  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  const session = sessionData?.session;

  if (sessionError || !session?.access_token) {
    throw new Error('Sua sessão expirou. Saia e entre novamente no sistema.');
  }

  const cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Supabase não configurado em js/config.js.');
  }

  let response;
  try {
    response = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${encodeURIComponent(functionName)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify(body || {})
    });
  } catch (networkError) {
    throw new Error('Não foi possível conectar à Edge Function. Verifique sua internet e tente novamente.');
  }

  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { message: raw }; }

  if (!response.ok) {
    const message = payload?.error || payload?.message || payload?.msg || `Erro HTTP ${response.status} na Edge Function`;
    throw new Error(message);
  }

  if (payload?.error) throw new Error(payload.error);
  return payload;
}
