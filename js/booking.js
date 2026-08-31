let booking={slug:'',tenant:null,services:[],barbers:[],links:[],serviceId:'',barberId:'',preferredBarberId:'',date:'',slot:null};
function esc(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
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
  const list=getAvailableBarbersForService();
  const box=$('#barbers');
  if(!list.length){
    box.innerHTML='<div class="notice notice-warn">Nenhum barbeiro ativo está disponível para este serviço.</div>';
    return;
  }
  box.innerHTML=list.map(b=>`<button type="button" class="booking-option barber-option ${booking.barberId===b.id?'selected':''}" data-barber-id="${b.id}"><div class="booking-option-row"><div><strong>${esc(b.full_name)}</strong><div class="small muted">Toque para escolher este profissional</div></div>${booking.barberId===b.id?'<span class="booking-check">✓</span>':''}</div></button>`).join('');
}
function chooseService(id){
  booking.serviceId=id;booking.barberId='';booking.slot=null;booking.date='';
  const available=getAvailableBarbersForService();
  if(booking.preferredBarberId&&available.some(b=>b.id===booking.preferredBarberId))booking.barberId=booking.preferredBarberId;
  renderServices();renderBarbers();
  $('#dateSection').classList.toggle('hidden',!booking.barberId);$('#customerSection').classList.add('hidden');
  $('#bookingDate').value='';$('#slots').innerHTML='';
  const target=booking.barberId?'#dateSection':'#barberSection';
  setTimeout(()=>$(target)?.scrollIntoView({behavior:'smooth',block:'nearest'}),50);
}
function chooseBarber(id){
  const valid=getAvailableBarbersForService().some(b=>b.id===id);
  if(!valid)return;
  booking.barberId=id;booking.slot=null;
  renderBarbers();$('#dateSection').classList.remove('hidden');$('#customerSection').classList.add('hidden');$('#slots').innerHTML='';
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
document.addEventListener('DOMContentLoaded',async()=>{
  booking.slug=(qs('slug')||'').trim();
  booking.preferredBarberId=(qs('barber')||'').trim();
  if(!booking.slug){
    const savedSlug=(localStorage.getItem('na_regua_current_tenant_slug')||'').trim();
    if(savedSlug){booking.slug=savedSlug;const fixedUrl=new URL(location.href);fixedUrl.searchParams.set('slug',booking.slug);history.replaceState(null,'',fixedUrl.href)}
  }
  if(!booking.slug){$('#bookingRoot').innerHTML='<div class="card notice-error">Este link de agendamento está incompleto. Abra o link público fornecido pela barbearia.</div>';return}
  const {data,error}=await sb.rpc('get_public_booking_catalog',{p_slug:booking.slug});
  if(error||!data?.tenant){$('#bookingRoot').innerHTML='<div class="card">Barbearia não encontrada.</div>';return}
  if(!data.tenant.is_available){location.replace(`agendamentos-indisponiveis.html?slug=${encodeURIComponent(booking.slug)}`);return}
  booking.tenant=data.tenant;booking.services=data.services||[];booking.barbers=data.barbers||[];booking.links=data.barber_services||[];
  if(booking.preferredBarberId&&!booking.barbers.some(b=>b.id===booking.preferredBarberId))booking.preferredBarberId='';
  setText('bookingTenantName',booking.tenant.name);renderServices();
  $('#bookingDate').min=new Date().toISOString().slice(0,10);
  $('#services').addEventListener('click',e=>{const btn=e.target.closest('[data-service-id]');if(btn)chooseService(btn.dataset.serviceId)});
  $('#barbers').addEventListener('click',e=>{const btn=e.target.closest('[data-barber-id]');if(btn)chooseBarber(btn.dataset.barberId)});
  $('#slots').addEventListener('click',e=>{const btn=e.target.closest('[data-slot]');if(!btn)return;try{chooseSlot(JSON.parse(btn.dataset.slot))}catch{toast('Não foi possível selecionar este horário.','error')}});
  $('#bookingDate').addEventListener('change',loadSlots);
  $('#bookingForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!booking.serviceId)return toast('Escolha um serviço.','error');if(!booking.barberId)return toast('Escolha um barbeiro.','error');if(!booking.slot)return toast('Escolha um horário.','error');
    const btn=$('#bookBtn');btn.disabled=true;const f=new FormData(e.target);
    const {data:id,error}=await sb.rpc('create_public_appointment',{p_slug:booking.slug,p_service_id:booking.serviceId,p_barber_id:booking.barberId,p_starts_at:booking.slot.starts_at,p_customer_name:f.get('customerName'),p_customer_phone:f.get('customerPhone'),p_customer_email:f.get('customerEmail')||null,p_notes:null});
    btn.disabled=false;if(error){toast(error.message,'error');return loadSlots()}
    $('#bookingSteps').classList.add('hidden');$('#successBox').classList.remove('hidden');setText('successId',id)
  });
});
