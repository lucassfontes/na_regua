let booking={slug:'',tenant:null,services:[],barbers:[],links:[],serviceId:'',barberId:'',preferredBarberId:'',date:'',slot:null,loyalty:null,clientPortal:null};
function esc(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function clientTokenKey(){return `na_regua_client_token_${booking.slug||'default'}`}
function bookingStatusLabel(status){return ({pending:'Pendente',confirmed:'Confirmado',in_progress:'Em atendimento',completed:'Concluído',cancelled:'Cancelado',no_show:'Não compareceu'})[status]||status||'-'}
function bookingStatusClass(status){return status==='completed'?'badge-active':status==='cancelled'||status==='no_show'?'badge-suspended':status==='in_progress'?'badge-warning':'badge-warning'}
function bookingDateTime(value){try{return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value))}catch{return '-'}}
function buildCheckinUrl(code){const url=new URL('barber.html',location.href);url.searchParams.set('checkin',String(code||'').trim().toUpperCase());return url.href}
function renderQr(targetId,code){
  const host=document.getElementById(targetId);if(!host)return;
  host.innerHTML='';
  if(!code)return;
  if(typeof QRCode==='undefined'){host.innerHTML='<div class="notice notice-warn">QR indisponível neste momento. Use o código de chegada abaixo.</div>';return}
  new QRCode(host,{text:buildCheckinUrl(code),width:210,height:210,colorDark:'#18181b',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
  // QRCode.js cria um canvas e também uma imagem de fallback. Mantemos apenas uma representação visível.
  requestAnimationFrame(()=>{const canvas=host.querySelector('canvas');if(canvas)host.querySelectorAll('img').forEach(img=>img.style.display='none')});
}
function closeArrivalQrDialog(){const dialog=$('#arrivalQrDialog');if(!dialog)return;try{if(dialog.open&&typeof dialog.close==='function')dialog.close()}catch{}dialog.removeAttribute('open')}
window.closeArrivalQrDialog=closeArrivalQrDialog;
function openArrivalQrDialog(code,item={}){
  const dialog=$('#arrivalQrDialog');if(!dialog||!code)return;
  setText('arrivalQrTitle',item.service_name||'Seu agendamento');
  setText('arrivalQrMeta',`${bookingDateTime(item.starts_at)}${item.barber_name?` · ${item.barber_name}`:''}`);
  setText('arrivalQrShortCode',String(code).toUpperCase());renderQr('arrivalQrDialogCode',code);
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
}
function renderServices(){
  const box=$('#services');
  box.innerHTML=booking.services.map(s=>`<button type="button" class="booking-option ${booking.serviceId===s.id?'selected':''}" data-service-id="${s.id}"><div class="booking-option-row"><div><strong>${esc(s.name)}</strong><div class="small muted">${s.duration_minutes} min · ${money(s.price_cents)}</div></div>${booking.serviceId===s.id?'<span class="booking-check">✓</span>':''}</div></button>`).join('')||'<div class="notice notice-warn">Nenhum serviço disponível no momento.</div>';
}
function getAvailableBarbersForService(){
  if(!booking.serviceId)return [];
  const linkedIds=booking.links.filter(x=>x.service_id===booking.serviceId).map(x=>x.barber_id);
  if(!linkedIds.length)return [];
  const allowed=new Set(linkedIds);
  let list=booking.barbers.filter(b=>allowed.has(b.id));
  if(booking.preferredBarberId)list=list.filter(b=>b.id===booking.preferredBarberId);
  return list;
}
function renderBarbers(){
  const section=$('#barberSection');
  if(!booking.serviceId){section.classList.add('hidden');return}
  section.classList.remove('hidden');
  const list=getAvailableBarbersForService();const box=$('#barbers');
  if(!list.length){box.innerHTML='<div class="notice notice-warn">Nenhum barbeiro ativo está disponível para este serviço.</div>';return}
  box.innerHTML=list.map(b=>`<button type="button" class="booking-option barber-option ${booking.barberId===b.id?'selected':''}" data-barber-id="${b.id}"><div class="booking-option-row"><div><strong>${esc(b.full_name)}</strong><div class="small muted">Toque para escolher este profissional</div></div>${booking.barberId===b.id?'<span class="booking-check">✓</span>':''}</div></button>`).join('');
}
function chooseService(id){
  booking.serviceId=id;booking.barberId='';booking.slot=null;booking.date='';
  const available=getAvailableBarbersForService();
  if(booking.preferredBarberId&&available.some(b=>b.id===booking.preferredBarberId))booking.barberId=booking.preferredBarberId;
  renderServices();renderBarbers();
  $('#dateSection').classList.toggle('hidden',!booking.barberId);$('#customerSection').classList.add('hidden');
  $('#bookingDate').value='';$('#slots').innerHTML='';
  const target=booking.barberId?'#dateSection':'#barberSection';setTimeout(()=>$(target)?.scrollIntoView({behavior:'smooth',block:'nearest'}),50);
}
function chooseBarber(id){
  if(!getAvailableBarbersForService().some(b=>b.id===id))return;
  booking.barberId=id;booking.slot=null;renderBarbers();$('#dateSection').classList.remove('hidden');$('#customerSection').classList.add('hidden');$('#slots').innerHTML='';
  setTimeout(()=>$('#dateSection')?.scrollIntoView({behavior:'smooth',block:'nearest'}),50);
}
async function loadSlots(){
  booking.date=$('#bookingDate').value;booking.slot=null;$('#customerSection').classList.add('hidden');
  if(!booking.serviceId)return toast('Escolha um serviço primeiro.','error');
  if(!booking.barberId)return toast('Escolha um barbeiro primeiro.','error');
  if(!booking.date)return;
  $('#slots').innerHTML='<span class="muted">Buscando horários…</span>';
  const {data,error}=await sb.rpc('get_public_available_slots',{p_slug:booking.slug,p_service_id:booking.serviceId,p_barber_id:booking.barberId,p_date:booking.date,p_step_minutes:15});
  if(error){$('#slots').innerHTML='';toast(error.message,'error');return}
  $('#slots').innerHTML=(data||[]).map(s=>`<button type="button" class="slot" data-start="${s.starts_at}" data-slot='${esc(JSON.stringify(s))}'>${esc(s.local_time)}</button>`).join('')||'<span class="muted">Nenhum horário disponível.</span>';
}
function chooseSlot(s){
  booking.slot=s;$$('.slot').forEach(x=>x.classList.toggle('selected',x.dataset.start===s.starts_at));$('#customerSection').classList.remove('hidden');setText('selectedTime',s.local_time);
  setTimeout(()=>$('#customerSection')?.scrollIntoView({behavior:'smooth',block:'nearest'}),50);
}
function renderPublicLoyalty(){
  const banner=$('#publicLoyaltyBanner');
  if(!booking.loyalty?.enabled){banner?.classList.add('hidden');return}
  banner?.classList.remove('hidden');
  setText('publicLoyaltyText',`A cada ${booking.loyalty.visits_required} chegadas validadas, ganhe: ${booking.loyalty.reward_name}.`);
}
function renderClientPortal(){
  const data=booking.clientPortal,card=$('#clientPortalCard');
  if(!data?.customer){card?.classList.add('hidden');return}
  card?.classList.remove('hidden');
  const loyalty=data.loyalty||{},customer=data.customer||{},required=Math.max(2,Number(loyalty.visits_required||10)),balance=Math.max(0,Number(customer.visits_balance||0));
  setText('clientLoyaltyProgress',loyalty.enabled?`${balance}/${required}`:'Pausado');
  setText('clientLoyaltyRewardLabel',loyalty.enabled?loyalty.reward_name:'Programa pausado pela barbearia');
  setText('clientRewardsAvailable',String(Number(customer.rewards_available||0)));setText('clientTotalVisits',String(Number(customer.total_validated_visits||0)));
  const stamps=$('#clientLoyaltyStamps');
  if(stamps){
    if(loyalty.enabled)stamps.innerHTML=Array.from({length:required},(_,i)=>`<span class="client-loyalty-stamp ${i<balance?'is-filled':''}" title="${i<balance?'Visita validada':'Falta validar'}"><i class="bi ${i<balance?'bi-scissors':'bi-circle'}"></i></span>`).join('');
    else stamps.innerHTML='<div class="notice notice-warn">O programa de fidelidade está pausado. Seu progresso fica preservado.</div>';
  }
  const list=$('#clientHistoryList'),items=data.appointments||[];
  if(list)list.innerHTML=items.map(a=>{
    const future=new Date(a.starts_at)>new Date()&&!['cancelled','no_show','completed'].includes(a.status);
    return `<article class="client-history-item"><div class="client-history-date"><strong>${bookingDateTime(a.starts_at)}</strong><span class="badge ${bookingStatusClass(a.status)}">${bookingStatusLabel(a.status)}</span></div><div class="client-history-main"><strong>${esc(a.service_name||'Serviço')}</strong><span>${esc(a.barber_name||'Barbeiro')} · ${money(a.price_cents||0)}</span></div><div class="client-history-actions">${a.validated_at?'<span class="client-checkin-ok"><i class="bi bi-check-circle-fill"></i> Chegada validada</span>':future&&a.checkin_code?`<button type="button" class="btn btn-sm" data-client-qr="${esc(a.checkin_code)}" data-client-service="${esc(a.service_name||'Agendamento')}" data-client-start="${esc(a.starts_at)}" data-client-barber="${esc(a.barber_name||'')}"><i class="bi bi-qr-code"></i> QR de chegada</button>`:''}</div></article>`;
  }).join('')||'<div class="empty">Nenhum agendamento encontrado.</div>';
}
async function loadClientPortal(showCard=false){
  const token=(localStorage.getItem(clientTokenKey())||'').trim();
  if(!token)return;
  const {data,error}=await sb.rpc('get_public_customer_portal',{p_slug:booking.slug,p_customer_token:token});
  if(error||!data){if(error)console.warn('Portal do cliente indisponível:',error.message);return}
  booking.clientPortal=data;renderClientPortal();
  if(showCard)setTimeout(()=>$('#clientPortalCard')?.scrollIntoView({behavior:'smooth',block:'start'}),80);
}
async function loadLoyaltyProgram(){
  const {data,error}=await sb.rpc('get_public_loyalty_program',{p_slug:booking.slug});
  if(error){console.warn('Fidelidade ainda não configurada:',error.message);return}
  booking.loyalty=data||null;renderPublicLoyalty();
}
async function loadAppointmentPass(appointmentId,phone){
  const {data,error}=await sb.rpc('get_public_appointment_pass',{p_slug:booking.slug,p_appointment_id:appointmentId,p_customer_phone:phone});
  if(error||!data){console.warn('QR de chegada indisponível:',error?.message||'sem dados');return null}
  if(data.customer_token)localStorage.setItem(clientTokenKey(),data.customer_token);
  return data;
}
function showSuccessPass(pass){
  if(!pass?.checkin_code)return;
  $('#successArrivalPass')?.classList.remove('hidden');$('#openClientPortalAfterBooking')?.classList.remove('hidden');
  setText('successCheckinCode',String(pass.checkin_code).toUpperCase());renderQr('successQrCode',pass.checkin_code);
}

document.addEventListener('DOMContentLoaded',async()=>{
  $('#arrivalQrCloseButton')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();closeArrivalQrDialog()});
  booking.slug=(qs('slug')||'').trim();booking.preferredBarberId=(qs('barber')||'').trim();
  if(!booking.slug){const savedSlug=(localStorage.getItem('na_regua_current_tenant_slug')||'').trim();if(savedSlug){booking.slug=savedSlug;const fixedUrl=new URL(location.href);fixedUrl.searchParams.set('slug',booking.slug);history.replaceState(null,'',fixedUrl.href)}}
  if(!booking.slug){$('#bookingRoot').innerHTML='<div class="card notice-error">Este link de agendamento está incompleto. Abra o link público fornecido pela barbearia.</div>';return}
  const {data,error}=await sb.rpc('get_public_booking_catalog',{p_slug:booking.slug});
  if(error||!data?.tenant){$('#bookingRoot').innerHTML='<div class="card">Barbearia não encontrada.</div>';return}
  if(!data.tenant.is_available){location.replace(`agendamentos-indisponiveis.html?slug=${encodeURIComponent(booking.slug)}`);return}
  booking.tenant=data.tenant;booking.services=data.services||[];booking.barbers=data.barbers||[];booking.links=data.barber_services||[];
  if(booking.preferredBarberId&&!booking.barbers.some(b=>b.id===booking.preferredBarberId))booking.preferredBarberId='';
  setText('bookingTenantName',booking.tenant.name);renderServices();
  $('#bookingDate').min=new Date().toISOString().slice(0,10);
  await Promise.all([loadLoyaltyProgram(),loadClientPortal(false)]);

  $('#services').addEventListener('click',e=>{const btn=e.target.closest('[data-service-id]');if(btn)chooseService(btn.dataset.serviceId)});
  $('#barbers').addEventListener('click',e=>{const btn=e.target.closest('[data-barber-id]');if(btn)chooseBarber(btn.dataset.barberId)});
  $('#slots').addEventListener('click',e=>{const btn=e.target.closest('[data-slot]');if(!btn)return;try{chooseSlot(JSON.parse(btn.dataset.slot))}catch{toast('Não foi possível selecionar este horário.','error')}});
  $('#bookingDate').addEventListener('change',loadSlots);
  $('#refreshClientPortal')?.addEventListener('click',()=>loadClientPortal(false));
  $('#openClientPortalAfterBooking')?.addEventListener('click',()=>loadClientPortal(true));
  $('#clientHistoryList')?.addEventListener('click',e=>{const btn=e.target.closest('[data-client-qr]');if(btn)openArrivalQrDialog(btn.dataset.clientQr,{service_name:btn.dataset.clientService,starts_at:btn.dataset.clientStart,barber_name:btn.dataset.clientBarber})});

  $('#bookingForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!booking.serviceId)return toast('Escolha um serviço.','error');if(!booking.barberId)return toast('Escolha um barbeiro.','error');if(!booking.slot)return toast('Escolha um horário.','error');
    const btn=$('#bookBtn');btn.disabled=true;const f=new FormData(e.target),phone=String(f.get('customerPhone')||'');
    const {data:id,error}=await sb.rpc('create_public_appointment',{p_slug:booking.slug,p_service_id:booking.serviceId,p_barber_id:booking.barberId,p_starts_at:booking.slot.starts_at,p_customer_name:f.get('customerName'),p_customer_phone:phone,p_customer_email:f.get('customerEmail')||null,p_notes:null});
    btn.disabled=false;if(error){toast(error.message,'error');return loadSlots()}
    $('#bookingSteps').classList.add('hidden');$('#successBox').classList.remove('hidden');setText('successId',id);
    const pass=await loadAppointmentPass(id,phone);if(pass)showSuccessPass(pass);
    await loadClientPortal(false);setTimeout(()=>$('#successBox')?.scrollIntoView({behavior:'smooth',block:'start'}),80);
  });
});
