let barberProfile=null;
let barberProducts=[];
let barberServices=[];
let barberCommands=[];
let barberTodayAppointments=[];
let activeCommandId=null;
let commandModuleReady=true;
let commandServicesReady=true;
let stockModuleReady=true;
let pendingReopenAppointmentId=null;
let currentBarberPublicUrl='';
let checkinScanner=null;
let checkinBusy=false;
let barberFinancialMonthRows=[];
let barberSelectedEarningsDate='';
let barberSelectedEarningsMonth='';
let barberFinancialLoading=false;

function menuInitial(name,fallback='U'){
  const clean=String(name||'').trim();
  return (clean[0]||fallback).toUpperCase();
}
function syncBarberUserMenu(){
  const name=barberProfile?.full_name||'Barbeiro';
  setText('barberMenuTriggerName',name);
  setText('barberMenuName',name);
  setText('barberUserAvatar',menuInitial(name,'B'));
  setText('barberMenuAvatar',menuInitial(name,'B'));
}
function setBarberUserMenu(open){
  const menu=$('#barberUserMenu'),button=$('#barberUserMenuButton');
  if(!menu||!button)return;
  menu.classList.toggle('hidden',!open);
  button.setAttribute('aria-expanded',open?'true':'false');
}
function closeBarberUserMenu(){setBarberUserMenu(false)}
function toggleBarberUserMenu(){const menu=$('#barberUserMenu');if(menu)setBarberUserMenu(menu.classList.contains('hidden'))}


const BARBER_TAB_NAMES={summary:'Resumo',earnings:'Ganhos',agenda:'Agenda'};
function centerBarberTab(button,behavior='smooth'){
  const track=$('#barberSectionTabs');
  if(!track||!button)return;
  const buttons=[...track.querySelectorAll('[data-barber-tab]')];
  const index=buttons.indexOf(button),maxScroll=Math.max(0,track.scrollWidth-track.clientWidth);
  let left=button.offsetLeft-(track.clientWidth-button.offsetWidth)/2;
  if(index===0)left=0;else if(index===buttons.length-1)left=maxScroll;else left=Math.min(maxScroll,Math.max(0,left));
  track.scrollTo({left,behavior});
}
function setBarberTab(tab,{remember=true}={}){
  const selected=BARBER_TAB_NAMES[tab]?tab:'summary';
  document.querySelectorAll('[data-barber-panel]').forEach(panel=>panel.classList.toggle('hidden',panel.dataset.barberPanel!==selected));
  document.querySelectorAll('[data-barber-tab]').forEach(button=>{
    const active=button.dataset.barberTab===selected;
    button.classList.toggle('is-active',active);button.setAttribute('aria-selected',active?'true':'false');
  });
  if(remember){try{sessionStorage.setItem('na_regua_barber_tab',selected)}catch{}}
  requestAnimationFrame(()=>centerBarberTab(document.querySelector(`[data-barber-tab="${selected}"]`),remember?'smooth':'auto'));
}
function initBarberTabCarousel(){
  const track=$('#barberSectionTabs');if(!track)return;
  let dragging=false,moved=false,startX=0,startScroll=0,suppressClick=false;
  const finish=event=>{
    if(!dragging)return;dragging=false;
    if(moved){suppressClick=true;setTimeout(()=>{suppressClick=false},0)}
    track.classList.remove('is-dragging','is-grabbing');
    try{if(event&&track.hasPointerCapture?.(event.pointerId))track.releasePointerCapture(event.pointerId)}catch{}
  };
  track.addEventListener('pointerdown',event=>{
    if(event.pointerType==='mouse'&&event.button!==0)return;
    dragging=true;moved=false;startX=event.clientX;startScroll=track.scrollLeft;track.classList.add('is-grabbing');
    try{track.setPointerCapture(event.pointerId)}catch{}
  });
  track.addEventListener('pointermove',event=>{
    if(!dragging)return;const delta=event.clientX-startX;
    if(Math.abs(delta)>4){moved=true;track.classList.add('is-dragging')}
    if(!moved)return;track.scrollLeft=startScroll-delta;if(event.cancelable)event.preventDefault();
  },{passive:false});
  track.addEventListener('pointerup',finish);track.addEventListener('pointercancel',finish);track.addEventListener('lostpointercapture',()=>{if(dragging)finish()});
  track.addEventListener('click',event=>{if(!suppressClick)return;event.preventDefault();event.stopImmediatePropagation()},true);
}
function initBarberTabs(){
  let initial='summary';try{initial=sessionStorage.getItem('na_regua_barber_tab')||'summary'}catch{}
  setBarberTab(initial,{remember:false});
  document.querySelectorAll('[data-barber-tab]').forEach(button=>button.addEventListener('click',()=>setBarberTab(button.dataset.barberTab)));
  initBarberTabCarousel();
}

function buildBarberPublicAgendaUrl(){
  const slug=String(barberProfile?.tenant?.slug||'').trim();
  const barberId=String(barberProfile?.id||'').trim();
  if(!slug||!barberId)return '';
  const url=new URL('agendar.html',location.href);
  url.searchParams.set('slug',slug);
  url.searchParams.set('barber',barberId);
  return url.href;
}
function updateBarberPublicAgendaUrl(){
  currentBarberPublicUrl=buildBarberPublicAgendaUrl();
}
function openBarberPublicAgenda(){
  updateBarberPublicAgendaUrl();
  if(!currentBarberPublicUrl)return toast('Não foi possível identificar o link da sua agenda.','error');
  window.open(currentBarberPublicUrl,'_blank','noopener');
}
async function copyBarberPublicAgenda(){
  updateBarberPublicAgendaUrl();
  if(!currentBarberPublicUrl)return toast('Link da agenda indisponível.','error');
  try{
    if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(currentBarberPublicUrl);
    else{
      const area=document.createElement('textarea');
      area.value=currentBarberPublicUrl;area.style.position='fixed';area.style.opacity='0';
      document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();
    }
    toast('Link da sua agenda copiado.');
  }catch(error){toast('Não foi possível copiar o link da agenda.','error')}
}

function escapeHtml(v){return String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}
function commandNumber(v){return `#${String(v??0).padStart(4,'0')}`}
function commandTime(v){return new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(v))}
function openBarberDialog(id){const d=document.getElementById(id);if(!d||d.open)return;if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','')}
function closeBarberDialog(id){const d=document.getElementById(id);if(!d)return;if(d.open&&typeof d.close==='function')d.close();else d.removeAttribute('open')}


function localDateValue(date=new Date()){
  const d=new Date(date);
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function localMonthValue(date=new Date()){
  const d=new Date(date);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function monthBoundsValue(value){
  const [y,m]=String(value||'').split('-').map(Number),now=new Date();
  const year=y||now.getFullYear(),month=(m||now.getMonth()+1)-1;
  return {start:new Date(year,month,1,0,0,0,0),end:new Date(year,month+1,1,0,0,0,0)};
}
function earningsMonthLabel(value){
  const {start}=monthBoundsValue(value);
  const text=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(start);
  return text.charAt(0).toUpperCase()+text.slice(1);
}
function localDateBounds(value){
  const [y,m,d]=String(value||'').split('-').map(Number);
  const start=(y&&m&&d)?new Date(y,m-1,d,0,0,0,0):new Date();
  if(!(y&&m&&d))start.setHours(0,0,0,0);
  const end=new Date(start);end.setDate(end.getDate()+1);
  return {start,end};
}
function monthBounds(date=new Date()){
  const d=new Date(date),start=new Date(d.getFullYear(),d.getMonth(),1,0,0,0,0),end=new Date(d.getFullYear(),d.getMonth()+1,1,0,0,0,0);
  return {start,end};
}
function sameLocalDate(a,b){
  const da=new Date(a),db=new Date(b);
  return da.getFullYear()===db.getFullYear()&&da.getMonth()===db.getMonth()&&da.getDate()===db.getDate();
}
function earningsDateLabel(value){
  const {start}=localDateBounds(value),today=new Date(),yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
  if(sameLocalDate(start,today))return 'Hoje';
  if(sameLocalDate(start,yesterday))return 'Ontem';
  const text=new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long'}).format(start);
  return text.charAt(0).toUpperCase()+text.slice(1);
}
function agendaDateShortLabel(value){
  const {start}=localDateBounds(value);
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit'}).format(start);
}
function syncSelectedAgendaLabels(value,count=0){
  const label=earningsDateLabel(value);
  const short=agendaDateShortLabel(value);
  setText('barberAgendaTitle',`Clientes de ${label.toLowerCase()}`);
  setText('barberAgendaSelectedDate',label);
  setText('agendaCountHint',`${count===1?'cliente':'clientes'} em ${short}`);
}
function sumFinancial(rows,key){return rows.reduce((total,row)=>total+Number(row?.[key]||0),0)}
function rowOccurrence(row){return row.occurred_at||row.closed_at||row.starts_at||new Date().toISOString()}

async function fetchBarberEarnings(from,to){
  if(!barberProfile)return [];
  const baseCommands=sb.from('commands')
    .select('id,appointment_id,customer_name,closed_at,created_at,service_total_cents,gross_total_cents,commission_pct_snapshot,commission_cents')
    .eq('tenant_id',barberProfile.tenant_id).eq('barber_id',barberProfile.id).eq('status','closed')
    .gte('closed_at',from.toISOString()).lt('closed_at',to.toISOString()).order('closed_at',{ascending:false});
  const appointmentsQuery=sb.from('appointments')
    .select('id,starts_at,customer_name,price_cents,service_id,services(name)')
    .eq('tenant_id',barberProfile.tenant_id).eq('barber_id',barberProfile.id).eq('status','completed')
    .gte('starts_at',from.toISOString()).lt('starts_at',to.toISOString()).order('starts_at',{ascending:false});
  const [commandResult,appointmentResult]=await Promise.all([baseCommands,appointmentsQuery]);

  // Bancos antigos ainda conseguem mostrar o financeiro básico pelos atendimentos.
  const commands=commandResult.error?[]:(commandResult.data||[]);
  const appointments=appointmentResult.error?[]:(appointmentResult.data||[]);
  if(commandResult.error)console.warn('Financeiro por comanda indisponível:',commandResult.error.message);
  if(appointmentResult.error)console.warn('Financeiro por atendimento indisponível:',appointmentResult.error.message);

  let linkedAppointmentIds=new Set();
  const appointmentIds=appointments.map(item=>item.id).filter(Boolean);
  if(appointmentIds.length){
    const linked=await sb.from('commands').select('appointment_id').eq('tenant_id',barberProfile.tenant_id).eq('barber_id',barberProfile.id).in('appointment_id',appointmentIds);
    if(!linked.error)linkedAppointmentIds=new Set((linked.data||[]).map(item=>item.appointment_id).filter(Boolean));
  }

  const pct=Number(barberProfile.commission_pct||0);
  const commandRows=commands.map(command=>{
    const serviceCents=Number(command.service_total_cents||0);
    const commandPct=Number(command.commission_pct_snapshot??pct);
    const commissionCents=command.commission_cents==null?Math.round(serviceCents*commandPct/100):Number(command.commission_cents||0);
    return {
      id:`command:${command.id}`,
      occurred_at:command.closed_at||command.created_at,
      customer_name:command.customer_name||'Cliente',
      detail:'Comanda fechada',
      service_revenue_cents:serviceCents,
      gross_revenue_cents:Number(command.gross_total_cents||serviceCents),
      commission_cents:commissionCents,
      commission_pct:commandPct,
      source:'command'
    };
  });
  const legacyRows=appointments.filter(item=>!linkedAppointmentIds.has(item.id)).map(item=>({
    id:`appointment:${item.id}`,
    occurred_at:item.starts_at,
    customer_name:item.customer_name||'Cliente',
    detail:item.services?.name||'Serviço concluído',
    service_revenue_cents:Number(item.price_cents||0),
    gross_revenue_cents:Number(item.price_cents||0),
    commission_cents:Math.round(Number(item.price_cents||0)*pct/100),
    commission_pct:pct,
    source:'appointment'
  }));
  return [...commandRows,...legacyRows].sort((a,b)=>new Date(rowOccurrence(b))-new Date(rowOccurrence(a)));
}

function renderSelectedEarnings(rows,dateValue){
  const amount=sumFinancial(rows,'commission_cents');
  setText('selectedEarningsDateLabel',earningsDateLabel(dateValue));
  setText('selectedEarningsAmount',money(amount));
  setText('selectedEarningsCount',rows.length);
  const host=$('#barberEarningsDayRows');if(!host)return;
  if(!rows.length){host.innerHTML='<div class="empty">Nenhum ganho registrado neste dia.</div>';return}
  host.innerHTML=rows.map(row=>`<div class="barber-earning-row">
    <div class="barber-earning-row-time">${commandTime(rowOccurrence(row))}</div>
    <div class="barber-earning-row-main"><strong>${escapeHtml(row.customer_name||'Cliente')}</strong><span>${escapeHtml(row.detail||'Serviço concluído')} · ${Number(row.commission_pct||0).toFixed(2).replace('.',',')}%</span></div>
    <div class="barber-earning-row-value"><strong>${money(row.commission_cents)}</strong><small>meu ganho</small></div>
  </div>`).join('');
}

async function loadSelectedEarnings(dateValue,{reuseMonth=true}={}){
  const input=$('#barberEarningsDate');
  const value=dateValue||input?.value||localDateValue();
  barberSelectedEarningsDate=value;
  if(input&&input.value!==value)input.value=value;
  const monthKey=value.slice(0,7);
  let rows;
  if(reuseMonth&&monthKey===barberSelectedEarningsMonth){
    const {start,end}=localDateBounds(value);
    rows=barberFinancialMonthRows.filter(row=>{const d=new Date(rowOccurrence(row));return d>=start&&d<end});
  }else{
    const {start,end}=localDateBounds(value);
    rows=await fetchBarberEarnings(start,end);
  }
  renderSelectedEarnings(rows,value);
}

function startOfWeek(date=new Date()){
  const d=new Date(date);d.setHours(0,0,0,0);
  const day=d.getDay()||7;d.setDate(d.getDate()-day+1);
  return d;
}
function renderBarberWeekChart(rows,now=new Date()){
  const host=$('#barberWeekChart');if(!host)return;
  const days=[];
  for(let offset=6;offset>=0;offset--){
    const date=new Date(now);date.setHours(0,0,0,0);date.setDate(date.getDate()-offset);
    const dayRows=rows.filter(row=>sameLocalDate(rowOccurrence(row),date));
    days.push({date,amount:sumFinancial(dayRows,'commission_cents'),count:dayRows.length});
  }
  const max=Math.max(...days.map(day=>day.amount),1);
  const weekday=new Intl.DateTimeFormat('pt-BR',{weekday:'short'});
  host.innerHTML=days.map(day=>{
    const pct=day.amount?Math.max(10,Math.round(day.amount/max*100)):4;
    const isToday=sameLocalDate(day.date,now);
    const label=weekday.format(day.date).replace('.','').slice(0,3);
    return `<div class="barber-week-day${isToday?' is-today':''}" title="${escapeHtml(earningsDateLabel(localDateValue(day.date)))}: ${money(day.amount)}">
      <div class="barber-week-value">${day.amount?money(day.amount):'—'}</div>
      <div class="barber-week-bar-track"><div class="barber-week-bar" style="height:${pct}%"></div></div>
      <div class="barber-week-day-label"><strong>${escapeHtml(label)}</strong><span>${String(day.date.getDate()).padStart(2,'0')}</span></div>
    </div>`;
  }).join('');
}

async function loadBarberFinancialDashboard(monthValue=''){
  if(!barberProfile||barberFinancialLoading)return;
  barberFinancialLoading=true;
  const dashboard=$('.barber-summary-panel');dashboard?.classList.add('barber-earnings-loading');
  try{
    const now=new Date(),currentMonth=localMonthValue(now);
    const selected=monthValue||barberSelectedEarningsMonth||currentMonth;
    barberSelectedEarningsMonth=selected;
    const input=$('#barberEarningsMonth');
    if(input){input.max=currentMonth;if(input.value!==selected)input.value=selected}
    const {start:monthStart,end:monthEnd}=monthBoundsValue(selected);
    barberFinancialMonthRows=await fetchBarberEarnings(monthStart,monthEnd);
    const {start:todayStart,end:todayEnd}=localDateBounds(localDateValue(now));
    const todayRows=selected===currentMonth
      ? barberFinancialMonthRows.filter(row=>sameLocalDate(rowOccurrence(row),now))
      : await fetchBarberEarnings(todayStart,todayEnd);
    const monthCommission=sumFinancial(barberFinancialMonthRows,'commission_cents');
    setText('commissionToday',money(sumFinancial(todayRows,'commission_cents')));
    setText('commissionMonth',money(monthCommission));
    setText('monthAppointmentsCount',barberFinancialMonthRows.length);
    setText('todayEarningsHint',`${todayRows.length} ${todayRows.length===1?'atendimento concluído':'atendimentos concluídos'}`);
    setText('monthEarningsHint',`${barberFinancialMonthRows.length} ${barberFinancialMonthRows.length===1?'atendimento concluído':'atendimentos concluídos'}`);
    setText('selectedMonthLabel',earningsMonthLabel(selected));
    setText('barberCommissionPct',`${Number(barberProfile.commission_pct||0).toFixed(2).replace('.',',')}%`);
    const dateInput=$('#barberEarningsDate'),todayValue=localDateValue(now);
    if(dateInput){dateInput.max=todayValue;if(!dateInput.value)dateInput.value=barberSelectedEarningsDate||todayValue}
    if(!barberSelectedEarningsDate)await loadSelectedEarnings(dateInput?.value||todayValue,{reuseMonth:true});
  }finally{
    barberFinancialLoading=false;dashboard?.classList.remove('barber-earnings-loading');
  }
}

const statusInfo={
  pending:{label:'Pendente',className:'warning'},
  confirmed:{label:'Confirmado',className:'active'},
  in_progress:{label:'Em atendimento',className:'warning'},
  completed:{label:'Concluído',className:'active'},
  cancelled:{label:'Cancelado',className:'expired'},
  no_show:{label:'Não compareceu',className:'expired'}
};
function statusBadge(status){
  const info=statusInfo[status]||{label:status||'-',className:'warning'};
  return `<span class="badge badge-${info.className}">${escapeHtml(info.label)}</span>`;
}
function appointmentById(id){return barberTodayAppointments.find(a=>a.id===id)}
function commandForAppointment(id){return barberCommands.find(c=>c.appointment_id===id)}

function renderCommandProductOptions(){
  const select=$('#commandProduct');
  if(!select)return;
  if(!stockModuleReady){
    select.innerHTML='<option value="">Atualize o banco para usar o estoque</option>';
    select.disabled=true;
    return;
  }
  const active=barberProducts.filter(p=>p.active!==false&&Number(p.stock_quantity||0)>0);
  if(!active.length){
    select.innerHTML='<option value="">Nenhum produto com estoque disponível</option>';
    select.disabled=true;
    return;
  }
  select.disabled=false;
  select.innerHTML='<option value="">Selecione o produto</option>'+active.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} — ${money(p.price_cents)} · ${Number(p.stock_quantity||0)} un.</option>`).join('');
}

async function loadBarberProducts(){
  const result=await sb.from('products').select('id,name,price_cents,stock_quantity,active').eq('tenant_id',barberProfile.tenant_id).eq('active',true).order('name');
  if(!result.error && (result.data||[]).length){
    stockModuleReady=true;
    barberProducts=result.data||[];
    $('#stockSetupNoticeBarber')?.classList.add('hidden');
    renderCommandProductOptions();
    return {error:null};
  }
  if(result.error)console.warn('Leitura direta de produtos/estoque falhou:',result.error.message);
  const fallback=await sb.rpc('barber_active_products');
  if(!fallback.error){
    const data=fallback.data||[];
    const supportsStock=!data.length||Object.prototype.hasOwnProperty.call(data[0],'stock_quantity');
    stockModuleReady=supportsStock;
    barberProducts=supportsStock?data.map(p=>({...p,active:true})):[];
    $('#stockSetupNoticeBarber')?.classList.toggle('hidden',supportsStock);
    renderCommandProductOptions();
    return {error:supportsStock?null:(result.error||new Error('Controle de estoque não instalado.'))};
  }
  stockModuleReady=!result.error;
  barberProducts=!result.error?(result.data||[]):[];
  $('#stockSetupNoticeBarber')?.classList.toggle('hidden',stockModuleReady);
  renderCommandProductOptions();
  console.warn('Fallback de produtos indisponível:',fallback.error.message);
  return {error:stockModuleReady?null:(result.error||fallback.error)};
}

function renderCommandServiceOptions(appointment=null){
  const select=$('#commandService');
  if(!select)return;
  const active=barberServices.filter(service=>service.active!==false && (!appointment?.service_id || service.id!==appointment.service_id));
  if(!active.length){
    select.innerHTML='<option value="">Nenhum outro serviço disponível</option>';
    select.disabled=true;
    return;
  }
  select.disabled=false;
  select.innerHTML='<option value="">Selecione o serviço</option>'+active.map(service=>`<option value="${service.id}">${escapeHtml(service.name)} — ${money(service.effective_price_cents)}</option>`).join('');
}

async function loadBarberServices(){
  const linksResult=await sb.from('barber_services').select('service_id,price_override_cents,active').eq('tenant_id',barberProfile.tenant_id).eq('barber_id',barberProfile.id).eq('active',true);
  if(linksResult.error){
    console.warn('Não foi possível carregar os serviços vinculados:',linksResult.error.message);
    barberServices=[];
    renderCommandServiceOptions();
    return {error:linksResult.error};
  }
  const links=linksResult.data||[];
  const ids=links.map(link=>link.service_id);
  if(!ids.length){
    barberServices=[];
    renderCommandServiceOptions();
    return {error:null};
  }
  const servicesResult=await sb.from('services').select('id,name,price_cents,active').eq('tenant_id',barberProfile.tenant_id).in('id',ids).eq('active',true).order('name');
  if(servicesResult.error){
    console.warn('Não foi possível carregar os serviços ativos:',servicesResult.error.message);
    barberServices=[];
    renderCommandServiceOptions();
    return {error:servicesResult.error};
  }
  const linkByService=new Map(links.map(link=>[link.service_id,link]));
  barberServices=(servicesResult.data||[]).map(service=>{
    const link=linkByService.get(service.id);
    return {...service,effective_price_cents:link?.price_override_cents??service.price_cents};
  });
  renderCommandServiceOptions();
  return {error:null};
}

async function loadCommandModule(appointments=[]){
  const appointmentIds=appointments.map(a=>a.id);
  // Produtos são carregados separadamente para que um erro nas comandas não esconda
  // os produtos cadastrados, e vice-versa.
  const [productResult,serviceResult]=await Promise.all([loadBarberProducts(),loadBarberServices()]);
  const openPromise=sb.from('commands').select('id,number,customer_name,status,created_at,closed_at,appointment_id').eq('tenant_id',barberProfile.tenant_id).eq('barber_id',barberProfile.id).eq('status','open').order('created_at',{ascending:false});
  let linkedPromise=Promise.resolve({data:[],error:null});
  if(appointmentIds.length){
    linkedPromise=sb.from('commands').select('id,number,customer_name,status,created_at,closed_at,appointment_id').eq('tenant_id',barberProfile.tenant_id).eq('barber_id',barberProfile.id).in('appointment_id',appointmentIds);
  }
  const extraServiceCheck=sb.from('command_services').select('id').eq('tenant_id',barberProfile.tenant_id).limit(1);
  const [openResult,linkedResult,extraServiceResult]=await Promise.all([openPromise,linkedPromise,extraServiceCheck]);
  commandServicesReady=!extraServiceResult.error;
  $('#extraServiceSetupNotice')?.classList.toggle('hidden',commandServicesReady);
  const commandError=openResult.error||linkedResult.error;
  if(commandError){
    console.warn('Módulo de comandas integradas indisponível:',commandError.message);
    barberCommands=[];commandModuleReady=false;
    setText('openCommandCount','0');
    $('#commandSetupNotice')?.classList.remove('hidden');
    return;
  }
  commandModuleReady=true;
  $('#commandSetupNotice')?.classList.add('hidden');
  const merged=new Map();
  [...(openResult.data||[]),...(linkedResult.data||[])].forEach(c=>merged.set(c.id,c));
  barberCommands=[...merged.values()];
  setText('openCommandCount',barberCommands.filter(c=>c.status==='open').length);
  if(productResult.error){
    toast('Não foi possível carregar os produtos. Verifique as atualizações do banco.','warn');
  }
  if(serviceResult.error){
    toast('Não foi possível carregar os serviços vinculados ao barbeiro.','warn');
  }
}

async function commandTotalsById(){
  const ids=barberCommands.map(c=>c.id);
  const totals=new Map();
  if(!ids.length)return totals;
  const [productResult,serviceResult]=await Promise.all([
    sb.from('command_items').select('command_id,quantity,unit_price_cents').eq('tenant_id',barberProfile.tenant_id).in('command_id',ids),
    sb.from('command_services').select('command_id,quantity,unit_price_cents').eq('tenant_id',barberProfile.tenant_id).in('command_id',ids)
  ]);
  if(!productResult.error){
    for(const item of productResult.data||[])totals.set(item.command_id,(totals.get(item.command_id)||0)+(Number(item.quantity)||0)*(Number(item.unit_price_cents)||0));
  }
  if(!serviceResult.error){
    commandServicesReady=true;
    for(const item of serviceResult.data||[])totals.set(item.command_id,(totals.get(item.command_id)||0)+(Number(item.quantity)||0)*(Number(item.unit_price_cents)||0));
  }else{
    commandServicesReady=false;
    $('#extraServiceSetupNotice')?.classList.remove('hidden');
  }
  return totals;
}

async function renderAppointments(){
  const host=$('#appointmentRows');
  if(!host)return;
  const totals=commandModuleReady?await commandTotalsById():new Map();
  if(!barberTodayAppointments.length){
    host.innerHTML=`<div class="empty">Nenhum cliente agendado para ${escapeHtml(earningsDateLabel(barberSelectedEarningsDate||localDateValue()).toLowerCase())}.</div>`;
    return;
  }
  host.innerHTML=barberTodayAppointments.map(a=>{
    const c=commandForAppointment(a.id);
    const productTotal=c?(totals.get(c.id)||0):0;
    const servicePrice=Number(a.price_cents||0);
    const commandTotal=servicePrice+productTotal;
    const commandText=c?`Comanda ${commandNumber(c.number)} · ${money(commandTotal)}`:'Abrir comanda';
    const commandState=c?.status==='closed'?'<span class="barber-command-state closed">Finalizada</span>':c?'<span class="barber-command-state">Aberta</span>':'';
    let primaryStatus='';
    if(a.status==='pending'||a.status==='confirmed')primaryStatus=`<button class="btn btn-sm btn-success" type="button" data-appointment-status="${a.id}" data-status="in_progress">Iniciar atendimento</button>`;
    else if(a.status==='in_progress')primaryStatus=`<button class="btn btn-sm btn-success" type="button" data-appointment-status="${a.id}" data-status="completed">Concluir atendimento</button>`;
    const secondary=(a.status==='pending'||a.status==='confirmed')?`<button class="btn btn-sm btn-outline" type="button" data-appointment-status="${a.id}" data-status="no_show">Não compareceu</button>`:'';
    return `<article class="barber-client-card" data-appointment-id="${a.id}">
      <div class="barber-client-time"><strong>${commandTime(a.starts_at)}</strong><span>${commandTime(a.ends_at)}</span></div>
      <div class="barber-client-main">
        <div class="barber-client-title"><div><strong>${escapeHtml(a.customer_name)}</strong><span>${escapeHtml(a.customer_phone||'')}</span></div>${statusBadge(a.status)}</div>
        <div class="barber-client-service"><span>${escapeHtml(a.services?.name||'Serviço')}</span><strong>${money(servicePrice)}</strong></div>
        <div class="barber-client-command-line">${commandState}<span>${c?commandText:'A comanda será criada automaticamente para este cliente.'}</span></div>
      </div>
      <div class="barber-client-actions">
        ${!c
          ? `<button class="btn btn-sm barber-command-button" type="button" data-open-client-command="${a.id}" ${commandModuleReady?'':'disabled'}>Abrir comanda</button>`
          : c.status==='open'
            ? `<button class="btn btn-sm barber-command-button" type="button" data-open-client-command="${a.id}">Fechar comanda</button>`
            : `<button class="btn btn-sm btn-outline barber-command-button" type="button" data-reopen-client-command="${a.id}">Comanda fechada</button>`}
        ${primaryStatus}${secondary}
      </div>
    </article>`;
  }).join('');
}

async function openClientCommand(appointmentId){
  if(!commandModuleReady)return toast('Atualize o banco com o arquivo ATUALIZAR_BANCO_1.1.32.sql.','warn');
  const appointment=appointmentById(appointmentId);
  if(!appointment)return toast('Cliente não encontrado no dia selecionado.','error');
  let command=commandForAppointment(appointmentId);
  if(!command){
    const {data,error}=await sb.from('commands').insert({
      tenant_id:barberProfile.tenant_id,
      barber_id:barberProfile.id,
      appointment_id:appointment.id,
      customer_name:appointment.customer_name,
      created_by:barberProfile.id
    }).select('id,number,customer_name,status,created_at,closed_at,appointment_id').single();
    if(error){
      // Se dois cliques criarem ao mesmo tempo, recarrega e usa a comanda já criada.
      await loadCommandModule(barberTodayAppointments);
      command=commandForAppointment(appointmentId);
      if(!command)return toast(error.message,'error');
    }else{
      command=data;
      barberCommands.push(command);
      setText('openCommandCount',barberCommands.filter(c=>c.status==='open').length);
      toast(`Comanda ${commandNumber(command.number)} criada para ${appointment.customer_name}.`);
    }
    await renderAppointments();
  }
  await showCommand(command.id);
}

function requestReopenClientCommand(appointmentId){
  const appointment=appointmentById(appointmentId);
  const command=commandForAppointment(appointmentId);
  if(!appointment||!command)return toast('Comanda não encontrada.','error');
  if(command.status==='open')return showCommand(command.id);
  pendingReopenAppointmentId=appointmentId;
  setText('reopenCommandTitle',`Reabrir comanda ${commandNumber(command.number)}`);
  setText('reopenCommandMeta',`${appointment.customer_name} · ${appointment.services?.name||'Serviço'}`);
  const password=$('#ownerPasswordReopen');
  if(password)password.value='';
  openBarberDialog('reopenCommandDialog');
  setTimeout(()=>password?.focus(),50);
}

async function reopenClientCommandWithOwnerPassword(){
  const appointmentId=pendingReopenAppointmentId;
  const appointment=appointmentById(appointmentId);
  const command=commandForAppointment(appointmentId);
  const password=$('#ownerPasswordReopen')?.value||'';
  if(!appointment||!command)return toast('Comanda não encontrada.','error');
  if(!password)return toast('Digite a senha do dono.','warn');
  const button=$('#confirmReopenCommandButton');
  if(button){button.disabled=true;button.textContent='Verificando...'}
  try{
    await invokeEdgeFunction('admin-actions',{action:'reopen_command_with_owner_password',commandId:command.id,ownerPassword:password});
    closeBarberDialog('reopenCommandDialog');
    pendingReopenAppointmentId=null;
    toast(`Comanda ${commandNumber(command.number)} reaberta com autorização do dono.`);
    await loadBarber();
    const reopened=commandForAppointment(appointmentId);
    if(reopened?.status==='open')await showCommand(reopened.id);
  }catch(error){
    toast(error?.message||'Não foi possível reabrir a comanda.','error');
    $('#ownerPasswordReopen')?.select();
  }finally{
    if(button){button.disabled=false;button.textContent='Autorizar e abrir'}
  }
}

async function showCommand(commandId){
  const command=barberCommands.find(c=>c.id===commandId);
  if(!command)return toast('Comanda não encontrada.','error');
  activeCommandId=commandId;
  await Promise.all([loadBarberProducts(),loadBarberServices()]);
  const appointment=command.appointment_id?appointmentById(command.appointment_id):null;
  const isOpen=command.status==='open';
  setText('commandTitle',`Comanda ${commandNumber(command.number)}`);
  setText('commandMeta',appointment?`${appointment.customer_name} · ${commandTime(appointment.starts_at)} · ${appointment.services?.name||'Serviço'}`:`${command.customer_name||'Cliente'} · aberta às ${commandTime(command.created_at)}`);
  const serviceBox=$('#commandServiceSummary');
  if(serviceBox){
    serviceBox.innerHTML=appointment?`<div><span>Serviço agendado</span><strong>${escapeHtml(appointment.services?.name||'Serviço')}</strong></div><strong>${money(appointment.price_cents||0)}</strong>`:'<div><span>Comanda avulsa</span><strong>Sem serviço vinculado</strong></div>';
  }
  $('#commandQuantity').value='1';
  renderCommandProductOptions();
  renderCommandServiceOptions(appointment);
  $('#addProductForm')?.classList.toggle('hidden',!isOpen);
  const serviceForm=$('#addServiceForm');
  if(serviceForm)serviceForm.classList.toggle('hidden',!isOpen);
  const serviceSelect=$('#commandService');
  const serviceAddButton=$('#addServiceButton');
  const availableExtraServices=barberServices.filter(service=>service.active!==false&&(!appointment?.service_id||service.id!==appointment.service_id));
  if(serviceSelect)serviceSelect.disabled=!isOpen||!commandServicesReady||!availableExtraServices.length;
  if(serviceAddButton)serviceAddButton.disabled=!isOpen||!commandServicesReady||!availableExtraServices.length;
  const finish=$('#finishCommandButton');if(finish){finish.classList.toggle('hidden',!isOpen);finish.disabled=!isOpen}

  const [itemsResult,servicesResult]=await Promise.all([
    sb.from('command_items').select('id,product_id,quantity,unit_price_cents').eq('tenant_id',barberProfile.tenant_id).eq('command_id',commandId).order('created_at'),
    sb.from('command_services').select('id,service_id,quantity,unit_price_cents').eq('tenant_id',barberProfile.tenant_id).eq('command_id',commandId).order('created_at')
  ]);
  if(itemsResult.error)return toast(itemsResult.error.message,'error');
  let extraServices=[];
  if(servicesResult.error){
    commandServicesReady=false;
    $('#extraServiceSetupNotice')?.classList.remove('hidden');
    if(serviceSelect)serviceSelect.disabled=true;
    if(serviceAddButton)serviceAddButton.disabled=true;
  }else{
    commandServicesReady=true;
    $('#extraServiceSetupNotice')?.classList.add('hidden');
    extraServices=servicesResult.data||[];
  }

  let extraServiceTotal=0;
  const extraHost=$('#commandExtraServices');
  if(extraHost){
    extraHost.innerHTML=extraServices.map(item=>{
      const service=barberServices.find(s=>s.id===item.service_id);
      const subtotal=Number(item.quantity||0)*Number(item.unit_price_cents||0);extraServiceTotal+=subtotal;
      return `<div class="command-item command-service-item"><div><strong>${escapeHtml(service?.name||'Serviço adicional')}</strong><span>${item.quantity>1?`${item.quantity} × `:''}${money(item.unit_price_cents)}</span></div><div class="command-item-side"><strong>${money(subtotal)}</strong>${isOpen?`<button type="button" class="command-remove" data-remove-command-service="${item.id}" aria-label="Remover serviço">×</button>`:''}</div></div>`;
    }).join('')||'<div class="empty">Nenhum serviço adicional.</div>';
  }

  const items=itemsResult.data||[];
  let productTotal=0;
  $('#commandItems').innerHTML=items.map(item=>{
    const product=barberProducts.find(p=>p.id===item.product_id);
    const subtotal=Number(item.quantity||0)*Number(item.unit_price_cents||0);productTotal+=subtotal;
    return `<div class="command-item"><div><strong>${escapeHtml(product?.name||'Produto')}</strong><span>${item.quantity} × ${money(item.unit_price_cents)}</span></div><div class="command-item-side"><strong>${money(subtotal)}</strong>${isOpen?`<button type="button" class="command-remove" data-remove-command-item="${item.id}" aria-label="Remover produto">×</button>`:''}</div></div>`;
  }).join('')||'<div class="empty">Nenhum produto adicionado.</div>';
  setText('commandTotal',money(productTotal+extraServiceTotal+Number(appointment?.price_cents||0)));
  openBarberDialog('commandDialog');
}

async function addServiceToCommand(serviceId){
  if(!activeCommandId)return toast('Abra uma comanda primeiro.','error');
  if(!commandServicesReady)return toast('Execute ATUALIZAR_BANCO_1.1.34.sql no Supabase para adicionar serviços extras.','warn');
  const command=barberCommands.find(c=>c.id===activeCommandId);
  if(!command||command.status!=='open')return toast('Esta comanda já foi finalizada.','warn');
  const appointment=command.appointment_id?appointmentById(command.appointment_id):null;
  const service=barberServices.find(s=>s.id===serviceId&&s.active!==false);
  if(!service)return toast('Selecione um serviço disponível.','error');
  if(appointment?.service_id===service.id)return toast('Esse já é o serviço principal do agendamento.','warn');
  const existing=await sb.from('command_services').select('id,quantity').eq('tenant_id',barberProfile.tenant_id).eq('command_id',activeCommandId).eq('service_id',service.id).maybeSingle();
  if(existing.error)return toast(existing.error.message,'error');
  let result;
  if(existing.data)result=await sb.from('command_services').update({quantity:Number(existing.data.quantity||0)+1}).eq('id',existing.data.id).eq('tenant_id',barberProfile.tenant_id);
  else result=await sb.from('command_services').insert({tenant_id:barberProfile.tenant_id,command_id:activeCommandId,service_id:service.id,quantity:1,unit_price_cents:service.effective_price_cents});
  if(result.error)return toast(result.error.message,'error');
  toast('Serviço adicional incluído na comanda.');
  await loadCommandModule(barberTodayAppointments);
  await renderAppointments();
  await showCommand(activeCommandId);
}

async function removeCommandService(itemId){
  if(!activeCommandId)return;
  const command=barberCommands.find(c=>c.id===activeCommandId);
  if(!command||command.status!=='open')return;
  const {error}=await sb.from('command_services').delete().eq('id',itemId).eq('tenant_id',barberProfile.tenant_id);
  if(error)return toast(error.message,'error');
  toast('Serviço removido da comanda.');
  await loadCommandModule(barberTodayAppointments);
  await renderAppointments();
  await showCommand(activeCommandId);
}

async function addProductToCommand(productId,quantity){
  if(!activeCommandId)return toast('Abra uma comanda primeiro.','error');
  const command=barberCommands.find(c=>c.id===activeCommandId);
  if(!command||command.status!=='open')return toast('Esta comanda já foi finalizada.','warn');
  if(!stockModuleReady)return toast('Atualize o banco para a versão 1.1.45 antes de lançar produtos.','warn');
  const product=barberProducts.find(p=>p.id===productId&&p.active);
  if(!product)return toast('Selecione um produto com estoque disponível.','error');
  const qty=Math.max(1,Math.min(99,Number(quantity)||1));
  const available=Math.max(0,Number(product.stock_quantity||0));
  if(qty>available)return toast(`Estoque insuficiente. Disponível: ${available} unidade${available===1?'':'s'}.`,'warn');
  const existing=await sb.from('command_items').select('id,quantity').eq('tenant_id',barberProfile.tenant_id).eq('command_id',activeCommandId).eq('product_id',product.id).maybeSingle();
  if(existing.error)return toast(existing.error.message,'error');
  let result;
  if(existing.data)result=await sb.from('command_items').update({quantity:Number(existing.data.quantity||0)+qty}).eq('id',existing.data.id);
  else result=await sb.from('command_items').insert({tenant_id:barberProfile.tenant_id,command_id:activeCommandId,product_id:product.id,quantity:qty,unit_price_cents:product.price_cents});
  if(result.error)return toast(result.error.message,'error');
  toast('Produto adicionado.');
  await loadCommandModule(barberTodayAppointments);
  await renderAppointments();
  await showCommand(activeCommandId);
}

async function removeCommandItem(itemId){
  if(!activeCommandId)return;
  const command=barberCommands.find(c=>c.id===activeCommandId);
  if(!command||command.status!=='open')return;
  const {error}=await sb.from('command_items').delete().eq('id',itemId).eq('tenant_id',barberProfile.tenant_id);
  if(error)return toast(error.message,'error');
  await loadCommandModule(barberTodayAppointments);
  await renderAppointments();
  await showCommand(activeCommandId);
}

async function finishCommand(){
  if(!activeCommandId)return;
  const command=barberCommands.find(c=>c.id===activeCommandId);
  if(!command||command.status!=='open')return;
  if(!await confirmMessage(`Fechar a comanda ${commandNumber(command.number)}?`,{title:'Fechar comanda',okText:'Fechar comanda',cancelText:'Cancelar'}))return;
  const {error}=await sb.from('commands').update({status:'closed',closed_at:new Date().toISOString()}).eq('id',activeCommandId).eq('tenant_id',barberProfile.tenant_id);
  if(error)return toast(error.message,'error');
  if(command.appointment_id){
    await sb.from('appointments').update({status:'completed'}).eq('id',command.appointment_id).eq('tenant_id',barberProfile.tenant_id).eq('barber_id',barberProfile.id);
  }
  closeBarberDialog('commandDialog');activeCommandId=null;toast('Comanda fechada e atendimento concluído.');await loadBarber();
}

async function changeStatus(id,status){
  const {error}=await sb.from('appointments').update({status}).eq('id',id).eq('tenant_id',barberProfile.tenant_id).eq('barber_id',barberProfile.id);
  if(error)return toast(error.message,'error');
  toast(status==='in_progress'?'Atendimento iniciado.':status==='completed'?'Atendimento concluído.':status==='no_show'?'Marcado como não compareceu.':'Status atualizado.');
  await loadBarber();
}

function parseCheckinCode(raw){
  let value=String(raw||'').trim();
  if(!value)return '';
  try{
    if(/^https?:\/\//i.test(value)){const url=new URL(value);value=url.searchParams.get('checkin')||value}
  }catch{}
  if(value.toUpperCase().startsWith('NRCHK:'))value=value.split(':').pop()||'';
  return value.replace(/[^a-z0-9]/gi,'').slice(0,16).toUpperCase();
}
async function stopCheckinScanner(){
  const scanner=checkinScanner;checkinScanner=null;
  if(!scanner)return;
  try{await scanner.stop()}catch{}
  try{await scanner.clear()}catch{}
}
function setCheckinCameraFallback(message='Não foi possível abrir a câmera automaticamente.'){
  const notice=$('#checkinCameraNotice'),actions=$('#checkinCameraActions');
  if(notice){notice.textContent=message;notice.classList.remove('hidden')}
  actions?.classList.remove('hidden');
}
function hideCheckinCameraFallback(){
  $('#checkinCameraNotice')?.classList.add('hidden');
  $('#checkinCameraActions')?.classList.add('hidden');
}
async function closeCheckinScannerDialog(){
  await stopCheckinScanner();
  const input=$('#checkinQrPhotoInput');if(input)input.value='';
  closeBarberDialog('checkinDialog');
}
function checkinResultMessage(data){
  const name=data?.customer_name||'Cliente';
  if(!data?.loyalty_enabled)return `Chegada de ${name} validada com sucesso.`;
  const base=`Chegada de ${name} validada. Fidelidade: ${Number(data.visits_balance||0)}/${Number(data.visits_required||0)}.`;
  if(Number(data.reward_earned||0)>0)return `${base}
🎁 Nova recompensa liberada: ${data.reward_name}.`;
  if(Number(data.rewards_available||0)>0)return `${base}
O cliente possui ${Number(data.rewards_available)} recompensa(s) disponível(is).`;
  return base;
}
async function validateCheckinCode(raw){
  const code=parseCheckinCode(raw);
  if(!code)return toast('Código de chegada inválido.','error');
  if(checkinBusy)return;
  checkinBusy=true;
  const button=$('#validateCheckinButton');if(button)button.disabled=true;
  try{
    const {data,error}=await sb.rpc('validate_appointment_checkin',{p_code:code});
    if(error)throw error;
    await closeCheckinScannerDialog();
    toast(checkinResultMessage(data),Number(data?.reward_earned||0)>0?'success':'ok');
    await loadBarber();
  }catch(error){toast(error?.message||'Não foi possível validar a chegada.','error')}
  finally{checkinBusy=false;if(button)button.disabled=false}
}
function cameraErrorText(error){
  const name=String(error?.name||'');
  if(!window.isSecureContext)return 'A câmera do navegador precisa de HTTPS. Abra o sistema pelo endereço seguro (https://).';
  if(name==='NotAllowedError'||name==='PermissionDeniedError')return 'A permissão da câmera foi negada. Libere a câmera nas configurações do navegador e tente novamente.';
  if(name==='NotFoundError'||name==='DevicesNotFoundError')return 'Nenhuma câmera disponível foi encontrada neste aparelho.';
  if(name==='NotReadableError'||name==='TrackStartError')return 'A câmera está sendo usada por outro aplicativo. Feche-o e tente novamente.';
  return 'Não foi possível abrir a câmera automaticamente. Tente novamente ou use a câmera do celular para fotografar o QR Code.';
}
async function getPreferredCheckinCamera(){
  if(typeof Html5Qrcode==='undefined')throw new Error('Leitor de QR não carregado');
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Câmera não suportada neste navegador');
  let permissionStream=null;
  try{
    permissionStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
  }finally{
    permissionStream?.getTracks?.().forEach(track=>track.stop());
  }
  const cameras=await Html5Qrcode.getCameras();
  if(!cameras?.length)return {facingMode:{ideal:'environment'}};
  const backWords=/back|rear|environment|traseira|trasera|arrière|achter/i;
  const preferred=cameras.find(c=>backWords.test(c.label||''))||cameras[cameras.length-1]||cameras[0];
  return preferred?.id||{facingMode:{ideal:'environment'}};
}
async function startCheckinCamera(){
  hideCheckinCameraFallback();
  if(!window.isSecureContext){setCheckinCameraFallback(cameraErrorText({}));return false}
  if(typeof Html5Qrcode==='undefined'){setCheckinCameraFallback('O leitor de QR Code não carregou. Verifique a internet e tente novamente.');return false}
  try{
    await stopCheckinScanner();
    const camera=await getPreferredCheckinCamera();
    checkinScanner=new Html5Qrcode('qrReader');
    const config={fps:10,qrbox:(w,h)=>{const size=Math.max(170,Math.min(250,Math.floor(Math.min(w,h)*.72)));return {width:size,height:size}},aspectRatio:1};
    await checkinScanner.start(camera,config,decoded=>validateCheckinCode(decoded),()=>{});
    return true;
  }catch(error){
    console.warn('Câmera para QR indisponível:',error?.name,error?.message||error);
    await stopCheckinScanner();
    setCheckinCameraFallback(cameraErrorText(error));
    return false;
  }
}
async function scanCheckinQrPhoto(file){
  if(!file)return;
  if(typeof Html5Qrcode==='undefined')return toast('Leitor de QR Code indisponível.','error');
  try{
    await stopCheckinScanner();
    hideCheckinCameraFallback();
    checkinScanner=new Html5Qrcode('qrReader');
    const decoded=await checkinScanner.scanFile(file,true);
    await validateCheckinCode(decoded);
  }catch(error){
    console.warn('Não foi possível ler o QR da foto:',error?.message||error);
    setCheckinCameraFallback('Não consegui identificar um QR Code nessa imagem. Tente aproximar mais a câmera ou digite o código abaixo.');
  }finally{
    try{await checkinScanner?.clear()}catch{}
    checkinScanner=null;
    const input=$('#checkinQrPhotoInput');if(input)input.value='';
  }
}
async function openCheckinScannerDialog(){
  const manual=$('#manualCheckinCode');if(manual)manual.value='';
  hideCheckinCameraFallback();
  openBarberDialog('checkinDialog');
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  await startCheckinCamera();
}

async function loadBarberAppointmentsForDate(dateValue,{reloadCommands=true}={}){
  if(!barberProfile)return;
  const value=dateValue||barberSelectedEarningsDate||localDateValue();
  barberSelectedEarningsDate=value;
  const {start,end}=localDateBounds(value);
  const {data,error}=await sb.from('appointments')
    .select('id,service_id,starts_at,ends_at,status,customer_name,customer_phone,price_cents,services(name)')
    .eq('tenant_id',barberProfile.tenant_id)
    .eq('barber_id',barberProfile.id)
    .gte('starts_at',start.toISOString())
    .lt('starts_at',end.toISOString())
    .order('starts_at');
  if(error){toast(error.message,'error');return}
  barberTodayAppointments=data||[];
  setText('todayCount',barberTodayAppointments.length);
  syncSelectedAgendaLabels(value,barberTodayAppointments.length);
  if(reloadCommands)await loadCommandModule(barberTodayAppointments);
  await renderAppointments();
}

async function loadBarber(){
  barberProfile=barberProfile||await guard(['barber']);
  setText('barberName',barberProfile.full_name);syncBarberUserMenu();updateBarberPublicAgendaUrl();
  const selectedDate=barberSelectedEarningsDate||$('#barberEarningsDate')?.value||localDateValue();
  barberSelectedEarningsDate=selectedDate;
  await Promise.all([
    loadBarberFinancialDashboard(),
    loadBarberAppointmentsForDate(selectedDate,{reloadCommands:true})
  ]);
}

document.addEventListener('DOMContentLoaded',async()=>{
  const checkinDialog=$('#checkinDialog');
  if(checkinDialog){try{if(checkinDialog.open&&typeof checkinDialog.close==='function')checkinDialog.close()}catch{}checkinDialog.removeAttribute('open')}
  await stopCheckinScanner();
  const initialCheckin=qs('checkin');
  if(initialCheckin){try{sessionStorage.setItem('na_regua_pending_checkin',initialCheckin)}catch{}}
  $('#barberUserMenuButton')?.addEventListener('click',e=>{e.stopPropagation();toggleBarberUserMenu()});
  $('#barberUserMenu')?.addEventListener('click',e=>e.stopPropagation());
  document.addEventListener('click',closeBarberUserMenu);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeBarberUserMenu()});
  $('#barberUserMenu')?.addEventListener('click',async e=>{
    const action=e.target.closest('[data-barber-menu-action]')?.dataset.barberMenuAction;
    if(!action)return;
    closeBarberUserMenu();
    if(action==='refresh')return loadBarber();
    if(action==='open-public')return openBarberPublicAgenda();
    if(action==='copy-public')return copyBarberPublicAgenda();
    if(action==='signout')return signOut();
  });
  $('#installApp')?.addEventListener('click',async()=>{closeBarberUserMenu();await installApp()});
  $('#appointmentRows')?.addEventListener('click',async e=>{
    const commandButton=e.target.closest('[data-open-client-command]');
    if(commandButton)return openClientCommand(commandButton.dataset.openClientCommand);
    const reopenCommandButton=e.target.closest('[data-reopen-client-command]');
    if(reopenCommandButton)return requestReopenClientCommand(reopenCommandButton.dataset.reopenClientCommand);
    const statusButton=e.target.closest('[data-appointment-status]');
    if(statusButton)return changeStatus(statusButton.dataset.appointmentStatus,statusButton.dataset.status);
  });
  $('#addServiceForm')?.addEventListener('submit',async e=>{e.preventDefault();await addServiceToCommand($('#commandService').value)});
  $('#commandExtraServices')?.addEventListener('click',e=>{const btn=e.target.closest('[data-remove-command-service]');if(btn)removeCommandService(btn.dataset.removeCommandService)});
  $('#addProductForm')?.addEventListener('submit',async e=>{e.preventDefault();await addProductToCommand($('#commandProduct').value,$('#commandQuantity').value)});
  $('#commandItems')?.addEventListener('click',e=>{const btn=e.target.closest('[data-remove-command-item]');if(btn)removeCommandItem(btn.dataset.removeCommandItem)});
  $('#finishCommandButton')?.addEventListener('click',finishCommand);
  $('#reopenCommandForm')?.addEventListener('submit',async e=>{e.preventDefault();await reopenClientCommandWithOwnerPassword()});
  $('#openCheckinScanner')?.addEventListener('click',openCheckinScannerDialog);
  $('#retryCheckinCamera')?.addEventListener('click',startCheckinCamera);
  $('#captureCheckinQr')?.addEventListener('click',()=>$('#checkinQrPhotoInput')?.click());
  $('#checkinQrPhotoInput')?.addEventListener('change',e=>scanCheckinQrPhoto(e.target.files?.[0]));
  $('#manualCheckinForm')?.addEventListener('submit',async e=>{e.preventDefault();await validateCheckinCode($('#manualCheckinCode').value)});
  initBarberTabs();
  $('#barberEarningsMonth')?.addEventListener('change',async e=>{if(e.target.value)await loadBarberFinancialDashboard(e.target.value)});
  $('#barberEarningsCurrentMonth')?.addEventListener('click',async()=>{await loadBarberFinancialDashboard(localMonthValue())});
  $('#barberEarningsDate')?.addEventListener('change',async e=>{if(e.target.value)await Promise.all([loadSelectedEarnings(e.target.value,{reuseMonth:true}),loadBarberAppointmentsForDate(e.target.value,{reloadCommands:true})])});
  $('#barberEarningsToday')?.addEventListener('click',async()=>{const value=localDateValue();await Promise.all([loadSelectedEarnings(value,{reuseMonth:true}),loadBarberAppointmentsForDate(value,{reloadCommands:true})])});
  $('#barberEarningsYesterday')?.addEventListener('click',async()=>{const d=new Date();d.setDate(d.getDate()-1);const value=localDateValue(d);await Promise.all([loadSelectedEarnings(value,{reuseMonth:true}),loadBarberAppointmentsForDate(value,{reloadCommands:true})])});
  await loadBarber();
  let checkinFromQr=qs('checkin');
  if(!checkinFromQr){try{checkinFromQr=sessionStorage.getItem('na_regua_pending_checkin')||''}catch{}}
  if(checkinFromQr){try{sessionStorage.removeItem('na_regua_pending_checkin')}catch{}const cleanUrl=new URL(location.href);cleanUrl.searchParams.delete('checkin');history.replaceState(null,'',cleanUrl.href);await validateCheckinCode(checkinFromQr)}
});
