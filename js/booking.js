let booking={slug:'',tenant:null,services:[],barbers:[],links:[],serviceId:'',barberId:'',preferredBarberId:'',date:'',slot:null,loyalty:null,clientPortal:null,activePass:null,checkinWatchTimer:null,emailVerified:false,emailVerifiedEmail:'',emailVerifiedPhone:''};
let customerAuthClient=null;
function esc(v){return String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}
function clientTokenKey(){return `na_regua_client_token_${booking.slug||'default'}`}
function verifiedEmailKey(){return `na_regua_verified_email_${booking.slug||'default'}`}
function normalizePhoneLocal(value){
  let digits=String(value||'').replace(/\D+/g,'');
  if(digits.startsWith('00'))digits=digits.slice(2);
  if(digits.length===10||digits.length===11)digits=`55${digits}`;
  return digits;
}
function normalizeEmail(value){return String(value||'').trim().toLowerCase()}
function getCustomerAuthClient(){
  if(customerAuthClient)return customerAuthClient;
  const cfg=window.APP_CONFIG||{};
  customerAuthClient=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  return customerAuthClient;
}
function setEmailVerificationState(state,message=''){
  const box=$('#emailVerificationBox'),status=$('#emailVerificationStatus'),codeArea=$('#emailCodeArea');
  if(!box)return;
  const loyaltyOn=booking.loyalty?.enabled===true;
  box.classList.toggle('hidden',!loyaltyOn);
  if(!loyaltyOn)return;
  status?.classList.remove('is-idle','is-sent','is-verified','is-error');
  status?.classList.add(`is-${state}`);
  const content={
    idle:['bi-envelope-check','E-mail ainda não validado.'],
    sent:['bi-envelope-paper-fill','Código enviado. Digite os 6 números recebidos no e-mail.'],
    verified:['bi-patch-check-fill','E-mail validado. Você está participando do programa de fidelidade.'],
    error:['bi-exclamation-triangle-fill',message||'Não foi possível validar o e-mail.']
  }[state]||['bi-envelope-check',message||''];
  if(status)status.innerHTML=`<i class="bi ${content[0]}" aria-hidden="true"></i><span>${esc(message||content[1])}</span>`;
  codeArea?.classList.toggle('hidden',!['sent','error'].includes(state));
  const send=$('#sendEmailCode');if(send)send.classList.toggle('hidden',state==='verified');
}
function syncEmailVerificationFromForm(){
  if(!booking.loyalty?.enabled){setEmailVerificationState('idle');return}
  const form=$('#bookingForm');if(!form)return;
  const phone=normalizePhoneLocal(form.elements.customerPhone?.value||'');
  const email=normalizeEmail(form.elements.customerEmail?.value||'');
  let saved={};
  try{saved=JSON.parse(localStorage.getItem(verifiedEmailKey())||'{}')||{}}catch{}
  const verified=Boolean(phone&&email&&saved.phone===phone&&saved.email===email);
  booking.emailVerified=verified;booking.emailVerifiedEmail=verified?email:'';booking.emailVerifiedPhone=verified?phone:'';
  setEmailVerificationState(verified?'verified':'idle');
}
async function sendEmailVerificationCode(){
  if(!booking.loyalty?.enabled)return toast('O programa de fidelidade não está ativo.','warn');
  const form=$('#bookingForm');
  const name=String(form?.elements.customerName?.value||'').trim();
  const phone=String(form?.elements.customerPhone?.value||'').trim();
  const email=normalizeEmail(form?.elements.customerEmail?.value||'');
  if(name.length<2)return toast('Informe seu nome antes de validar.','error');
  if(normalizePhoneLocal(phone).length<8)return toast('Informe seu WhatsApp/telefone antes de validar.','error');
  if(!/^\S+@\S+\.\S+$/.test(email))return toast('Informe um e-mail válido.','error');
  const btn=$('#sendEmailCode'),resend=$('#resendEmailCode');if(btn)btn.disabled=true;if(resend)resend.disabled=true;
  try{
    const authClient=getCustomerAuthClient();
    const {error}=await authClient.auth.signInWithOtp({email,options:{shouldCreateUser:true,data:{customer_name:name,booking_slug:booking.slug}}});
    if(error)throw error;
    booking.emailVerified=false;booking.emailVerifiedEmail='';booking.emailVerifiedPhone='';
    setEmailVerificationState('sent');
    $('#emailCode')?.focus();
    toast('Código enviado para seu e-mail.','success');
  }catch(err){setEmailVerificationState('error',err.message||'Não foi possível enviar o código.');toast(err.message||'Não foi possível enviar o código.','error')}
  finally{if(btn)btn.disabled=false;if(resend)resend.disabled=false}
}
async function confirmEmailVerificationCode(){
  const form=$('#bookingForm');
  const name=String(form?.elements.customerName?.value||'').trim();
  const phone=String(form?.elements.customerPhone?.value||'').trim();
  const email=normalizeEmail(form?.elements.customerEmail?.value||'');
  const code=String($('#emailCode')?.value||'').replace(/\D/g,'');
  if(!/^\S+@\S+\.\S+$/.test(email))return toast('Informe um e-mail válido.','error');
  if(code.length!==6)return toast('Digite o código de 6 números recebido no e-mail.','error');
  const btn=$('#verifyEmailCode');if(btn)btn.disabled=true;
  const authClient=getCustomerAuthClient();
  try{
    const {error:otpError}=await authClient.auth.verifyOtp({email,token:code,type:'email'});
    if(otpError)throw otpError;
    const {data,error}=await authClient.rpc('verify_loyalty_email',{p_slug:booking.slug,p_customer_name:name,p_customer_phone:phone,p_email:email});
    if(error)throw error;
    if(!data?.ok)throw new Error(data?.error||'Não foi possível liberar a fidelidade.');
    const normalizedPhone=String(data.phone_key||normalizePhoneLocal(phone));
    const normalizedEmail=String(data.email||email).toLowerCase();
    booking.emailVerified=true;booking.emailVerifiedEmail=normalizedEmail;booking.emailVerifiedPhone=normalizedPhone;
    localStorage.setItem(verifiedEmailKey(),JSON.stringify({email:normalizedEmail,phone:normalizedPhone}));
    if(data.customer_token)localStorage.setItem(clientTokenKey(),data.customer_token);
    setEmailVerificationState('verified');
    await loadClientPortal(false);
    toast('E-mail validado. Fidelidade liberada!','success');
  }catch(err){setEmailVerificationState('error',err.message||'Código inválido ou expirado.');toast(err.message||'Código inválido ou expirado.','error')}
  finally{
    try{await authClient.auth.signOut()}catch{}
    if(btn)btn.disabled=false;
  }
}
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
async function copyCheckinCodeFrom(elementId){
  const code=String(document.getElementById(elementId)?.textContent||'').trim();
  if(!code||code==='--------')return toast('Código de chegada indisponível.','error');
  let copied=false;
  try{
    if(navigator.clipboard?.writeText&&window.isSecureContext){await navigator.clipboard.writeText(code);copied=true}
  }catch{}
  if(!copied){
    try{
      const field=document.createElement('textarea');field.value=code;field.setAttribute('readonly','');field.style.position='fixed';field.style.opacity='0';field.style.pointerEvents='none';document.body.appendChild(field);field.select();field.setSelectionRange(0,field.value.length);copied=document.execCommand('copy');field.remove();
    }catch{}
  }
  toast(copied?'Código de chegada copiado.':'Não foi possível copiar o código. Copie manualmente.',copied?'success':'error');
}
function stopClientCheckinWatch(){
  if(booking.checkinWatchTimer){clearInterval(booking.checkinWatchTimer);booking.checkinWatchTimer=null}
}
function findPortalAppointment({appointmentId='',code=''}={}){
  const items=booking.clientPortal?.appointments||[];
  const wantedId=String(appointmentId||'').trim(),wantedCode=String(code||'').trim().toUpperCase();
  return items.find(a=>(wantedId&&String(a.id)===wantedId)||(wantedCode&&String(a.checkin_code||'').trim().toUpperCase()===wantedCode))||null;
}
function setCheckinLiveState(prefix,appointment){
  const box=document.getElementById(`${prefix}CheckinLive`);if(!box)return;
  const validated=Boolean(appointment?.validated_at);
  box.classList.toggle('is-validated',validated);
  box.classList.toggle('is-waiting',!validated);
  if(validated){
    const loyaltyCredited=appointment?.loyalty_credited===true;
    const emailVerified=appointment?.email_verified!==false;
    const detail=loyaltyCredited?'Sua chegada foi confirmada e esta visita foi registrada na fidelidade.':(!emailVerified?'Sua chegada foi confirmada. Como o e-mail não estava validado, esta visita não contou na fidelidade.':'Sua chegada foi confirmada pela barbearia.');
    box.innerHTML=`<i class="bi bi-check-circle-fill" aria-hidden="true"></i><div><strong>Chegada validada!</strong><span>${detail}</span></div>`;
  }else{
    box.innerHTML='<span class="checkin-live-pulse" aria-hidden="true"></span><div><strong>Aguardando validação</strong><span>Assim que o barbeiro validar seu QR, a confirmação aparecerá aqui automaticamente.</span></div>';
  }
}
async function refreshClientPortalData(){
  const token=(localStorage.getItem(clientTokenKey())||'').trim();
  if(!token)return null;
  const {data,error}=await sb.rpc('get_public_customer_portal',{p_slug:booking.slug,p_customer_token:token});
  if(error||!data){if(error)console.warn('Atualização do cliente indisponível:',error.message);return null}
  booking.clientPortal=data;renderClientPortal();return data;
}
function startClientCheckinWatch({appointmentId='',code='',prefix='arrivalQr'}={}){
  stopClientCheckinWatch();
  const update=async()=>{
    const dialog=document.getElementById(prefix==='success'?'bookingSuccessDialog':'arrivalQrDialog');
    if(!dialog?.open){stopClientCheckinWatch();return}
    let item=null;
    if(prefix==='success'&&booking.activePass?._phone){
      const {data}=await sb.rpc('get_public_appointment_pass',{p_slug:booking.slug,p_appointment_id:appointmentId,p_customer_phone:booking.activePass._phone});
      item=data||null;if(item)booking.activePass={...booking.activePass,...item};
    }else{
      await refreshClientPortalData();item=findPortalAppointment({appointmentId,code});
    }
    setCheckinLiveState(prefix,item);
    if(item?.validated_at){stopClientCheckinWatch()}
  };
  const initial=prefix==='success'?booking.activePass:findPortalAppointment({appointmentId,code});
  setCheckinLiveState(prefix,initial);
  if(initial?.validated_at)return;
  booking.checkinWatchTimer=setInterval(update,1000);
  setTimeout(update,150);
}
function closeArrivalQrDialog(){stopClientCheckinWatch();const dialog=$('#arrivalQrDialog');if(!dialog)return;try{if(dialog.open&&typeof dialog.close==='function')dialog.close()}catch{}dialog.removeAttribute('open')}
window.closeArrivalQrDialog=closeArrivalQrDialog;
function closeBookingSuccessDialog(){
  stopClientCheckinWatch();
  const dialog=$('#bookingSuccessDialog');if(!dialog)return;
  try{if(dialog.open&&typeof dialog.close==='function')dialog.close()}catch{}
  dialog.removeAttribute('open');
}
function openBookingSuccessDialog(){
  const dialog=$('#bookingSuccessDialog');if(!dialog)return;
  if(typeof dialog.showModal==='function'){if(!dialog.open)dialog.showModal()}else dialog.setAttribute('open','');
}
function resetBookingFlow(){
  booking.serviceId='';booking.barberId='';booking.date='';booking.slot=null;booking.emailVerified=false;booking.emailVerifiedEmail='';booking.emailVerifiedPhone='';
  $('#bookingForm')?.reset();setEmailVerificationState('idle');
  const date=$('#bookingDate');if(date)date.value='';
  const slots=$('#slots');if(slots)slots.innerHTML='';
  $('#barberSection')?.classList.add('hidden');
  $('#dateSection')?.classList.add('hidden');
  $('#customerSection')?.classList.add('hidden');
  renderServices();
}
window.closeBookingSuccessDialog=closeBookingSuccessDialog;
function openArrivalQrDialog(code,item={}){
  const dialog=$('#arrivalQrDialog');if(!dialog||!code)return;
  setText('arrivalQrTitle',item.service_name||'Seu agendamento');
  setText('arrivalQrMeta',`${bookingDateTime(item.starts_at)}${item.barber_name?` · ${item.barber_name}`:''}`);
  setText('arrivalQrShortCode',String(code).toUpperCase());renderQr('arrivalQrDialogCode',code);
  if(typeof dialog.showModal==='function'){if(!dialog.open)dialog.showModal()}else dialog.setAttribute('open','');
  startClientCheckinWatch({appointmentId:item.id||'',code,prefix:'arrivalQr'});
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
  booking.slot=s;$$('.slot').forEach(x=>x.classList.toggle('selected',x.dataset.start===s.starts_at));$('#customerSection').classList.remove('hidden');setText('selectedTime',s.local_time);syncEmailVerificationFromForm();
  setTimeout(()=>$('#customerSection')?.scrollIntoView({behavior:'smooth',block:'nearest'}),50);
}
function renderPublicLoyalty(){
  const banner=$('#publicLoyaltyBanner');
  if(!booking.loyalty?.enabled){banner?.classList.add('hidden');$('#emailVerificationBox')?.classList.add('hidden');return}
  banner?.classList.remove('hidden');
  setText('publicLoyaltyText',`Valide seu e-mail uma vez e, a cada ${booking.loyalty.visits_required} chegadas confirmadas, ganhe: ${booking.loyalty.reward_name}.`);
  syncEmailVerificationFromForm();
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
    return `<article class="client-history-item"><div class="client-history-date"><strong>${bookingDateTime(a.starts_at)}</strong><span class="badge ${bookingStatusClass(a.status)}">${bookingStatusLabel(a.status)}</span></div><div class="client-history-main"><strong>${esc(a.service_name||'Serviço')}</strong><span>${esc(a.barber_name||'Barbeiro')} · ${money(a.price_cents||0)}</span></div><div class="client-history-actions">${a.validated_at?'<span class="client-checkin-ok"><i class="bi bi-check-circle-fill"></i> Chegada validada</span>':future&&a.checkin_code?`<button type="button" class="btn btn-sm" data-client-id="${esc(a.id)}" data-client-qr="${esc(a.checkin_code)}" data-client-service="${esc(a.service_name||'Agendamento')}" data-client-start="${esc(a.starts_at)}" data-client-barber="${esc(a.barber_name||'')}"><i class="bi bi-qr-code"></i> QR de chegada</button>`:''}</div></article>`;
  }).join('')||'<div class="empty">Nenhum agendamento encontrado.</div>';
}
async function loadClientPortal(showCard=false){
  const data=await refreshClientPortalData();
  if(!data)return null;
  if(showCard)setTimeout(()=>$('#clientPortalCard')?.scrollIntoView({behavior:'smooth',block:'start'}),80);
  return data;
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
  data._phone=phone;return data;
}
function showSuccessPass(pass){
  if(!pass?.checkin_code)return;
  booking.activePass=pass;
  $('#successArrivalPass')?.classList.remove('hidden');
  const hasPortalToken=Boolean((localStorage.getItem(clientTokenKey())||'').trim());
  $('#openClientPortalAfterBooking')?.classList.toggle('hidden',!hasPortalToken);
  setText('successCheckinCode',String(pass.checkin_code).toUpperCase());renderQr('successQrCode',pass.checkin_code);
  const eligibility=$('#successLoyaltyEligibility');
  if(eligibility){
    const eligible=pass.email_verified===true&&pass.loyalty?.program_enabled===true;
    eligibility.className=`notice ${eligible?'notice-ok':'notice-warn'}`;
    eligibility.innerHTML=eligible?'<i class="bi bi-stars" aria-hidden="true"></i> E-mail validado: esta chegada poderá contar na fidelidade.':'<i class="bi bi-info-circle" aria-hidden="true"></i> Reserva confirmada normalmente. Sem e-mail validado, esta visita não entra no programa de fidelidade.';
  }
  setCheckinLiveState('success',pass);
}

document.addEventListener('DOMContentLoaded',async()=>{
  // Garante que os modais de confirmação e QR iniciem realmente fechados ao carregar/recarregar a página.
  closeBookingSuccessDialog();
  closeArrivalQrDialog();
  $('#arrivalQrCloseButton')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();closeArrivalQrDialog()});
  $('#bookingSuccessCloseButton')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();closeBookingSuccessDialog()});
  $('#copyArrivalQrShortCode')?.addEventListener('click',()=>copyCheckinCodeFrom('arrivalQrShortCode'));
  $('#copySuccessCheckinCode')?.addEventListener('click',()=>copyCheckinCodeFrom('successCheckinCode'));
  $('#sendEmailCode')?.addEventListener('click',sendEmailVerificationCode);
  $('#resendEmailCode')?.addEventListener('click',sendEmailVerificationCode);
  $('#verifyEmailCode')?.addEventListener('click',confirmEmailVerificationCode);
  $('#bookingForm')?.elements.customerPhone?.addEventListener('input',()=>{booking.emailVerified=false;booking.emailVerifiedEmail='';booking.emailVerifiedPhone='';syncEmailVerificationFromForm()});
  $('#bookingForm')?.elements.customerName?.addEventListener('input',()=>{if(booking.emailVerified)syncEmailVerificationFromForm()});
  $('#bookingForm')?.elements.customerEmail?.addEventListener('input',()=>{booking.emailVerified=false;booking.emailVerifiedEmail='';syncEmailVerificationFromForm()});
  $('#newBookingAfterSuccess')?.addEventListener('click',()=>{closeBookingSuccessDialog();setTimeout(()=>$('#services')?.scrollIntoView({behavior:'smooth',block:'start'}),30)});
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
  await Promise.all([loadLoyaltyProgram(),loadClientPortal(false)]);syncEmailVerificationFromForm();

  $('#services').addEventListener('click',e=>{const btn=e.target.closest('[data-service-id]');if(btn)chooseService(btn.dataset.serviceId)});
  $('#barbers').addEventListener('click',e=>{const btn=e.target.closest('[data-barber-id]');if(btn)chooseBarber(btn.dataset.barberId)});
  $('#slots').addEventListener('click',e=>{const btn=e.target.closest('[data-slot]');if(!btn)return;try{chooseSlot(JSON.parse(btn.dataset.slot))}catch{toast('Não foi possível selecionar este horário.','error')}});
  $('#bookingDate').addEventListener('change',loadSlots);
  $('#refreshClientPortal')?.addEventListener('click',()=>loadClientPortal(false));
  $('#openClientPortalAfterBooking')?.addEventListener('click',()=>{closeBookingSuccessDialog();loadClientPortal(true)});
  $('#clientHistoryList')?.addEventListener('click',e=>{const btn=e.target.closest('[data-client-qr]');if(btn)openArrivalQrDialog(btn.dataset.clientQr,{id:btn.dataset.clientId,service_name:btn.dataset.clientService,starts_at:btn.dataset.clientStart,barber_name:btn.dataset.clientBarber})});

  $('#bookingForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!booking.serviceId)return toast('Escolha um serviço.','error');if(!booking.barberId)return toast('Escolha um barbeiro.','error');if(!booking.slot)return toast('Escolha um horário.','error');
    const btn=$('#bookBtn');btn.disabled=true;const f=new FormData(e.target),phone=String(f.get('customerPhone')||'');
    const {data:id,error}=await sb.rpc('create_public_appointment',{p_slug:booking.slug,p_service_id:booking.serviceId,p_barber_id:booking.barberId,p_starts_at:booking.slot.starts_at,p_customer_name:f.get('customerName'),p_customer_phone:phone,p_customer_email:f.get('customerEmail')||null,p_notes:null});
    btn.disabled=false;if(error){toast(error.message,'error');return loadSlots()}
    setText('successId',id);
    $('#successArrivalPass')?.classList.add('hidden');
    $('#openClientPortalAfterBooking')?.classList.add('hidden');
    const successQr=$('#successQrCode');if(successQr)successQr.innerHTML='';
    setText('successCheckinCode','--------');
    const pass=await loadAppointmentPass(id,phone);if(pass)showSuccessPass(pass);
    await loadClientPortal(false);
    resetBookingFlow();
    openBookingSuccessDialog();
    if(pass?.checkin_code)startClientCheckinWatch({appointmentId:pass.appointment_id||id,code:pass.checkin_code,prefix:'success'});
  });
});
