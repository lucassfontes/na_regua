let booking={slug:'',tenant:null,services:[],barbers:[],links:[],serviceId:'',barberId:'',preferredBarberId:'',date:'',slot:null,loyalty:null,clientPortal:null,activePass:null,checkinWatchTimer:null,currentStep:1,phoneCountryIso:'',phoneCountryManual:false,phoneCountryDetectStarted:false};
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
    const detail=loyaltyCredited?'Sua chegada foi confirmada e esta visita foi registrada na fidelidade.':'Sua chegada foi confirmada pela barbearia.';
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
const bookingWizardMeta={
  1:{title:'1. Escolha o serviço',hint:'Toque no serviço desejado para continuar.'},
  2:{title:'2. Escolha o barbeiro',hint:'Escolha quem vai realizar o atendimento.'},
  3:{title:'3. Escolha data e horário',hint:'Escolha um dia e toque no horário que preferir.'},
  4:{title:'4. Seus dados',hint:'Confira o horário e informe seus dados para confirmar.'}
};
function showBookingStep(step){
  const n=Math.max(1,Math.min(4,Number(step)||1));booking.currentStep=n;
  $$('[data-booking-step]').forEach(el=>el.classList.toggle('hidden',Number(el.dataset.bookingStep)!==n));
  $$('[data-wizard-progress]').forEach(el=>{const s=Number(el.dataset.wizardProgress);el.classList.toggle('is-active',s===n);el.classList.toggle('is-done',s<n)});
  setText('bookingWizardTitle',bookingWizardMeta[n].title);setText('bookingWizardHint',bookingWizardMeta[n].hint);
  $('#bookingWizardBack')?.classList.toggle('hidden',n===1);
  const body=$('.booking-wizard-body');if(body)body.scrollTop=0;
  if(n===4)detectPhoneCountry();
}
function closeBookingWizard(){
  const dialog=$('#bookingWizardDialog');if(!dialog)return;
  try{if(dialog.open&&typeof dialog.close==='function')dialog.close()}catch{}
  dialog.removeAttribute('open');
}
function openBookingWizard(reset=true){
  const dialog=$('#bookingWizardDialog');if(!dialog)return;
  if(reset)resetBookingFlow();
  showBookingStep(reset?1:booking.currentStep||1);
  if(typeof dialog.showModal==='function'){if(!dialog.open)dialog.showModal()}else dialog.setAttribute('open','');
}
function goBackBookingStep(){
  if(booking.currentStep===4)return showBookingStep(3);
  if(booking.currentStep===3)return showBookingStep(booking.preferredBarberId?1:2);
  if(booking.currentStep===2)return showBookingStep(1);
}
window.closeBookingWizard=closeBookingWizard;
function resetBookingFlow(){
  booking.serviceId='';booking.barberId='';booking.date='';booking.slot=null;booking.currentStep=1;booking.phoneCountryManual=false;
  $('#bookingForm')?.reset();
  if($('#customerCountry'))renderPhoneCountries(booking.phoneCountryIso||countryFromBrowserLocale());
  const date=$('#bookingDate');if(date)date.value='';
  const quick=$('#bookingQuickDates');if(quick)quick.innerHTML='';
  $('#bookingTimeArea')?.classList.add('hidden');
  const slots=$('#slots');if(slots)slots.innerHTML='';
  renderServices();
  const barbers=$('#barbers');if(barbers)barbers.innerHTML='';
  showBookingStep(1);
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
  if(!booking.serviceId){if(section)section.classList.add('hidden');return}
  const list=getAvailableBarbersForService();const box=$('#barbers');
  if(!list.length){box.innerHTML='<div class="notice notice-warn">Nenhum barbeiro ativo está disponível para este serviço.</div>';return}
  box.innerHTML=list.map(b=>`<button type="button" class="booking-option barber-option ${booking.barberId===b.id?'selected':''}" data-barber-id="${b.id}"><div class="booking-option-row"><div><strong>${esc(b.full_name)}</strong><div class="small muted">Toque para escolher este profissional</div></div>${booking.barberId===b.id?'<span class="booking-check">✓</span>':''}</div></button>`).join('');
}
function chooseService(id){
  booking.serviceId=id;booking.barberId='';booking.slot=null;booking.date='';
  const available=getAvailableBarbersForService();
  if(booking.preferredBarberId&&available.some(b=>b.id===booking.preferredBarberId))booking.barberId=booking.preferredBarberId;
  renderServices();renderBarbers();
  $('#bookingDate').value='';$('#slots').innerHTML='';$('#bookingTimeArea')?.classList.add('hidden');
  showBookingStep(booking.barberId?3:2);
  if(booking.barberId)prepareEasyDateTime();
}
function chooseBarber(id){
  if(!getAvailableBarbersForService().some(b=>b.id===id))return;
  booking.barberId=id;booking.slot=null;renderBarbers();$('#slots').innerHTML='';$('#bookingTimeArea')?.classList.add('hidden');
  showBookingStep(3);
  prepareEasyDateTime();
}
function localDateValue(date){
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function parseDateValue(value){
  const [y,m,d]=String(value||'').split('-').map(Number);return y&&m&&d?new Date(y,m-1,d):null;
}
function friendlyDate(value){
  const d=parseDateValue(value);if(!d)return '';
  return new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long'}).format(d).replace(/^./,c=>c.toUpperCase());
}
function centerSelectedQuickDate(behavior='smooth'){
  const box=$('#bookingQuickDates'),selected=box?.querySelector('.booking-date-card.selected');
  if(!box||!selected)return;
  requestAnimationFrame(()=>{try{selected.scrollIntoView({behavior,block:'nearest',inline:'center'})}catch{box.scrollTo({left:selected.offsetLeft-(box.clientWidth-selected.offsetWidth)/2,behavior})}});
}
function renderQuickDates(){
  const box=$('#bookingQuickDates');if(!box)return;
  const today=new Date();today.setHours(0,0,0,0);
  const fmtWeek=new Intl.DateTimeFormat('pt-BR',{weekday:'short'}),fmtMonth=new Intl.DateTimeFormat('pt-BR',{month:'short'});
  const values=[];
  // Mantém dias anteriores visíveis à esquerda para o primeiro dia útil poder ficar centralizado
  // sem criar espaço em branco no carrossel. Esses dias são apenas visuais e não podem ser escolhidos.
  for(let i=-7;i<32;i++){
    const d=new Date(today);d.setDate(today.getDate()+i);
    values.push({value:localDateValue(d),d,i,disabled:i<0});
  }
  box.innerHTML=values.map(({value,d,i,disabled})=>`<button type="button" class="booking-date-card ${booking.date===value?'selected':''}${disabled?' is-disabled':''}" data-date-value="${value}" ${disabled?'disabled aria-disabled="true"':'data-booking-date="'+value+'"'}><span>${i===0?'Hoje':i===1?'Amanhã':esc(fmtWeek.format(d).replace('.',''))}</span><strong>${String(d.getDate()).padStart(2,'0')}</strong><small>${esc(fmtMonth.format(d).replace('.',''))}</small></button>`).join('');
  if(booking.date)centerSelectedQuickDate('auto');
}
function syncSelectedDateUi(){
  const box=$('#bookingQuickDates');
  // Não recria o carrossel a cada toque. Isso mantém a inércia e evita qualquer "trava" visual.
  if(box&&!box.children.length)renderQuickDates();
  else box?.querySelectorAll('.booking-date-card').forEach(card=>card.classList.toggle('selected',card.dataset.dateValue===booking.date));
  const input=$('#bookingDate');if(input&&booking.date)input.value=booking.date;
  setText('bookingSelectedDateLabel',booking.date?friendlyDate(booking.date):'Horários disponíveis');
  centerSelectedQuickDate();
}
async function selectBookingDate(value){
  if(!value)return;
  booking.date=value;booking.slot=null;syncSelectedDateUi();
  $('#bookingTimeArea')?.classList.remove('hidden');
  await loadSlots();
}
async function prepareEasyDateTime(){
  renderQuickDates();
  if(booking.date){syncSelectedDateUi();return loadSlots()}
  const today=localDateValue(new Date());
  await selectBookingDate(today);
}
function slotHour(slot){
  const t=String(slot?.local_time||'');const m=t.match(/(\d{1,2}):(\d{2})/);return m?Number(m[1]):12;
}
let timeWheelScrollTimer=null;
let timeWheelRecenterTimer=null;
let timeWheelRaf=0;
let timeWheelLastStart='';
let timeWheelUserInteracted=false;
let timeWheelLastHapticAt=0;
let timeWheelLastIndex=-1;

function timeWheelHaptic(){
  if(!timeWheelUserInteracted)return;
  const now=performance.now();if(now-timeWheelLastHapticAt<90)return;timeWheelLastHapticAt=now;
  try{if(typeof navigator.vibrate==='function')navigator.vibrate(5)}catch{}
}
function timeWheelCopiesFor(count){
  let copies=Math.max(9,Math.ceil(90/Math.max(1,count)));
  copies=Math.min(19,copies);if(copies%2===0)copies++;return copies;
}
function renderTimeWheel(list){
  const copies=timeWheelCopiesFor(list.length),middle=Math.floor(copies/2);
  const items=Array.from({length:copies},(_,copy)=>list.map((s,i)=>`<button type="button" class="slot booking-time-wheel-item" data-wheel-copy="${copy}" data-wheel-index="${i}" data-start="${s.starts_at}" data-slot='${esc(JSON.stringify(s))}'>${esc(s.local_time)}</button>`).join('')).join('');
  return `<div class="booking-time-wheel-wrap"><div class="booking-time-wheel-fade booking-time-wheel-fade-top" aria-hidden="true"></div><div class="booking-time-wheel-center" aria-hidden="true"></div><div id="bookingTimeWheel" class="booking-time-wheel" role="listbox" aria-label="Horários disponíveis" data-wheel-count="${list.length}" data-wheel-copies="${copies}" data-wheel-middle="${middle}"><div class="booking-time-wheel-spacer" aria-hidden="true"></div>${items}<div class="booking-time-wheel-spacer" aria-hidden="true"></div></div><div class="booking-time-wheel-fade booking-time-wheel-fade-bottom" aria-hidden="true"></div></div><button id="bookingTimeContinue" type="button" class="btn booking-time-continue"><i class="bi bi-check2" aria-hidden="true"></i> Continuar com <strong id="bookingWheelSelectedLabel">${esc(list[0]?.local_time||'')}</strong></button>`;
}
function getTimeWheelItems(){return Array.from($('#bookingTimeWheel')?.querySelectorAll('.booking-time-wheel-item')||[])}
function scrollWheelItemToCenter(item,behavior='smooth'){
  const wheel=$('#bookingTimeWheel');if(!wheel||!item)return;
  const top=item.offsetTop-(wheel.clientHeight-item.offsetHeight)/2;
  try{wheel.scrollTo({top,behavior})}catch{wheel.scrollTop=top}
}
function setWheelSelectedItem(item,{scroll=false,haptic=false}={}){
  if(!item)return;
  const wheel=$('#bookingTimeWheel'),previous=wheel?.querySelector('.booking-time-wheel-item.is-wheel-selected');
  if(previous!==item){previous?.classList.remove('is-wheel-selected');item.classList.add('is-wheel-selected')}
  let slot=null;try{slot=JSON.parse(item.dataset.slot)}catch{return}
  const changed=timeWheelLastStart!==String(slot?.starts_at||item.dataset.start||'');
  booking.slot=slot;timeWheelLastStart=String(slot?.starts_at||item.dataset.start||'');
  setText('bookingWheelSelectedLabel',booking.slot?.local_time||'');
  if(changed&&haptic)timeWheelHaptic();
  if(scroll)scrollWheelItemToCenter(item,'smooth');
}
function getNearestTimeWheelItem(){
  const wheel=$('#bookingTimeWheel');if(!wheel)return null;
  const items=getTimeWheelItems();if(!items.length)return null;
  const first=items[0],height=first.offsetHeight||56,centerY=wheel.scrollTop+wheel.clientHeight/2;
  const index=Math.max(0,Math.min(items.length-1,Math.round((centerY-(first.offsetTop+height/2))/height)));
  return items[index]||null;
}
function syncTimeWheelSelection(){
  const wheel=$('#bookingTimeWheel');if(!wheel)return;
  const items=getTimeWheelItems();if(!items.length)return;
  const first=items[0],height=first.offsetHeight||56,centerY=wheel.scrollTop+wheel.clientHeight/2;
  const index=Math.max(0,Math.min(items.length-1,Math.round((centerY-(first.offsetTop+height/2))/height)));
  if(index===timeWheelLastIndex)return;timeWheelLastIndex=index;
  const item=items[index];if(item)setWheelSelectedItem(item,{haptic:false});
}
function recenterInfiniteTimeWheel(){
  const wheel=$('#bookingTimeWheel');if(!wheel)return;
  const selected=wheel.querySelector('.booking-time-wheel-item.is-wheel-selected')||getNearestTimeWheelItem();if(!selected)return;
  const middle=Number(wheel.dataset.wheelMiddle||0),copy=Number(selected.dataset.wheelCopy||0),logical=selected.dataset.wheelIndex;
  if(Math.abs(copy-middle)<2)return;
  const target=wheel.querySelector(`.booking-time-wheel-item[data-wheel-copy="${middle}"][data-wheel-index="${logical}"]`);if(!target)return;
  const delta=target.offsetTop-selected.offsetTop;
  wheel.scrollTop+=delta;timeWheelLastIndex=-1;setWheelSelectedItem(target,{haptic:false});
}
function settleTimeWheel(){
  clearTimeout(timeWheelScrollTimer);clearTimeout(timeWheelRecenterTimer);
  const item=getNearestTimeWheelItem();if(!item)return;
  const wheel=$('#bookingTimeWheel'),targetTop=item.offsetTop-(wheel.clientHeight-item.offsetHeight)/2;
  const distance=Math.abs(wheel.scrollTop-targetTop);
  setWheelSelectedItem(item,{haptic:true});
  if(distance>1.5)scrollWheelItemToCenter(item,'smooth');
  timeWheelRecenterTimer=setTimeout(recenterInfiniteTimeWheel,420);
}
function initTimeWheel(){
  const wheel=$('#bookingTimeWheel');if(!wheel)return;
  timeWheelUserInteracted=false;timeWheelLastStart='';timeWheelLastIndex=-1;
  const middle=Number(wheel.dataset.wheelMiddle||0),desiredStart=booking.slot?.starts_at;
  let initial=desiredStart?wheel.querySelector(`.booking-time-wheel-item[data-wheel-copy="${middle}"][data-start="${CSS.escape(String(desiredStart))}"]`):null;
  if(!initial)initial=wheel.querySelector(`.booking-time-wheel-item[data-wheel-copy="${middle}"][data-wheel-index="0"]`);
  requestAnimationFrame(()=>{if(!initial)return;scrollWheelItemToCenter(initial,'auto');setWheelSelectedItem(initial,{haptic:false});timeWheelLastIndex=getTimeWheelItems().indexOf(initial)});
  const markInteraction=()=>{timeWheelUserInteracted=true;clearTimeout(timeWheelRecenterTimer)};
  wheel.addEventListener('touchstart',markInteraction,{passive:true});wheel.addEventListener('pointerdown',markInteraction,{passive:true});wheel.addEventListener('wheel',markInteraction,{passive:true});
  wheel.addEventListener('scroll',()=>{
    if(!timeWheelRaf)timeWheelRaf=requestAnimationFrame(()=>{timeWheelRaf=0;syncTimeWheelSelection()});
    clearTimeout(timeWheelScrollTimer);timeWheelScrollTimer=setTimeout(settleTimeWheel,190);
  },{passive:true});
  if('onscrollend' in wheel)wheel.addEventListener('scrollend',()=>{clearTimeout(timeWheelScrollTimer);settleTimeWheel()},{passive:true});
  wheel.addEventListener('click',e=>{const item=e.target.closest('.booking-time-wheel-item');if(!item)return;markInteraction();setWheelSelectedItem(item,{scroll:true,haptic:true})});
  wheel.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();markInteraction();const items=getTimeWheelItems(),current=wheel.querySelector('.booking-time-wheel-item.is-wheel-selected');const i=Math.max(0,items.indexOf(current)),next=items[Math.max(0,Math.min(items.length-1,i+(e.key==='ArrowDown'?1:-1)))];if(next)setWheelSelectedItem(next,{scroll:true,haptic:true})});
  $('#bookingTimeContinue')?.addEventListener('click',()=>{if(booking.slot)chooseSlot(booking.slot)});
}
let slotLoadSequence=0;
function setSlotsLoading(active){
  const slots=$('#slots');if(!slots)return;
  slots.classList.toggle('is-loading',Boolean(active));
  let overlay=slots.querySelector('.booking-slots-loading-overlay');
  if(active){
    if(!overlay){overlay=document.createElement('div');overlay.className='booking-slots-loading-overlay';overlay.innerHTML='<span class="spinner" aria-hidden="true"></span><span>Atualizando horários...</span>';slots.appendChild(overlay)}
  }else overlay?.remove();
}
async function loadSlots(){
  if(!booking.date)booking.date=$('#bookingDate')?.value||'';booking.slot=null;
  if(!booking.serviceId)return toast('Escolha um serviço primeiro.','error');
  if(!booking.barberId)return toast('Escolha um barbeiro primeiro.','error');
  if(!booking.date)return;
  syncSelectedDateUi();$('#bookingTimeArea')?.classList.remove('hidden');
  const slots=$('#slots');
  const requestDate=booking.date,seq=++slotLoadSequence;
  // Não apaga os horários atuais durante a troca de dia. Mantém o seletor estável
  // e exibe apenas uma camada discreta até os novos horários chegarem.
  if(slots&&!slots.children.length)slots.innerHTML='<div class="booking-slots-loading booking-slots-loading-initial"><span class="spinner" aria-hidden="true"></span><span>Buscando horários...</span></div>';
  else setSlotsLoading(true);
  const {data,error}=await sb.rpc('get_public_available_slots',{p_slug:booking.slug,p_service_id:booking.serviceId,p_barber_id:booking.barberId,p_date:requestDate,p_step_minutes:15});
  if(seq!==slotLoadSequence||requestDate!==booking.date)return;
  setSlotsLoading(false);
  if(error){if(slots?.querySelector('.booking-slots-loading-initial'))slots.innerHTML='';toast(error.message,'error');return}
  const list=data||[];
  if(!list.length){
    slots.innerHTML='<div class="booking-no-slots"><i class="bi bi-calendar-x" aria-hidden="true"></i><div><strong>Sem horários neste dia</strong><span>Escolha outro dia acima para ver novas opções.</span></div></div>';return;
  }
  slots.innerHTML=renderTimeWheel(list);
  initTimeWheel();
}
function chooseSlot(s){
  booking.slot=s;
  // O seletor em rolagem usa apenas is-wheel-selected. A classe genérica
  // .selected deixa o botão preto e não deve permanecer ao voltar para a etapa 3.
  $$('.booking-time-wheel-item').forEach(x=>x.classList.remove('selected'));
  $$('.slot:not(.booking-time-wheel-item)').forEach(x=>x.classList.toggle('selected',x.dataset.start===s.starts_at));
  setText('selectedTime',`${friendlyDate(booking.date)} · ${s.local_time}`);
  showBookingStep(4);
}
function renderPublicLoyalty(){
  const banner=$('#publicLoyaltyBanner');
  if(!booking.loyalty?.enabled){banner?.classList.add('hidden');return}
  banner?.classList.remove('hidden');
  setText('publicLoyaltyText',`Seu número de WhatsApp identifica sua fidelidade. A cada ${booking.loyalty.visits_required} chegadas confirmadas, ganhe: ${booking.loyalty.reward_name}. Use sempre o mesmo número para manter seu histórico e seus pontos.`);
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
let PHONE_EXAMPLES={};
let phoneExamplesPromise=null;
const PHONE_COUNTRIES=[{"iso":"AF","name":"Afeganistão","dial":"+93"},{"iso":"AL","name":"Albânia","dial":"+355"},{"iso":"DE","name":"Alemanha","dial":"+49"},{"iso":"AO","name":"Angola","dial":"+244"},{"iso":"AI","name":"Anguila","dial":"+1"},{"iso":"AG","name":"Antígua e Barbuda","dial":"+1"},{"iso":"AR","name":"Argentina","dial":"+54"},{"iso":"DZ","name":"Argélia","dial":"+213"},{"iso":"AM","name":"Armênia","dial":"+374"},{"iso":"AW","name":"Aruba","dial":"+297"},{"iso":"SA","name":"Arábia Saudita","dial":"+966"},{"iso":"AU","name":"Austrália","dial":"+61"},{"iso":"AZ","name":"Azerbaijão","dial":"+994"},{"iso":"BS","name":"Bahamas","dial":"+1"},{"iso":"BD","name":"Bangladesh","dial":"+880"},{"iso":"BB","name":"Barbados","dial":"+1"},{"iso":"BH","name":"Barein","dial":"+973"},{"iso":"BZ","name":"Belize","dial":"+501"},{"iso":"BJ","name":"Benin","dial":"+229"},{"iso":"BM","name":"Bermudas","dial":"+1"},{"iso":"BY","name":"Bielorrússia","dial":"+375"},{"iso":"BO","name":"Bolívia","dial":"+591"},{"iso":"BW","name":"Botsuana","dial":"+267"},{"iso":"BR","name":"Brasil","dial":"+55"},{"iso":"BN","name":"Brunei","dial":"+673"},{"iso":"BG","name":"Bulgária","dial":"+359"},{"iso":"BF","name":"Burquina Faso","dial":"+226"},{"iso":"BI","name":"Burundi","dial":"+257"},{"iso":"BT","name":"Butão","dial":"+975"},{"iso":"BE","name":"Bélgica","dial":"+32"},{"iso":"BA","name":"Bósnia e Herzegovina","dial":"+387"},{"iso":"CV","name":"Cabo Verde","dial":"+238"},{"iso":"CM","name":"Camarões","dial":"+237"},{"iso":"KH","name":"Camboja","dial":"+855"},{"iso":"CA","name":"Canadá","dial":"+1"},{"iso":"QA","name":"Catar","dial":"+974"},{"iso":"KZ","name":"Cazaquistão","dial":"+7"},{"iso":"TD","name":"Chade","dial":"+235"},{"iso":"CL","name":"Chile","dial":"+56"},{"iso":"CN","name":"China","dial":"+86"},{"iso":"CY","name":"Chipre","dial":"+357"},{"iso":"CO","name":"Colômbia","dial":"+57"},{"iso":"KM","name":"Comores","dial":"+269"},{"iso":"CD","name":"Congo - Kinshasa","dial":"+243"},{"iso":"KP","name":"Coreia do Norte","dial":"+850"},{"iso":"KR","name":"Coreia do Sul","dial":"+82"},{"iso":"CI","name":"Costa do Marfim","dial":"+225"},{"iso":"CR","name":"Costa Rica","dial":"+506"},{"iso":"HR","name":"Croácia","dial":"+385"},{"iso":"CU","name":"Cuba","dial":"+53"},{"iso":"DK","name":"Dinamarca","dial":"+45"},{"iso":"DJ","name":"Djibuti","dial":"+253"},{"iso":"DM","name":"Dominica","dial":"+1"},{"iso":"EG","name":"Egito","dial":"+20"},{"iso":"SV","name":"El Salvador","dial":"+503"},{"iso":"AE","name":"Emirados Árabes Unidos","dial":"+971"},{"iso":"EC","name":"Equador","dial":"+593"},{"iso":"ER","name":"Eritreia","dial":"+291"},{"iso":"SK","name":"Eslováquia","dial":"+421"},{"iso":"SI","name":"Eslovênia","dial":"+386"},{"iso":"ES","name":"Espanha","dial":"+34"},{"iso":"SZ","name":"Essuatíni","dial":"+268"},{"iso":"US","name":"Estados Unidos","dial":"+1"},{"iso":"EE","name":"Estônia","dial":"+372"},{"iso":"ET","name":"Etiópia","dial":"+251"},{"iso":"FJ","name":"Fiji","dial":"+679"},{"iso":"PH","name":"Filipinas","dial":"+63"},{"iso":"FI","name":"Finlândia","dial":"+358"},{"iso":"FR","name":"França","dial":"+33"},{"iso":"GA","name":"Gabão","dial":"+241"},{"iso":"GH","name":"Gana","dial":"+233"},{"iso":"GE","name":"Geórgia","dial":"+995"},{"iso":"GI","name":"Gibraltar","dial":"+350"},{"iso":"GD","name":"Granada","dial":"+1"},{"iso":"GL","name":"Groenlândia","dial":"+299"},{"iso":"GR","name":"Grécia","dial":"+30"},{"iso":"GP","name":"Guadalupe","dial":"+590"},{"iso":"GU","name":"Guam","dial":"+1"},{"iso":"GT","name":"Guatemala","dial":"+502"},{"iso":"GG","name":"Guernsey","dial":"+44"},{"iso":"GY","name":"Guiana","dial":"+592"},{"iso":"GF","name":"Guiana Francesa","dial":"+594"},{"iso":"GN","name":"Guiné","dial":"+224"},{"iso":"GQ","name":"Guiné Equatorial","dial":"+240"},{"iso":"GW","name":"Guiné-Bissau","dial":"+245"},{"iso":"GM","name":"Gâmbia","dial":"+220"},{"iso":"HT","name":"Haiti","dial":"+509"},{"iso":"HN","name":"Honduras","dial":"+504"},{"iso":"HK","name":"Hong Kong, RAE da China","dial":"+852"},{"iso":"HU","name":"Hungria","dial":"+36"},{"iso":"CX","name":"Ilha Christmas","dial":"+61"},{"iso":"IM","name":"Ilha de Man","dial":"+44"},{"iso":"NF","name":"Ilha Norfolk","dial":"+672"},{"iso":"KY","name":"Ilhas Cayman","dial":"+1"},{"iso":"CC","name":"Ilhas Cocos (Keeling)","dial":"+61"},{"iso":"CK","name":"Ilhas Cook","dial":"+682"},{"iso":"FO","name":"Ilhas Faroé","dial":"+298"},{"iso":"GS","name":"Ilhas Geórgia do Sul e Sandwich do Sul","dial":"+500"},{"iso":"FK","name":"Ilhas Malvinas","dial":"+500"},{"iso":"MP","name":"Ilhas Marianas do Norte","dial":"+1"},{"iso":"MH","name":"Ilhas Marshall","dial":"+692"},{"iso":"PN","name":"Ilhas Pitcairn","dial":"+64"},{"iso":"SB","name":"Ilhas Salomão","dial":"+677"},{"iso":"ID","name":"Indonésia","dial":"+62"},{"iso":"IQ","name":"Iraque","dial":"+964"},{"iso":"IE","name":"Irlanda","dial":"+353"},{"iso":"IR","name":"Irã","dial":"+98"},{"iso":"IS","name":"Islândia","dial":"+354"},{"iso":"IL","name":"Israel","dial":"+972"},{"iso":"IT","name":"Itália","dial":"+39"},{"iso":"YE","name":"Iêmen","dial":"+967"},{"iso":"JM","name":"Jamaica","dial":"+1"},{"iso":"JP","name":"Japão","dial":"+81"},{"iso":"JE","name":"Jersey","dial":"+44"},{"iso":"JO","name":"Jordânia","dial":"+962"},{"iso":"XK","name":"Kosovo","dial":"+383"},{"iso":"KW","name":"Kuwait","dial":"+965"},{"iso":"LA","name":"Laos","dial":"+856"},{"iso":"LS","name":"Lesoto","dial":"+266"},{"iso":"LV","name":"Letônia","dial":"+371"},{"iso":"LR","name":"Libéria","dial":"+231"},{"iso":"LI","name":"Liechtenstein","dial":"+423"},{"iso":"LT","name":"Lituânia","dial":"+370"},{"iso":"LU","name":"Luxemburgo","dial":"+352"},{"iso":"LB","name":"Líbano","dial":"+961"},{"iso":"LY","name":"Líbia","dial":"+218"},{"iso":"MO","name":"Macau, RAE da China","dial":"+853"},{"iso":"MK","name":"Macedônia do Norte","dial":"+389"},{"iso":"MG","name":"Madagascar","dial":"+261"},{"iso":"MW","name":"Malaui","dial":"+265"},{"iso":"MV","name":"Maldivas","dial":"+960"},{"iso":"ML","name":"Mali","dial":"+223"},{"iso":"MT","name":"Malta","dial":"+356"},{"iso":"MY","name":"Malásia","dial":"+60"},{"iso":"MA","name":"Marrocos","dial":"+212"},{"iso":"MQ","name":"Martinica","dial":"+596"},{"iso":"MR","name":"Mauritânia","dial":"+222"},{"iso":"MU","name":"Maurício","dial":"+230"},{"iso":"YT","name":"Mayotte","dial":"+262"},{"iso":"FM","name":"Micronésia","dial":"+691"},{"iso":"MD","name":"Moldávia","dial":"+373"},{"iso":"MN","name":"Mongólia","dial":"+976"},{"iso":"MS","name":"Montserrat","dial":"+1"},{"iso":"MZ","name":"Moçambique","dial":"+258"},{"iso":"MX","name":"México","dial":"+52"},{"iso":"MC","name":"Mônaco","dial":"+377"},{"iso":"NA","name":"Namíbia","dial":"+264"},{"iso":"NR","name":"Nauru","dial":"+674"},{"iso":"NP","name":"Nepal","dial":"+977"},{"iso":"NI","name":"Nicarágua","dial":"+505"},{"iso":"NG","name":"Nigéria","dial":"+234"},{"iso":"NU","name":"Niue","dial":"+683"},{"iso":"NO","name":"Noruega","dial":"+47"},{"iso":"NC","name":"Nova Caledônia","dial":"+687"},{"iso":"NZ","name":"Nova Zelândia","dial":"+64"},{"iso":"NE","name":"Níger","dial":"+227"},{"iso":"OM","name":"Omã","dial":"+968"},{"iso":"PW","name":"Palau","dial":"+680"},{"iso":"PA","name":"Panamá","dial":"+507"},{"iso":"PG","name":"Papua-Nova Guiné","dial":"+675"},{"iso":"PK","name":"Paquistão","dial":"+92"},{"iso":"PY","name":"Paraguai","dial":"+595"},{"iso":"NL","name":"Países Baixos","dial":"+31"},{"iso":"PE","name":"Peru","dial":"+51"},{"iso":"PF","name":"Polinésia Francesa","dial":"+689"},{"iso":"PL","name":"Polônia","dial":"+48"},{"iso":"PR","name":"Porto Rico","dial":"+1"},{"iso":"PT","name":"Portugal","dial":"+351"},{"iso":"KG","name":"Quirguistão","dial":"+996"},{"iso":"KI","name":"Quiribati","dial":"+686"},{"iso":"KE","name":"Quênia","dial":"+254"},{"iso":"GB","name":"Reino Unido","dial":"+44"},{"iso":"CF","name":"República Centro-Africana","dial":"+236"},{"iso":"CG","name":"República do Congo","dial":"+242"},{"iso":"DO","name":"República Dominicana","dial":"+1"},{"iso":"RE","name":"Reunião","dial":"+262"},{"iso":"RO","name":"Romênia","dial":"+40"},{"iso":"RW","name":"Ruanda","dial":"+250"},{"iso":"RU","name":"Rússia","dial":"+7"},{"iso":"EH","name":"Saara Ocidental","dial":"+212"},{"iso":"WS","name":"Samoa","dial":"+685"},{"iso":"AS","name":"Samoa Americana","dial":"+1"},{"iso":"SM","name":"San Marino","dial":"+378"},{"iso":"SH","name":"Santa Helena","dial":"+290"},{"iso":"LC","name":"Santa Lúcia","dial":"+1"},{"iso":"SC","name":"Seicheles","dial":"+248"},{"iso":"SN","name":"Senegal","dial":"+221"},{"iso":"SL","name":"Serra Leoa","dial":"+232"},{"iso":"SG","name":"Singapura","dial":"+65"},{"iso":"SO","name":"Somália","dial":"+252"},{"iso":"LK","name":"Sri Lanka","dial":"+94"},{"iso":"SD","name":"Sudão","dial":"+249"},{"iso":"SS","name":"Sudão do Sul","dial":"+211"},{"iso":"SR","name":"Suriname","dial":"+597"},{"iso":"SE","name":"Suécia","dial":"+46"},{"iso":"CH","name":"Suíça","dial":"+41"},{"iso":"SJ","name":"Svalbard e Jan Mayen","dial":"+47"},{"iso":"KN","name":"São Cristóvão e Névis","dial":"+1"},{"iso":"PM","name":"São Pedro e Miquelão","dial":"+508"},{"iso":"ST","name":"São Tomé e Príncipe","dial":"+239"},{"iso":"VC","name":"São Vicente e Granadinas","dial":"+1"},{"iso":"RS","name":"Sérvia","dial":"+381"},{"iso":"SY","name":"Síria","dial":"+963"},{"iso":"TJ","name":"Tadjiquistão","dial":"+992"},{"iso":"TH","name":"Tailândia","dial":"+66"},{"iso":"TW","name":"Taiwan","dial":"+886"},{"iso":"TZ","name":"Tanzânia","dial":"+255"},{"iso":"CZ","name":"Tchéquia","dial":"+420"},{"iso":"IO","name":"Território Britânico do Oceano Índico","dial":"+246"},{"iso":"TL","name":"Timor-Leste","dial":"+670"},{"iso":"TG","name":"Togo","dial":"+228"},{"iso":"TK","name":"Tokelau","dial":"+690"},{"iso":"TO","name":"Tonga","dial":"+676"},{"iso":"TT","name":"Trinidad e Tobago","dial":"+1"},{"iso":"TN","name":"Tunísia","dial":"+216"},{"iso":"TM","name":"Turcomenistão","dial":"+993"},{"iso":"TR","name":"Turquia","dial":"+90"},{"iso":"TV","name":"Tuvalu","dial":"+688"},{"iso":"UA","name":"Ucrânia","dial":"+380"},{"iso":"UG","name":"Uganda","dial":"+256"},{"iso":"UY","name":"Uruguai","dial":"+598"},{"iso":"UZ","name":"Uzbequistão","dial":"+998"},{"iso":"VU","name":"Vanuatu","dial":"+678"},{"iso":"VE","name":"Venezuela","dial":"+58"},{"iso":"VN","name":"Vietnã","dial":"+84"},{"iso":"WF","name":"Wallis e Futuna","dial":"+681"},{"iso":"ZW","name":"Zimbábue","dial":"+263"},{"iso":"ZM","name":"Zâmbia","dial":"+260"},{"iso":"ZA","name":"África do Sul","dial":"+27"},{"iso":"AT","name":"Áustria","dial":"+43"},{"iso":"IN","name":"Índia","dial":"+91"}];
function phoneFlag(iso){
  return String(iso||'').toUpperCase().replace(/[A-Z]/g,c=>String.fromCodePoint(127397+c.charCodeAt(0)));
}
function findPhoneCountry(iso){return PHONE_COUNTRIES.find(c=>c.iso===String(iso||'').toUpperCase())||null}
function countryFromBrowserLocale(){
  const langs=[...(navigator.languages||[]),navigator.language].filter(Boolean);
  for(const lang of langs){
    const m=String(lang).match(/[-_]([A-Za-z]{2})(?:$|[-_])/);if(m&&findPhoneCountry(m[1]))return m[1].toUpperCase();
  }
  const tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';
  const timezoneCountry={'Europe/Brussels':'BE','America/Sao_Paulo':'BR','America/Belem':'BR','America/Fortaleza':'BR','America/Manaus':'BR','America/Recife':'BR','Europe/Lisbon':'PT','Europe/Paris':'FR','Europe/Amsterdam':'NL','Europe/Berlin':'DE','Europe/Madrid':'ES','Europe/Rome':'IT','Europe/London':'GB'}[tz];
  return timezoneCountry&&findPhoneCountry(timezoneCountry)?timezoneCountry:'BR';
}
function phoneLib(){return window.libphonenumber||null}
function genericPhoneMaskFromDigits(digits=''){
  const n=String(digits||'').replace(/\D/g,'').length;
  if(n<=4)return '0'.repeat(Math.max(4,n));
  if(n<=6)return '000 000';
  if(n===7)return '000 0000';
  if(n===8)return '0000 0000';
  if(n===9)return '000 000 000';
  if(n===10)return '000 000 0000';
  if(n===11)return '00 0 0000-0000';
  return Array.from({length:Math.ceil(n/3)},(_,i)=>'0'.repeat(Math.min(3,n-i*3))).join(' ');
}
function phoneExampleMask(country){
  if(!country)return '00 0 0000-0000';
  if(country.iso==='BR')return '00 0 0000-0000';
  const digits=PHONE_EXAMPLES[country.iso]||'';
  const lib=phoneLib();
  if(lib?.getExampleNumber&&digits){
    try{
      const example=lib.getExampleNumber(country.iso,PHONE_EXAMPLES);
      if(example){
        const national=example.formatNational();
        if(national)return national.replace(/\d/g,'0');
      }
    }catch{}
  }
  return genericPhoneMaskFromDigits(digits||'000000000');
}
async function loadPhoneExamples(){
  if(Object.keys(PHONE_EXAMPLES).length)return PHONE_EXAMPLES;
  if(phoneExamplesPromise)return phoneExamplesPromise;
  phoneExamplesPromise=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);
    try{
      const r=await fetch('https://cdn.jsdelivr.net/npm/libphonenumber-js@1.13.12/examples.mobile.json',{signal:controller.signal,cache:'force-cache'});
      if(r.ok){const data=await r.json();if(data&&typeof data==='object')PHONE_EXAMPLES=data}
    }catch{}finally{clearTimeout(timer)}
    updatePhoneCountryUi();
    return PHONE_EXAMPLES;
  })();
  return phoneExamplesPromise;
}
function renderPhoneCountries(selectedIso=''){
  const select=$('#customerCountry');if(!select)return;
  const preferred=String(selectedIso||booking.phoneCountryIso||countryFromBrowserLocale()).toUpperCase();
  select.innerHTML=PHONE_COUNTRIES.map(c=>`<option value="${esc(c.iso)}" data-dial="${esc(c.dial)}">${phoneFlag(c.iso)} ${esc(c.name)} (${esc(c.dial)})</option>`).join('');
  if(findPhoneCountry(preferred))select.value=preferred;
  booking.phoneCountryIso=select.value||preferred;
  updatePhoneCountryUi();
  loadPhoneExamples();
}
function formatBrazilPhoneDigits(digits=''){
  const d=String(digits||'').replace(/\D/g,'').slice(0,11);
  if(d.length<=2)return d;
  if(d.length<=3)return `${d.slice(0,2)} ${d.slice(2)}`;
  if(d.length<=7)return `${d.slice(0,2)} ${d.slice(2,3)} ${d.slice(3)}`;
  return `${d.slice(0,2)} ${d.slice(2,3)} ${d.slice(3,7)}-${d.slice(7)}`;
}
function formatPhoneForCountry(raw,country){
  const value=String(raw||'');
  const digits=value.replace(/\D/g,'');
  if(!digits)return '';
  if(country?.iso==='BR')return formatBrazilPhoneDigits(digits);
  const lib=phoneLib();
  if(lib?.AsYouType&&country?.iso){
    try{return new lib.AsYouType(country.iso).input(digits)}catch{}
  }
  return digits;
}
function applyPhoneMask({keepCaret=false}={}){
  const input=$('#customerPhone'),country=findPhoneCountry($('#customerCountry')?.value)||findPhoneCountry(booking.phoneCountryIso)||findPhoneCountry('BR');
  if(!input||!country)return;
  const old=input.value,caret=input.selectionStart??old.length;
  const digitsBefore=old.slice(0,caret).replace(/\D/g,'').length;
  const formatted=formatPhoneForCountry(old,country);
  if(old===formatted)return;
  input.value=formatted;
  if(keepCaret&&document.activeElement===input){
    let seen=0,pos=formatted.length;
    for(let i=0;i<formatted.length;i++){if(/\d/.test(formatted[i]))seen++;if(seen>=digitsBefore){pos=i+1;break}}
    try{input.setSelectionRange(pos,pos)}catch{}
  }
}
function updatePhoneCountryUi(){
  const select=$('#customerCountry'),input=$('#customerPhone');if(!select||!input)return;
  const country=findPhoneCountry(select.value)||findPhoneCountry('BR');if(!country)return;
  booking.phoneCountryIso=country.iso;
  const compact=$('#customerCountryCompact');if(compact)compact.textContent=`${phoneFlag(country.iso)} ${country.dial}`;
  const example=phoneExampleMask(country);
  input.placeholder=`Ex.: ${example}`;
  input.setAttribute('aria-label',`WhatsApp em ${country.name}. Exemplo ${example}`);
  const hint=$('#customerCountryHint');
  if(hint&&!booking.phoneCountryManual)hint.textContent=`País detectado: ${country.name} (${country.dial}) · Exemplo: ${example}`;
  else if(hint)hint.textContent=`${country.name} (${country.dial}) · Exemplo: ${example}`;
  if(input.value)applyPhoneMask();
}
async function reverseCountryFromLocation(latitude,longitude){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3500);
  try{
    const url=`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&localityLanguage=pt-BR`;
    const r=await fetch(url,{signal:controller.signal,cache:'no-store'});if(!r.ok)return '';
    const data=await r.json();return String(data?.countryCode||'').toUpperCase();
  }catch{return ''}finally{clearTimeout(timer)}
}
function getBrowserPosition(){
  return new Promise(resolve=>{
    if(!navigator.geolocation||!window.isSecureContext)return resolve(null);
    navigator.geolocation.getCurrentPosition(p=>resolve(p.coords),()=>resolve(null),{enableHighAccuracy:false,timeout:4500,maximumAge:86400000});
  });
}
async function detectPhoneCountry(){
  if(booking.phoneCountryDetectStarted)return;booking.phoneCountryDetectStarted=true;
  const fallback=countryFromBrowserLocale();renderPhoneCountries(fallback);
  const coords=await getBrowserPosition();if(!coords||booking.phoneCountryManual)return;
  const byLocation=await reverseCountryFromLocation(coords.latitude,coords.longitude);if(!findPhoneCountry(byLocation)||booking.phoneCountryManual)return;
  const select=$('#customerCountry');if(select){select.value=byLocation;booking.phoneCountryIso=byLocation;updatePhoneCountryUi()}
}
function normalizedCustomerPhone(raw){
  const value=String(raw||'').trim();if(!value)return '';
  const country=findPhoneCountry($('#customerCountry')?.value)||findPhoneCountry(booking.phoneCountryIso)||findPhoneCountry('BR');
  const lib=phoneLib();
  if(lib?.parsePhoneNumberFromString){
    try{
      const parsed=value.startsWith('+')?lib.parsePhoneNumberFromString(value):lib.parsePhoneNumberFromString(value,country?.iso);
      if(parsed?.number)return parsed.number;
    }catch{}
  }
  if(value.startsWith('+'))return '+'+value.slice(1).replace(/\D/g,'');
  let digits=value.replace(/\D/g,'');
  digits=digits.replace(/^0+/,'');
  return `${country?.dial||''}${digits}`;
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
    const eligible=pass.loyalty?.enabled===true;
    eligibility.className=`notice ${eligible?'notice-ok':'notice-warn'}`;
    eligibility.innerHTML=eligible?'<i class="bi bi-stars" aria-hidden="true"></i> Fidelidade ativa: este WhatsApp identifica seu cadastro e a visita será somada quando sua chegada for validada.':'<i class="bi bi-info-circle" aria-hidden="true"></i> Reserva confirmada. O programa de fidelidade está pausado nesta barbearia.';
  }
  setCheckinLiveState('success',pass);
}

document.addEventListener('DOMContentLoaded',async()=>{
  // Garante que os modais de confirmação e QR iniciem realmente fechados ao carregar/recarregar a página.
  closeBookingSuccessDialog();
  closeArrivalQrDialog();
  closeBookingWizard();
  $('#arrivalQrCloseButton')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();closeArrivalQrDialog()});
  $('#bookingSuccessCloseButton')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();closeBookingSuccessDialog()});
  $('#copyArrivalQrShortCode')?.addEventListener('click',()=>copyCheckinCodeFrom('arrivalQrShortCode'));
  $('#copySuccessCheckinCode')?.addEventListener('click',()=>copyCheckinCodeFrom('successCheckinCode'));
  $('#newBookingAfterSuccess')?.addEventListener('click',()=>{closeBookingSuccessDialog();setTimeout(()=>openBookingWizard(true),30)});
  booking.slug=(qs('slug')||'').trim();booking.preferredBarberId=(qs('barber')||'').trim();
  if(!booking.slug){const savedSlug=(localStorage.getItem('na_regua_current_tenant_slug')||'').trim();if(savedSlug){booking.slug=savedSlug;const fixedUrl=new URL(location.href);fixedUrl.searchParams.set('slug',booking.slug);history.replaceState(null,'',fixedUrl.href)}}
  if(!booking.slug){$('#bookingRoot').innerHTML='<div class="card notice-error">Este link de agendamento está incompleto. Abra o link público fornecido pela barbearia.</div>';return}
  const {data,error}=await sb.rpc('get_public_booking_catalog',{p_slug:booking.slug});
  if(error||!data?.tenant){$('#bookingRoot').innerHTML='<div class="card">Barbearia não encontrada.</div>';return}
  if(!data.tenant.is_available){location.replace(`agendamentos-indisponiveis.html?slug=${encodeURIComponent(booking.slug)}`);return}
  booking.tenant=data.tenant;booking.services=data.services||[];booking.barbers=data.barbers||[];booking.links=data.barber_services||[];
  if(booking.preferredBarberId&&!booking.barbers.some(b=>b.id===booking.preferredBarberId))booking.preferredBarberId='';
  setText('bookingTenantName',booking.tenant.name);renderServices();
  const bookingDateInput=$('#bookingDate');if(bookingDateInput){const minDate=new Date(),maxDate=new Date();maxDate.setDate(maxDate.getDate()+120);bookingDateInput.min=localDateValue(minDate);bookingDateInput.max=localDateValue(maxDate)}
  renderQuickDates();
  $('#openBookingWizard')?.addEventListener('click',()=>openBookingWizard(true));
  $('#bookingWizardCloseButton')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();closeBookingWizard()});
  $('#bookingWizardBack')?.addEventListener('click',goBackBookingStep);
  $('#bookingWizardDialog')?.addEventListener('cancel',e=>e.preventDefault());
  await Promise.all([loadLoyaltyProgram(),loadClientPortal(false)]);

  $('#services').addEventListener('click',e=>{const btn=e.target.closest('[data-service-id]');if(btn)chooseService(btn.dataset.serviceId)});
  $('#barbers').addEventListener('click',e=>{const btn=e.target.closest('[data-barber-id]');if(btn)chooseBarber(btn.dataset.barberId)});
  $('#slots').addEventListener('click',e=>{const btn=e.target.closest('[data-slot]');if(!btn||btn.classList.contains('booking-time-wheel-item'))return;try{chooseSlot(JSON.parse(btn.dataset.slot))}catch{toast('Não foi possível selecionar este horário.','error')}});
  $('#bookingQuickDates')?.addEventListener('click',e=>{const btn=e.target.closest('[data-booking-date]');if(btn){selectBookingDate(btn.dataset.bookingDate);setTimeout(()=>centerSelectedQuickDate(),20)}});
  $('#bookingDate').addEventListener('change',e=>selectBookingDate(e.target.value));
  renderPhoneCountries(countryFromBrowserLocale());
  $('#customerCountry')?.addEventListener('change',e=>{booking.phoneCountryManual=true;booking.phoneCountryIso=e.target.value;updatePhoneCountryUi()});
  $('#customerPhone')?.addEventListener('input',()=>applyPhoneMask({keepCaret:true}));
  $('#customerPhone')?.addEventListener('blur',()=>applyPhoneMask());
  $('#refreshClientPortal')?.addEventListener('click',()=>loadClientPortal(false));
  $('#openClientPortalAfterBooking')?.addEventListener('click',()=>{closeBookingSuccessDialog();loadClientPortal(true)});
  $('#clientHistoryList')?.addEventListener('click',e=>{const btn=e.target.closest('[data-client-qr]');if(btn)openArrivalQrDialog(btn.dataset.clientQr,{id:btn.dataset.clientId,service_name:btn.dataset.clientService,starts_at:btn.dataset.clientStart,barber_name:btn.dataset.clientBarber})});

  $('#bookingForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!booking.serviceId)return toast('Escolha um serviço.','error');if(!booking.barberId)return toast('Escolha um barbeiro.','error');if(!booking.slot)return toast('Escolha um horário.','error');
    const btn=$('#bookBtn');btn.disabled=true;const f=new FormData(e.target),phone=normalizedCustomerPhone(f.get('customerPhone'));
    if(!phone||phone.replace(/\D/g,'').length<7){btn.disabled=false;return toast('Confira o número do WhatsApp.','error')}
    const {data:id,error}=await sb.rpc('create_public_appointment',{p_slug:booking.slug,p_service_id:booking.serviceId,p_barber_id:booking.barberId,p_starts_at:booking.slot.starts_at,p_customer_name:f.get('customerName'),p_customer_phone:phone,p_customer_email:null,p_notes:null});
    btn.disabled=false;if(error){toast(error.message,'error');return loadSlots()}
    setText('successId',id);
    $('#successArrivalPass')?.classList.add('hidden');
    $('#openClientPortalAfterBooking')?.classList.add('hidden');
    const successQr=$('#successQrCode');if(successQr)successQr.innerHTML='';
    setText('successCheckinCode','--------');
    const pass=await loadAppointmentPass(id,phone);if(pass)showSuccessPass(pass);
    await loadClientPortal(false);
    closeBookingWizard();
    resetBookingFlow();
    openBookingSuccessDialog();
    if(pass?.checkin_code)startClientCheckinWatch({appointmentId:pass.appointment_id||id,code:pass.checkin_code,prefix:'success'});
  });
});
