let ownerProfile, services=[], barbers=[], products=[], barberServiceLinks=[], currentPublicUrl='', financialReportRows=[], ownerMonthAppointments=[], loyaltyCustomers=[], loyaltySettings={enabled:false,visits_required:10,reward_name:'1 serviço grátis'}, loyaltyModuleReady=true;
const OWNER_TAB_NAMES={overview:'Visão geral',finance:'Financeiro',services:'Serviços',products:'Produtos',loyalty:'Fidelidade',barbers:'Barbeiros'};
function centerOwnerTab(button,behavior='smooth'){
  const track=$('#ownerSectionTabs');
  if(!track||!button)return;
  const buttons=[...track.querySelectorAll('[data-owner-tab]')];
  const index=buttons.indexOf(button);
  const maxScroll=Math.max(0,track.scrollWidth-track.clientWidth);
  let left=button.offsetLeft-(track.clientWidth-button.offsetWidth)/2;
  if(index===0)left=0;
  else if(index===buttons.length-1)left=maxScroll;
  else left=Math.min(maxScroll,Math.max(0,left));
  track.scrollTo({left,behavior});
}
function setOwnerTab(tab,{remember=true}={}){
  const selected=OWNER_TAB_NAMES[tab]?tab:'overview';
  document.querySelectorAll('[data-owner-panel]').forEach(panel=>panel.classList.toggle('hidden',panel.dataset.ownerPanel!==selected));
  document.querySelectorAll('[data-owner-tab]').forEach(button=>{
    const active=button.dataset.ownerTab===selected;
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-selected',active?'true':'false');
  });
  if(remember){try{sessionStorage.setItem('na_regua_owner_tab',selected)}catch{}}
  const activeButton=document.querySelector(`[data-owner-tab="${selected}"]`);
  requestAnimationFrame(()=>centerOwnerTab(activeButton,remember?'smooth':'auto'));
}
function initOwnerTabCarousel(){
  const track=$('#ownerSectionTabs');
  if(!track)return;
  let dragging=false,moved=false,startX=0,startScroll=0,suppressClick=false;
  const finishDrag=(event)=>{
    if(!dragging)return;
    dragging=false;
    if(moved){suppressClick=true;setTimeout(()=>{suppressClick=false},0)}
    track.classList.remove('is-dragging','is-grabbing');
    try{if(event&&track.hasPointerCapture?.(event.pointerId))track.releasePointerCapture(event.pointerId)}catch{}
  };
  track.addEventListener('pointerdown',event=>{
    if(event.pointerType==='mouse'&&event.button!==0)return;
    dragging=true;moved=false;startX=event.clientX;startScroll=track.scrollLeft;
    track.classList.add('is-grabbing');
    try{track.setPointerCapture(event.pointerId)}catch{}
  });
  track.addEventListener('pointermove',event=>{
    if(!dragging)return;
    const delta=event.clientX-startX;
    if(Math.abs(delta)>4){moved=true;track.classList.add('is-dragging')}
    if(!moved)return;
    track.scrollLeft=startScroll-delta;
    if(event.cancelable)event.preventDefault();
  },{passive:false});
  track.addEventListener('pointerup',finishDrag);
  track.addEventListener('pointercancel',finishDrag);
  track.addEventListener('lostpointercapture',()=>{if(dragging)finishDrag()});
  track.addEventListener('click',event=>{
    if(!suppressClick)return;
    event.preventDefault();event.stopImmediatePropagation();
  },true);
}
function initOwnerTabs(){
  let initial='overview';
  try{initial=sessionStorage.getItem('na_regua_owner_tab')||'overview'}catch{}
  setOwnerTab(initial,{remember:false});
  document.querySelectorAll('[data-owner-tab]').forEach(button=>button.addEventListener('click',()=>setOwnerTab(button.dataset.ownerTab)));
  document.querySelectorAll('[data-owner-tab-target]').forEach(card=>{
    const open=()=>setOwnerTab(card.dataset.ownerTabTarget);
    card.addEventListener('click',open);
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}});
  });
  initOwnerTabCarousel();
}
function openOwnerDialog(id){const dialog=document.getElementById(id);if(!dialog)return;if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','')}
function closeOwnerDialog(id){const dialog=document.getElementById(id);if(!dialog)return;if(dialog.open&&typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open')}

function ownerInitial(name){
  const clean=String(name||'Dono').trim();
  return (clean[0]||'D').toUpperCase();
}
function syncOwnerUserMenu(){
  const name=ownerProfile?.full_name||'Dono';
  const tenantName=ownerProfile?.tenant?.name||'Barbearia';
  setText('ownerName',name);
  setText('ownerMenuName',name);
  setText('ownerMenuTenant',tenantName);
  setText('ownerUserAvatar',ownerInitial(name));
  setText('ownerMenuAvatar',ownerInitial(name));
}
function setOwnerUserMenu(open){
  const menu=$('#ownerUserMenu'),button=$('#ownerUserMenuButton');
  if(!menu||!button)return;
  menu.classList.toggle('hidden',!open);
  button.setAttribute('aria-expanded',open?'true':'false');
}
function closeOwnerUserMenu(){setOwnerUserMenu(false)}
function toggleOwnerUserMenu(){
  const menu=$('#ownerUserMenu');
  if(!menu)return;
  setOwnerUserMenu(menu.classList.contains('hidden'));
}

function buildPublicBarbershopUrl(slug){
  const cleanSlug=String(slug||'').trim();
  if(!cleanSlug)return '';
  const url=new URL('agendar.html',location.href);
  url.searchParams.set('slug',cleanSlug);
  return url.href;
}
function updatePublicLink(tenant){
  const slug=String(tenant?.slug||'').trim();
  currentPublicUrl=buildPublicBarbershopUrl(slug);
  if(slug)localStorage.setItem('na_regua_current_tenant_slug',slug);
}
function accessCurrentPublicLink(){
  if(!currentPublicUrl)return toast('Não foi possível identificar o link desta barbearia.','error');
  window.open(currentPublicUrl,'_blank','noopener');
}
async function copyCurrentPublicLink(){
  if(!currentPublicUrl)return toast('Link público indisponível.','error');
  try{
    if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(currentPublicUrl);
    else{
      const area=document.createElement('textarea');area.value=currentPublicUrl;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();
    }
    toast('Link público copiado.');
  }catch(error){toast('Não foi possível copiar o link.','error')}
}

function renderServicePicker(containerId,selectedIds=[]){
  const box=document.getElementById(containerId);
  if(!box)return;
  const selected=new Set((selectedIds||[]).map(String));
  if(!services.length){
    box.innerHTML='<div class="service-picker-empty">Cadastre pelo menos um serviço antes de vincular o barbeiro.</div>';
    return;
  }
  box.innerHTML=services.map(service=>`<label class="service-picker-item ${service.active?'':'is-inactive'}"><input type="checkbox" value="${service.id}" ${selected.has(String(service.id))?'checked':''}><span class="service-picker-check">✓</span><span class="service-picker-copy"><strong>${escapeHtml(service.name)}</strong><small>${money(service.price_cents)} · ${service.duration_minutes} min${service.active?'':' · Inativo'}</small></span></label>`).join('');
}
function getSelectedServiceIds(containerId){
  return Array.from(document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)).map(input=>input.value);
}
function getBarberServiceIds(barberId){
  return barberServiceLinks.filter(link=>link.barber_id===barberId && link.active!==false).map(link=>link.service_id);
}
function barberServicesHtml(barberId){
  const names=getBarberServiceIds(barberId).map(serviceId=>services.find(service=>service.id===serviceId)?.name).filter(Boolean);
  if(!names.length)return '<span class="muted barber-no-services">Nenhum vinculado</span>';
  return `<div class="barber-service-tags">${names.map(name=>`<span>${escapeHtml(name)}</span>`).join('')}</div>`;
}
async function syncBarberServices(barberId,selectedServiceIds){
  const selected=new Set((selectedServiceIds||[]).map(String));
  const current=barberServiceLinks.filter(link=>link.barber_id===barberId);
  const removeIds=current.filter(link=>!selected.has(String(link.service_id))).map(link=>link.service_id);
  const upsertRows=Array.from(selected).map(service_id=>({tenant_id:ownerProfile.tenant_id,barber_id:barberId,service_id,active:true}));
  if(upsertRows.length){
    const {error}=await sb.from('barber_services').upsert(upsertRows,{onConflict:'barber_id,service_id'});
    if(error)throw error;
  }
  if(removeIds.length){
    const {error}=await sb.from('barber_services').delete().eq('tenant_id',ownerProfile.tenant_id).eq('barber_id',barberId).in('service_id',removeIds);
    if(error)throw error;
  }
}
function openNewBarber(){
  const form=$('#barberForm');
  form?.reset();
  const commission=form?.querySelector('[name="commission"]');
  if(commission)commission.value='0';
  renderServicePicker('barberServicePicker',[]);
  openOwnerDialog('barberDialog');
}

function stockInfo(product){
  const qty=Math.max(0,Number(product?.stock_quantity||0));
  const min=Math.max(0,Number(product?.min_stock_quantity||0));
  if(qty<=0)return {qty,min,label:'Sem estoque',className:'stock-out'};
  if(qty<=min)return {qty,min,label:'Estoque baixo',className:'stock-low'};
  return {qty,min,label:'Em estoque',className:'stock-ok'};
}
function renderStockSummary(){
  const units=products.reduce((sum,p)=>sum+Math.max(0,Number(p.stock_quantity||0)),0);
  const low=products.filter(p=>{const i=stockInfo(p);return p.active!==false&&(i.qty<=i.min)}).length;
  const costValue=products.reduce((sum,p)=>sum+Math.max(0,Number(p.stock_quantity||0))*Math.max(0,Number(p.cost_cents||0)),0);
  const saleValue=products.reduce((sum,p)=>sum+Math.max(0,Number(p.stock_quantity||0))*Math.max(0,Number(p.price_cents||0)),0);
  setText('stockUnitsTotal',String(units));setText('stockLowCount',String(low));setText('stockCostValue',money(costValue));setText('stockSaleValue',money(saleValue));
}
function renderProducts(){
  const rows=$('#productRows');
  if(!rows)return;
  renderStockSummary();
  rows.innerHTML=products.map(p=>{
    const cost=Number(p.cost_cents||0),price=Number(p.price_cents||0),profit=price-cost,stock=stockInfo(p);
    return `<tr><td data-label="Produto"><strong>${escapeHtml(p.name)}</strong></td><td data-label="Custo">${money(cost)}</td><td data-label="Venda"><strong>${money(price)}</strong></td><td data-label="Lucro"><strong>${money(profit)}</strong></td><td data-label="Estoque"><div class="stock-cell"><strong>${stock.qty} un.</strong><span class="stock-pill ${stock.className}">${stock.label}</span><small>Mín.: ${stock.min}</small></div></td><td data-label="Status"><span class="badge ${p.active?'badge-active':'badge-suspended'}">${p.active?'Ativo':'Inativo'}</span></td><td data-label="Ações"><div class="product-actions"><button class="btn btn-sm" type="button" data-stock-product="${p.id}">Estoque</button><button class="btn btn-sm btn-outline" type="button" data-edit-product="${p.id}">Editar</button></div></td></tr>`;
  }).join('')||'<tr><td colspan="7" class="empty">Nenhum produto cadastrado.</td></tr>';
}

async function refreshProducts(){
  const result=await sb.from('products').select('id,name,cost_cents,price_cents,stock_quantity,min_stock_quantity,active').eq('tenant_id',ownerProfile.tenant_id).order('name');
  if(result.error){
    products=[];renderStockSummary();
    $('#stockSetupNotice')?.classList.remove('hidden');
    const rows=$('#productRows');
    if(rows)rows.innerHTML='<tr><td colspan="7" class="empty">Execute ATUALIZAR_BANCO_1.1.45.sql no Supabase para ativar o controle de estoque.</td></tr>';
    console.warn('Produtos/estoque indisponíveis:',result.error.message);
    return;
  }
  $('#stockSetupNotice')?.classList.add('hidden');
  products=result.data||[];
  renderProducts();
}

function stockMovementLabel(type){
  return ({initial:'Estoque inicial',entry:'Entrada',exit:'Saída',adjustment:'Ajuste',sale:'Venda na comanda',return:'Devolução da comanda'})[type]||type||'Movimentação';
}
function stockMovementDate(value){
  try{return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value))}catch{return '-'}
}
async function loadStockMovements(productId){
  const host=$('#stockMovementList');if(!host)return;
  host.innerHTML='<div class="empty">Carregando movimentações...</div>';
  const {data,error}=await sb.from('stock_movements').select('id,movement_type,quantity_delta,balance_after,note,created_at').eq('tenant_id',ownerProfile.tenant_id).eq('product_id',productId).order('created_at',{ascending:false}).limit(20);
  if(error){host.innerHTML='<div class="empty">Não foi possível carregar o histórico.</div>';return}
  host.innerHTML=(data||[]).map(m=>{const delta=Number(m.quantity_delta||0);return `<div class="stock-movement"><div><strong>${escapeHtml(stockMovementLabel(m.movement_type))}</strong><small>${stockMovementDate(m.created_at)}${m.note?` · ${escapeHtml(m.note)}`:''}</small></div><div class="stock-movement-value ${delta<0?'is-out':'is-in'}"><strong>${delta>0?'+':''}${delta}</strong><small>Saldo ${Number(m.balance_after||0)}</small></div></div>`}).join('')||'<div class="empty">Nenhuma movimentação registrada.</div>';
}
async function openStockControl(productId){
  const product=products.find(p=>p.id===productId);if(!product)return toast('Produto não encontrado.','error');
  $('#stockProductId').value=product.id;$('#stockOperation').value='in';$('#stockQuantity').value='1';$('#stockQuantity').min='1';$('#stockNote').value='';
  setText('stockDialogTitle',`Estoque · ${product.name}`);setText('stockDialogMeta','Registre entradas, saídas, perdas ou ajuste o saldo após uma conferência.');
  setText('stockCurrentBalance',String(Number(product.stock_quantity||0)));setText('stockMinimumLabel',`Estoque mínimo: ${Number(product.min_stock_quantity||0)}`);setText('stockQuantityLabel','Quantidade');
  openOwnerDialog('stockDialog');await loadStockMovements(product.id);
}


function sameLocalDay(value,date=new Date()){
  const d=value instanceof Date?value:new Date(value);
  return d.getFullYear()===date.getFullYear()&&d.getMonth()===date.getMonth()&&d.getDate()===date.getDate();
}
function dashboardDateLabel(){
  try{return new Intl.DateTimeFormat('pt-BR',{weekday:'short',day:'2-digit',month:'short'}).format(new Date()).replace(/\./g,'')}
  catch{return 'Hoje'}
}
function renderOwnerDashboardOperations(){
  const now=new Date();
  setText('dashboardTodayLabel',dashboardDateLabel());
  const today=ownerMonthAppointments.filter(a=>sameLocalDay(a.starts_at,now));
  const activeToday=today.filter(a=>a.status!=='cancelled');
  const waiting=today.filter(a=>a.status==='pending'||a.status==='confirmed');
  const inProgress=today.filter(a=>a.status==='in_progress');
  const completed=today.filter(a=>a.status==='completed');
  setText('todayAppointments',String(activeToday.length));
  setText('todayWaiting',`${waiting.length} ${waiting.length===1?'aguardando':'aguardando'}`);
  setText('todayInProgress',String(inProgress.length));
  setText('todayCompleted',String(completed.length));
  setText('todayRevenue',money(completed.reduce((sum,a)=>sum+Number(a.price_cents||0),0)));

  const next=[...today].filter(a=>['pending','confirmed','in_progress'].includes(a.status)).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at)).find(a=>a.status==='in_progress'||new Date(a.starts_at)>=new Date(now.getTime()-30*60000));
  const host=$('#dashboardNextAppointment');
  if(host){
    if(!next)host.innerHTML='<div class="owner-insight-empty">Nenhum atendimento pendente para hoje.</div>';
    else{
      const when=new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(next.starts_at));
      const barber=barbers.find(b=>String(b.id)===String(next.barber_id));
      const service=next.services?.name||services.find(s=>String(s.id)===String(next.service_id))?.name||'Serviço';
      host.innerHTML=`<div class="owner-next-row"><div class="owner-next-time">${escapeHtml(when)}</div><div class="owner-next-copy"><strong>${escapeHtml(next.customer_name||'Cliente')}</strong><span>${escapeHtml(service)}</span><small>${escapeHtml(barber?.full_name||'Barbeiro')}</small></div></div>`;
    }
  }
  const low=products.filter(p=>{const i=stockInfo(p);return p.active!==false&&i.qty<=i.min}).length;
  setText('dashboardLowStock',String(low));
  setText('dashboardLowStockText',low===1?'produto com estoque baixo':'produtos com estoque baixo');
}
function renderOwnerDashboardFinance(){
  if(!financialReportRows.length){
    setText('dashboardTopBarber','—');setText('dashboardTopBarberRevenue','Sem faturamento no mês');setText('dashboardCommission',money(0));setText('dashboardAverageTicket',money(0));
    return;
  }
  const gross=financialReportRows.reduce((sum,row)=>sum+Number(row.gross_revenue_cents||0),0);
  const commission=financialReportRows.reduce((sum,row)=>sum+Number(row.barber_commission_cents||0),0);
  setText('dashboardCommission',money(commission));
  setText('dashboardAverageTicket',money(financialReportRows.length?Math.round(gross/financialReportRows.length):0));
  const byBarber=new Map();
  financialReportRows.forEach(row=>{
    const id=String(row.barber_id||'');
    const current=byBarber.get(id)||{name:row.barber_name||'Barbeiro',gross:0};
    current.gross+=Number(row.gross_revenue_cents||0);byBarber.set(id,current);
  });
  const top=[...byBarber.values()].sort((a,b)=>b.gross-a.gross)[0];
  setText('dashboardTopBarber',top?.name||'—');
  setText('dashboardTopBarberRevenue',top?`${money(top.gross)} faturados`:'Sem faturamento no mês');
  const todayGross=financialReportRows.filter(row=>sameLocalDay(row.occurred_at,new Date())).reduce((sum,row)=>sum+Number(row.gross_revenue_cents||0),0);
  if(todayGross>0)setText('todayRevenue',money(todayGross));
}

async function refreshAdmin(){
  ownerProfile=ownerProfile||await guard(['owner']);
  const t=ownerProfile.tenant;
  setText('tenantName',t.name);setText('ownerMenuExpiresAt',dateBR(t.expires_at));setText('ownerMenuPlanPrice',money(t.monthly_price_cents||0));syncOwnerUserMenu();updatePublicLink(t);
  $('#tenantNameInput').value=t.name;$('#whatsappInput').value=t.whatsapp||'';$('#operatingHoursInput').value=JSON.stringify(t.operating_hours,null,2);
  const [sv,us,bs,ap]=await Promise.all([
    sb.from('services').select('*').eq('tenant_id',ownerProfile.tenant_id).order('name'),
    sb.from('users').select('id,full_name,commission_pct,active').eq('tenant_id',ownerProfile.tenant_id).eq('role','barber').order('full_name'),
    sb.from('barber_services').select('barber_id,service_id,active').eq('tenant_id',ownerProfile.tenant_id),
    sb.from('appointments').select('id,barber_id,service_id,status,price_cents,starts_at,customer_name,services(name)').eq('tenant_id',ownerProfile.tenant_id).gte('starts_at',new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString()).order('starts_at')
  ]);
  if(sv.error||us.error||bs.error||ap.error)return toast((sv.error||us.error||bs.error||ap.error).message,'error');
  services=sv.data||[];barbers=us.data||[];barberServiceLinks=bs.data||[];ownerMonthAppointments=ap.data||[];refreshFinanceBarberOptions();
  setText('serviceCount',services.filter(s=>s.active).length);setText('barberCount',barbers.filter(b=>b.active).length);
  $('#serviceRows').innerHTML=services.map(s=>`<tr><td data-label="Serviço"><strong>${escapeHtml(s.name)}</strong></td><td data-label="Preço">${money(s.price_cents)}</td><td data-label="Duração">${s.duration_minutes} min</td><td data-label="Status"><span class="badge ${s.active?'badge-active':'badge-suspended'}">${s.active?'Ativo':'Inativo'}</span></td><td data-label="Ações"><button class="btn btn-sm btn-outline" type="button" data-edit-service="${s.id}">Editar</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Nenhum serviço.</td></tr>';
  $('#barberRows').innerHTML=barbers.map(b=>`<tr><td data-label="Barbeiro"><strong>${escapeHtml(b.full_name)}</strong></td><td data-label="Serviços">${barberServicesHtml(b.id)}</td><td data-label="Comissão">${Number(b.commission_pct||0).toFixed(2)}%</td><td data-label="Status"><span class="badge ${b.active?'badge-active':'badge-suspended'}">${b.active?'Ativo':'Inativo'}</span></td><td data-label="Ações"><button class="btn btn-sm btn-outline" type="button" data-edit-barber="${b.id}">Editar</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Nenhum barbeiro.</td></tr>';
  const completed=(ap.data||[]).filter(a=>a.status==='completed');setText('monthRevenue',money(completed.reduce((a,x)=>a+x.price_cents,0)));setText('monthAppointments',completed.length);
  await refreshProducts();
  await loadLoyalty();
  renderOwnerDashboardOperations();
  if($('#financeFrom')?.value&&$('#financeTo')?.value)await loadFinancialReport(true);
}
function escapeHtml(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

function openNewService(){
  const form=$('#serviceForm');
  form?.reset();
  $('#serviceId').value='';
  $('#serviceDuration').value='30';
  $('#serviceActive').checked=true;
  $('#serviceActiveRow').classList.add('hidden');
  setText('serviceDialogTitle','Novo serviço');
  setText('serviceDialogDescription','Cadastre um serviço para disponibilizar aos clientes.');
  setText('saveServiceButton','Criar serviço');
  openOwnerDialog('serviceDialog');
}
function openEditService(serviceId){
  const service=services.find(s=>s.id===serviceId);
  if(!service)return toast('Serviço não encontrado.','error');
  $('#serviceId').value=service.id;
  $('#serviceName').value=service.name||'';
  $('#servicePrice').value=(Number(service.price_cents||0)/100).toFixed(2);
  $('#serviceDuration').value=Number(service.duration_minutes||30);
  $('#serviceActive').checked=service.active!==false;
  $('#serviceActiveRow').classList.remove('hidden');
  setText('serviceDialogTitle','Editar serviço');
  setText('serviceDialogDescription','Altere nome, preço, duração ou situação do serviço.');
  setText('saveServiceButton','Salvar alterações');
  openOwnerDialog('serviceDialog');
}

function openNewProduct(){
  const form=$('#productForm');
  form?.reset();
  $('#productId').value='';$('#productCost').value='0.00';$('#productInitialStock').value='0';$('#productMinStock').value='0';
  $('#productInitialStockField').classList.remove('hidden');$('#productCurrentStockBox').classList.add('hidden');
  $('#productActive').checked=true;$('#productActiveRow').classList.add('hidden');
  setText('productDialogTitle','Novo produto');setText('saveProductButton','Cadastrar produto');
  openOwnerDialog('productDialog');
}
function openEditProduct(productId){
  const product=products.find(p=>p.id===productId);
  if(!product)return toast('Produto não encontrado.','error');
  $('#productId').value=product.id;$('#productName').value=product.name||'';
  $('#productCost').value=(Number(product.cost_cents||0)/100).toFixed(2);$('#productPrice').value=(Number(product.price_cents||0)/100).toFixed(2);
  $('#productMinStock').value=String(Number(product.min_stock_quantity||0));
  $('#productInitialStockField').classList.add('hidden');$('#productCurrentStockBox').classList.remove('hidden');setText('productCurrentStock',`${Number(product.stock_quantity||0)} unidades`);
  $('#productActive').checked=product.active!==false;$('#productActiveRow').classList.remove('hidden');
  setText('productDialogTitle','Editar produto');setText('saveProductButton','Salvar alterações');
  openOwnerDialog('productDialog');
}

async function openEditBarber(barberId){
  const dialog=$('#editBarberDialog');
  const saveBtn=$('#saveEditBarber');
  saveBtn.disabled=true;
  try{
    const data=await invokeEdgeFunction('admin-actions',{action:'get_barber',barberId});
    const barber=data?.barber;
    if(!barber)throw new Error('Barbeiro não encontrado.');
    $('#editBarberId').value=barber.id;
    $('#editBarberName').value=barber.fullName||'';
    $('#editBarberEmail').value=barber.email||'';
    $('#editBarberCommission').value=Number(barber.commission||0).toFixed(2);
    $('#editBarberActive').checked=barber.active!==false;
    renderServicePicker('editBarberServicePicker',getBarberServiceIds(barber.id));
    $('#editBarberPassword').value='';
    $('#editBarberPasswordConfirm').value='';
    if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  }catch(error){toast(error?.message||'Não foi possível abrir o barbeiro.','error')}
  finally{saveBtn.disabled=false}
}
function closeEditBarber(){const dialog=$('#editBarberDialog');if(dialog?.open)dialog.close();}


function localDateInputValue(date){
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function parseLocalDate(value){
  const parts=String(value||'').split('-').map(Number);
  if(parts.length!==3||parts.some(n=>!Number.isFinite(n)))return null;
  return new Date(parts[0],parts[1]-1,parts[2],0,0,0,0);
}
function formatFinanceDate(value){
  if(!value)return '-';
  return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value));
}
function loyaltyDate(value){
  if(!value)return '—';
  try{return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value))}catch{return '—'}
}
function loyaltyProgressHtml(customer){
  const required=Math.max(2,Number(loyaltySettings.visits_required||10));
  const balance=Math.max(0,Number(customer.visits_balance||0));
  const percent=Math.min(100,Math.round((balance/required)*100));
  return `<div class="loyalty-progress-cell"><div><strong>${balance}/${required}</strong><span>${percent}%</span></div><div class="loyalty-progress-track"><span style="width:${percent}%"></span></div></div>`;
}
function renderLoyaltyCustomers(){
  setText('loyaltyCustomerCount',String(loyaltyCustomers.length));
  setText('loyaltyVisitCount',String(loyaltyCustomers.reduce((sum,c)=>sum+Number(c.total_validated_visits||0),0)));
  setText('loyaltyRewardCount',String(loyaltyCustomers.reduce((sum,c)=>sum+Number(c.rewards_available||0),0)));
  const rows=$('#loyaltyCustomerRows');if(!rows)return;
  rows.innerHTML=loyaltyCustomers.map(c=>`<tr>
    <td data-label="Cliente"><strong>${escapeHtml(c.customer_name||'Cliente')}</strong><small class="loyalty-phone">${escapeHtml(c.phone||'')}</small><small class="loyalty-phone">${escapeHtml(c.email||'')}</small></td>
    <td data-label="Progresso">${loyaltyProgressHtml(c)}</td>
    <td data-label="Visitas"><strong>${Number(c.total_validated_visits||0)}</strong></td>
    <td data-label="Recompensas"><span class="loyalty-reward-pill ${Number(c.rewards_available||0)>0?'is-ready':''}">${Number(c.rewards_available||0)}</span></td>
    <td data-label="Última visita">${loyaltyDate(c.last_visit_at)}</td>
    <td data-label="Ações">${Number(c.rewards_available||0)>0?`<button class="btn btn-sm" type="button" data-redeem-loyalty="${c.id}">Usar recompensa</button>`:'<span class="muted small">Sem recompensa</span>'}</td>
  </tr>`).join('')||'<tr><td colspan="6" class="empty">Nenhum cliente com e-mail validado ainda.</td></tr>';
}
async function loadLoyalty(){
  const notice=$('#loyaltySetupNotice');
  const [settingsResult,customersResult]=await Promise.all([
    sb.from('loyalty_settings').select('tenant_id,enabled,visits_required,reward_name').eq('tenant_id',ownerProfile.tenant_id).maybeSingle(),
    sb.from('loyalty_customers').select('id,customer_name,phone,email,visits_balance,rewards_available,total_validated_visits,last_visit_at,updated_at,email_verified_at').eq('tenant_id',ownerProfile.tenant_id).not('email_verified_at','is',null).order('updated_at',{ascending:false})
  ]);
  if(settingsResult.error||customersResult.error){
    loyaltyModuleReady=false;loyaltyCustomers=[];loyaltySettings={enabled:false,visits_required:10,reward_name:'1 serviço grátis'};
    notice?.classList.remove('hidden');
    const rows=$('#loyaltyCustomerRows');if(rows)rows.innerHTML='<tr><td colspan="6" class="empty">Execute ATUALIZAR_BANCO_1.1.67.sql para ativar esta área.</td></tr>';
    setText('loyaltyCustomerCount','0');setText('loyaltyVisitCount','0');setText('loyaltyRewardCount','0');
    return;
  }
  loyaltyModuleReady=true;notice?.classList.add('hidden');
  loyaltySettings=settingsResult.data||{enabled:false,visits_required:10,reward_name:'1 serviço grátis'};
  loyaltyCustomers=customersResult.data||[];
  $('#loyaltyEnabled').checked=loyaltySettings.enabled===true;
  $('#loyaltyVisitsRequired').value=String(Number(loyaltySettings.visits_required||10));
  $('#loyaltyRewardName').value=loyaltySettings.reward_name||'1 serviço grátis';
  renderLoyaltyCustomers();
}
async function saveLoyaltySettings(){
  if(!loyaltyModuleReady)return toast('Execute ATUALIZAR_BANCO_1.1.67.sql no Supabase primeiro.','warn');
  const visits=Math.floor(Number($('#loyaltyVisitsRequired').value));
  const reward=$('#loyaltyRewardName').value.trim();
  if(!Number.isInteger(visits)||visits<2||visits>30)return toast('Informe entre 2 e 30 visitas.','error');
  if(reward.length<2)return toast('Informe a recompensa do programa.','error');
  const button=$('#saveLoyaltySettings');button.disabled=true;
  const {error}=await sb.from('loyalty_settings').upsert({tenant_id:ownerProfile.tenant_id,enabled:$('#loyaltyEnabled').checked,visits_required:visits,reward_name:reward},{onConflict:'tenant_id'});
  button.disabled=false;
  if(error)return toast(error.message,'error');
  toast('Programa de fidelidade atualizado.');await loadLoyalty();
}
async function redeemLoyaltyReward(customerId){
  const customer=loyaltyCustomers.find(c=>c.id===customerId);if(!customer)return;
  const ok=await confirmMessage(`Confirmar o uso de 1 recompensa de ${customer.customer_name}?`,{title:'Usar recompensa',okText:'Confirmar resgate',cancelText:'Cancelar'});
  if(!ok)return;
  const {data,error}=await sb.rpc('redeem_loyalty_reward',{p_customer_id:customerId});
  if(error)return toast(error.message,'error');
  toast(`Recompensa utilizada. Restam ${Number(data?.rewards_available||0)}.`);await loadLoyalty();
}

function financePeriodText(fromValue,toValue){
  const from=parseLocalDate(fromValue),to=parseLocalDate(toValue);
  if(!from||!to)return '';
  const f=new Intl.DateTimeFormat('pt-BR').format(from),t=new Intl.DateTimeFormat('pt-BR').format(to);
  return fromValue===toValue?f:`${f} a ${t}`;
}
function isCurrentMonthFinanceRange(){
  const now=new Date();
  return $('#financeFrom')?.value===localDateInputValue(new Date(now.getFullYear(),now.getMonth(),1))
    && $('#financeTo')?.value===localDateInputValue(new Date(now.getFullYear(),now.getMonth(),now.getDate()));
}
function setFinancePeriod(period,load=true){
  const now=new Date();
  let from=new Date(now.getFullYear(),now.getMonth(),1),to=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if(period==='today')from=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if(period==='last-month'){
    from=new Date(now.getFullYear(),now.getMonth()-1,1);
    to=new Date(now.getFullYear(),now.getMonth(),0);
  }
  $('#financeFrom').value=localDateInputValue(from);
  $('#financeTo').value=localDateInputValue(to);
  if(load)return loadFinancialReport();
}
function refreshFinanceBarberOptions(){
  const select=$('#financeBarber');if(!select)return;
  const previous=select.value;
  select.innerHTML='<option value="">Todos os barbeiros</option>'+barbers.map(b=>`<option value="${b.id}">${escapeHtml(b.full_name)}</option>`).join('');
  if(barbers.some(b=>String(b.id)===previous))select.value=previous;
}
function detailLinesHtml(items,emptyLabel){
  if(!Array.isArray(items)||!items.length)return `<span class="muted">${escapeHtml(emptyLabel)}</span>`;
  return `<div class="finance-detail-lines">${items.map(item=>{
    const qty=Number(item?.quantity||1);
    const subtotal=Number(item?.subtotal_cents??(Number(item?.unit_price_cents||0)*qty));
    return `<span><strong>${escapeHtml(item?.name||'Item')}</strong><small>${qty>1?`${qty} × `:''}${money(subtotal)}</small></span>`;
  }).join('')}</div>`;
}
function filteredFinancialRows(){
  const barberId=$('#financeBarber')?.value||'';
  return barberId?financialReportRows.filter(row=>String(row.barber_id)===barberId):financialReportRows.slice();
}
function renderFinancialReport(){
  const rows=filteredFinancialRows();
  const sum=key=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
  const gross=sum('gross_revenue_cents'),service=sum('service_revenue_cents'),product=sum('product_revenue_cents'),commission=sum('barber_commission_cents'),net=sum('shop_net_cents');
  setText('financeGross',money(gross));setText('financeServices',money(service));setText('financeProducts',money(product));setText('financeCommission',money(commission));setText('financeNet',money(net));setText('financeCount',rows.length);
  setText('financePeriodLabel',financePeriodText($('#financeFrom')?.value,$('#financeTo')?.value));

  const byBarber=new Map();
  rows.forEach(row=>{
    const id=String(row.barber_id||'');
    if(!byBarber.has(id))byBarber.set(id,{name:row.barber_name||'Barbeiro',commissionPcts:new Set(),count:0,service:0,product:0,gross:0,commission:0,net:0});
    const item=byBarber.get(id);item.commissionPcts.add(Number(row.commission_pct||0).toFixed(2));item.count++;item.service+=Number(row.service_revenue_cents||0);item.product+=Number(row.product_revenue_cents||0);item.gross+=Number(row.gross_revenue_cents||0);item.commission+=Number(row.barber_commission_cents||0);item.net+=Number(row.shop_net_cents||0);
  });
  const barberRows=[...byBarber.values()].sort((a,b)=>b.gross-a.gross||a.name.localeCompare(b.name,'pt-BR'));
  $('#financeBarberRows').innerHTML=barberRows.map(item=>{const pctLabel=item.commissionPcts.size===1?`${[...item.commissionPcts][0]}%`:'Variável';return `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${item.count}</td><td>${money(item.service)}</td><td>${money(item.product)}</td><td><strong>${money(item.gross)}</strong></td><td>${pctLabel}</td><td><strong>${money(item.commission)}</strong></td><td><strong>${money(item.net)}</strong></td></tr>`}).join('')||'<tr><td colspan="8" class="empty">Nenhum faturamento encontrado neste período.</td></tr>';

  $('#financeDetailRows').innerHTML=rows.map(row=>`<tr>
    <td class="finance-date-cell">${formatFinanceDate(row.occurred_at)}</td>
    <td>${row.command_number?`<strong>#${String(row.command_number).padStart(4,'0')}</strong>`:'<span class="muted">Sem comanda</span>'}</td>
    <td><strong>${escapeHtml(row.customer_name||'Cliente')}</strong>${row.source_type==='legacy'?'<small class="finance-legacy-tag">registro antigo</small>':''}</td>
    <td>${escapeHtml(row.barber_name||'Barbeiro')}</td>
    <td>${detailLinesHtml(row.service_details,'Sem serviço')}</td>
    <td>${detailLinesHtml(row.product_details,'Nenhum produto')}</td>
    <td><strong>${money(row.gross_revenue_cents)}</strong></td>
    <td><strong>${money(row.barber_commission_cents)}</strong><small class="finance-cell-note">${Number(row.commission_pct||0).toFixed(2)}%</small></td>
    <td><strong>${money(row.shop_net_cents)}</strong></td>
  </tr>`).join('')||'<tr><td colspan="9" class="empty">Nenhuma movimentação faturada neste período.</td></tr>';
}
function setFinanceLoading(loading){
  const button=$('#financeFilterForm button[type="submit"]');
  if(button){button.disabled=loading;button.textContent=loading?'Carregando...':'Aplicar filtro';}
}
async function loadFinancialReport(updateMonthCard=false){
  const from=parseLocalDate($('#financeFrom')?.value),to=parseLocalDate($('#financeTo')?.value);
  if(!from||!to)return toast('Informe as datas do relatório.','error');
  if(to<from)return toast('A data final não pode ser menor que a data inicial.','error');
  const toExclusive=new Date(to);toExclusive.setDate(toExclusive.getDate()+1);
  setFinanceLoading(true);
  const notice=$('#financeSetupNotice');if(notice)notice.classList.add('hidden');
  try{
    const {data,error}=await sb.rpc('owner_financial_report',{p_from:from.toISOString(),p_to:toExclusive.toISOString()});
    if(error)throw error;
    financialReportRows=(data||[]).map(row=>({...row,
      commission_pct:Number(row.commission_pct||0),service_revenue_cents:Number(row.service_revenue_cents||0),product_revenue_cents:Number(row.product_revenue_cents||0),gross_revenue_cents:Number(row.gross_revenue_cents||0),barber_commission_cents:Number(row.barber_commission_cents||0),shop_net_cents:Number(row.shop_net_cents||0)
    }));
    renderFinancialReport();
    if(isCurrentMonthFinanceRange())renderOwnerDashboardFinance();
    if(updateMonthCard&&isCurrentMonthFinanceRange()){
      setText('monthRevenue',money(financialReportRows.reduce((total,row)=>total+Number(row.gross_revenue_cents||0),0)));
      setText('monthAppointments',financialReportRows.length);
    }
  }catch(error){
    financialReportRows=[];renderFinancialReport();
    if(notice){notice.textContent='Para ativar o Financeiro completo, execute o arquivo ATUALIZAR_BANCO_1.1.41.sql no Supabase > SQL Editor.';notice.classList.remove('hidden');}
    console.warn('Relatório financeiro indisponível:',error?.message||error);
  }finally{setFinanceLoading(false)}
}
function csvEscape(value){
  const text=String(value??'');return /[;"\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
}
function exportFinancialCsv(){
  const rows=filteredFinancialRows();
  if(!rows.length)return toast('Não há movimentações para exportar neste período.','warn');
  const header=['Data','Comanda','Cliente','Barbeiro','Serviços (R$)','Produtos (R$)','Faturado (R$)','Comissão %','Barbeiro ganhou (R$)','Barbearia ficou (R$)'];
  const moneyNumber=cents=>(Number(cents||0)/100).toFixed(2).replace('.',',');
  const lines=[header,...rows.map(row=>[
    formatFinanceDate(row.occurred_at),row.command_number?`#${String(row.command_number).padStart(4,'0')}`:'Sem comanda',row.customer_name||'Cliente',row.barber_name||'Barbeiro',moneyNumber(row.service_revenue_cents),moneyNumber(row.product_revenue_cents),moneyNumber(row.gross_revenue_cents),Number(row.commission_pct||0).toFixed(2).replace('.',','),moneyNumber(row.barber_commission_cents),moneyNumber(row.shop_net_cents)
  ])].map(cols=>cols.map(csvEscape).join(';')).join('\n');
  const blob=new Blob(['\ufeff'+lines],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`financeiro-na-regua-${$('#financeFrom').value}-a-${$('#financeTo').value}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

document.addEventListener('DOMContentLoaded',async()=>{
  initOwnerTabs();
  setFinancePeriod('month',false);
  ownerProfile=await guard(['owner']);syncOwnerUserMenu();await refreshAdmin();
  $('#ownerUserMenuButton')?.addEventListener('click',e=>{e.stopPropagation();toggleOwnerUserMenu()});
  $('#ownerUserMenu')?.addEventListener('click',e=>e.stopPropagation());
  document.addEventListener('click',closeOwnerUserMenu);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeOwnerUserMenu()});
  $('#ownerUserMenu')?.addEventListener('click',async e=>{
    const action=e.target.closest('[data-owner-menu-action]')?.dataset.ownerMenuAction;
    if(!action)return;
    closeOwnerUserMenu();
    if(action==='settings')return openOwnerDialog('settingsDialog');
    if(action==='open-public')return accessCurrentPublicLink();
    if(action==='copy-public')return copyCurrentPublicLink();
    if(action==='signout')return signOut();
  });
  $('#installApp')?.addEventListener('click',async()=>{closeOwnerUserMenu();await installApp()});
  $('#settingsForm').addEventListener('submit',async e=>{e.preventDefault();let operating_hours;try{operating_hours=JSON.parse($('#operatingHoursInput').value)}catch{return toast('Horário de funcionamento em JSON inválido','error')}const {error}=await sb.from('tenants').update({name:$('#tenantNameInput').value.trim(),whatsapp:$('#whatsappInput').value.trim()||null,operating_hours}).eq('id',ownerProfile.tenant_id);if(error)return toast(error.message,'error');toast('Configurações salvas');closeOwnerDialog('settingsDialog');ownerProfile=null;refreshAdmin()});
  $('#serviceForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const id=$('#serviceId').value;
    const name=$('#serviceName').value.trim();
    const price_cents=Math.round(Number($('#servicePrice').value)*100);
    const duration_minutes=Number($('#serviceDuration').value);
    if(!name)return toast('Informe o nome do serviço.','error');
    if(!Number.isFinite(price_cents)||price_cents<0)return toast('Informe um preço válido.','error');
    if(!Number.isInteger(duration_minutes)||duration_minutes<5||duration_minutes>720)return toast('Informe uma duração válida entre 5 e 720 minutos.','error');
    let result;
    if(id)result=await sb.from('services').update({name,price_cents,duration_minutes,active:$('#serviceActive').checked}).eq('id',id).eq('tenant_id',ownerProfile.tenant_id);
    else result=await sb.from('services').insert({tenant_id:ownerProfile.tenant_id,name,price_cents,duration_minutes,active:true});
    if(result.error)return toast(result.error.message,'error');
    closeOwnerDialog('serviceDialog');toast(id?'Serviço atualizado.':'Serviço criado.');await refreshAdmin();
  });
  $('#barberForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const f=new FormData(e.target),password=String(f.get('password')||''),passwordConfirm=String(f.get('passwordConfirm')||'');
    if(password.length<6)return toast('A senha deve ter pelo menos 6 caracteres.','error');
    if(password!==passwordConfirm)return toast('As senhas do barbeiro não coincidem.','error');
    const btn=e.submitter || e.target.querySelector('#createBarberBtn') || e.target.querySelector('button');
    if(btn)btn.disabled=true;
    let createdUserId='';
    try{
      const data=await invokeEdgeFunction('admin-actions',{action:'create_barber',fullName:f.get('fullName'),email:f.get('email'),commission:f.get('commission'),password});
      createdUserId=String(data?.userId||'');
      if(!createdUserId)throw new Error('O barbeiro foi criado, mas o identificador do acesso não foi retornado.');
      await syncBarberServices(createdUserId,getSelectedServiceIds('barberServicePicker'));
      e.target.reset();closeOwnerDialog('barberDialog');toast('Barbeiro criado e serviços configurados.');await refreshAdmin();
    }catch(error){
      toast(createdUserId?`Barbeiro criado, mas não foi possível salvar os serviços: ${error?.message||'erro desconhecido'}`:(error?.message||'Não foi possível criar o barbeiro.'),'error');
      if(createdUserId)await refreshAdmin();
    }
    finally{if(btn)btn.disabled=false}
  });
  $('#productForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const id=$('#productId').value;
    const name=$('#productName').value.trim();
    const cost_cents=Math.round(Number($('#productCost').value)*100);
    const price_cents=Math.round(Number($('#productPrice').value)*100);
    const min_stock_quantity=Math.max(0,Math.floor(Number($('#productMinStock').value)||0));
    const initial_stock=Math.max(0,Math.floor(Number($('#productInitialStock').value)||0));
    if(!name)return toast('Informe o nome do produto.','error');
    if(!Number.isFinite(cost_cents)||cost_cents<0)return toast('Informe um valor de custo válido.','error');
    if(!Number.isFinite(price_cents)||price_cents<0)return toast('Informe um preço de venda válido.','error');
    if(!Number.isInteger(min_stock_quantity)||min_stock_quantity<0)return toast('Informe um estoque mínimo válido.','error');
    if(!id&&(!Number.isInteger(initial_stock)||initial_stock<0))return toast('Informe um estoque inicial válido.','error');
    if(price_cents<cost_cents){const ok=await appConfirm('O preço de venda está menor que o valor de custo. Deseja salvar mesmo assim?',{title:'Atenção',confirmText:'Salvar mesmo assim'});if(!ok)return}
    const payload={name,cost_cents,price_cents,min_stock_quantity};
    let result;
    if(id)result=await sb.from('products').update({...payload,active:$('#productActive').checked}).eq('id',id).eq('tenant_id',ownerProfile.tenant_id);
    else result=await sb.from('products').insert({tenant_id:ownerProfile.tenant_id,...payload,stock_quantity:initial_stock,active:true});
    if(result.error)return toast(result.error.message,'error');
    closeOwnerDialog('productDialog');toast(id?'Produto atualizado.':'Produto cadastrado com estoque inicial.');await refreshProducts();
  });
  $('#stockOperation')?.addEventListener('change',()=>{
    const setMode=$('#stockOperation').value==='set';
    setText('stockQuantityLabel',setMode?'Novo saldo':'Quantidade');
    $('#stockQuantity').min=setMode?'0':'1';
    if(setMode&&Number($('#stockQuantity').value)<0)$('#stockQuantity').value='0';
    if(!setMode&&Number($('#stockQuantity').value)<1)$('#stockQuantity').value='1';
  });
  $('#stockForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const productId=$('#stockProductId').value,operation=$('#stockOperation').value;
    const quantity=Math.floor(Number($('#stockQuantity').value));
    const note=$('#stockNote').value.trim();
    if(!productId)return toast('Produto não identificado.','error');
    if(!Number.isInteger(quantity)||quantity<(operation==='set'?0:1))return toast(operation==='set'?'Informe um saldo válido.':'Informe uma quantidade válida.','error');
    const button=$('#saveStockButton');button.disabled=true;
    try{
      const {data,error}=await sb.rpc('adjust_product_stock',{p_product_id:productId,p_operation:operation,p_quantity:quantity,p_note:note||null});
      if(error)throw error;
      await refreshProducts();
      const product=products.find(p=>p.id===productId);
      setText('stockCurrentBalance',String(Number(product?.stock_quantity??data??0)));setText('stockMinimumLabel',`Estoque mínimo: ${Number(product?.min_stock_quantity||0)}`);
      $('#stockQuantity').value=operation==='set'?'0':'1';$('#stockNote').value='';
      await loadStockMovements(productId);toast('Estoque atualizado com sucesso.');
    }catch(error){toast(error?.message||'Não foi possível atualizar o estoque.','error')}
    finally{button.disabled=false}
  });
  $('#accessPublicLink')?.addEventListener('click',accessCurrentPublicLink);
  $('#copyPublicLink')?.addEventListener('click',copyCurrentPublicLink);
  $('#loyaltySettingsForm')?.addEventListener('submit',async e=>{e.preventDefault();await saveLoyaltySettings()});
  $('#loyaltyCustomerRows')?.addEventListener('click',e=>{const btn=e.target.closest('[data-redeem-loyalty]');if(btn)redeemLoyaltyReward(btn.dataset.redeemLoyalty)});
  $('#financeFilterForm')?.addEventListener('submit',async e=>{e.preventDefault();await loadFinancialReport(false)});
  $('#financeBarber')?.addEventListener('change',renderFinancialReport);
  document.querySelectorAll('[data-finance-period]').forEach(button=>button.addEventListener('click',()=>setFinancePeriod(button.dataset.financePeriod,true)));
  $('#exportFinanceCsv')?.addEventListener('click',exportFinancialCsv);
  $('#serviceRows').addEventListener('click',e=>{const btn=e.target.closest('[data-edit-service]');if(btn)openEditService(btn.dataset.editService)});
  $('#productRows').addEventListener('click',e=>{const stockBtn=e.target.closest('[data-stock-product]');if(stockBtn)return openStockControl(stockBtn.dataset.stockProduct);const btn=e.target.closest('[data-edit-product]');if(btn)openEditProduct(btn.dataset.editProduct)});
  $('#barberRows').addEventListener('click',e=>{const btn=e.target.closest('[data-edit-barber]');if(btn)openEditBarber(btn.dataset.editBarber)});
  $('#closeEditBarber').addEventListener('click',closeEditBarber);$('#cancelEditBarber').addEventListener('click',closeEditBarber);
  $('#editBarberForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const f=new FormData(e.target),password=String(f.get('password')||''),passwordConfirm=String(f.get('passwordConfirm')||'');
    if(password && password.length<6)return toast('A nova senha deve ter pelo menos 6 caracteres.','error');
    if(password!==passwordConfirm)return toast('A confirmação da nova senha não coincide.','error');
    const btn=$('#saveEditBarber');btn.disabled=true;
    try{
      const barberId=String(f.get('barberId')||'');
      await invokeEdgeFunction('admin-actions',{
        action:'update_barber',barberId,fullName:f.get('fullName'),email:f.get('email'),commission:f.get('commission'),active:$('#editBarberActive').checked,password
      });
      await syncBarberServices(barberId,getSelectedServiceIds('editBarberServicePicker'));
      closeEditBarber();toast('Barbeiro e serviços atualizados com sucesso.');await refreshAdmin();
    }catch(error){toast(error?.message||'Não foi possível atualizar o barbeiro.','error')}
    finally{btn.disabled=false}
  });
});
