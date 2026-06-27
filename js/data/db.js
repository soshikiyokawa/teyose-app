// ════ Supabase データ層（取得・保存・複数端末リアルタイム同期） ════

function supplierIdByName(name){
  const s = suppliers.find(x=>x.name===name);
  return s ? s.id : null;
}
function supplierNameById(id){
  const s = suppliers.find(x=>x.id===id);
  return s ? s.name : '（不明な発注先）';
}

// ── 初回データ取得 ──
async function fetchAllData(){
  const { data: supplierRows, error: supErr } = await sb.from('suppliers').select('*').order('id');
  if(supErr) throw supErr;
  suppliers = supplierRows.map(r=>({id:r.id,name:r.name,contact:r.contact||'',tel:r.tel||'',email:r.email||'',cats:r.cats||'',note:r.note||''}));
  supplierIdSeq = Math.max(0,...suppliers.map(s=>s.id))+1;

  const { data: itemRows, error: itemErr } = await sb.from('master_items').select('*').order('sort_order').order('id');
  if(itemErr) throw itemErr;
  master = itemRows.map(r=>({id:r.id,cat:r.cat,name:r.name,unit:r.unit,price:Number(r.price),cost:Number(r.cost),supplier:supplierNameById(r.supplier_id),sortOrder:r.sort_order}));
  masterIdSeq = Math.max(0,...master.map(m=>m.id))+1;

  // チャットは社内＝全件／発注先＝自社分のみ（RLSが自動で絞る）
  const { data: chatRows, error: chatErr } = await sb.from('chat_messages').select('*').order('created_at');
  if(chatErr) throw chatErr;
  talkThreads = {};
  chatRows.forEach(r=>{
    const name = supplierNameById(r.supplier_id);
    if(!talkThreads[name]) talkThreads[name]=[];
    talkThreads[name].push({id:r.id,role:r.role,type:r.type,text:r.text,orderData:r.order_data,ts:new Date(r.created_at).getTime(),unread:r.unread});
  });

  if(currentUserRole==='staff'){
    const { data: estRows } = await sb.from('estimates').select('*').order('created_at',{ascending:false});
    estimates = (estRows||[]).map(rowToEstimate);
    estSeq = estimates.length+1;

    const { data: orderRows } = await sb.from('orders').select('*').order('created_at',{ascending:false});
    orders = (orderRows||[]).map(r=>({id:r.id,no:r.no,project:r.project,date:r.date,suppliers:supplierNameById(r.supplier_id),items:r.items,subtotal:Number(r.subtotal),tax:Number(r.tax),total:Number(r.total),status:r.status}));

    const { data: costRows } = await sb.from('cost_entries').select('*').order('created_at',{ascending:false});
    costEntries = (costRows||[]).map(r=>({id:r.id,date:r.date,project:r.project,name:r.name,qty:Number(r.qty),unit:r.unit,amount:Number(r.amount),supplier:supplierNameById(r.supplier_id),orderNo:r.order_no,status:r.status}));
  }
}

function rowToEstimate(r){
  return {id:r.id,no:r.no,date:r.date,expire:r.expire,status:r.status,type:r.type,
    startDate:r.start_date,endDate:r.end_date,clientName:r.client_name,projectName:r.project_name,siteName:r.site_name,
    note:r.note,miscRate:Number(r.misc_rate),taxRate:Number(r.tax_rate),payments:r.payments||[],sections:r.sections||[]};
}

// ── 発注先 ──
async function dbAddSupplier(item){
  const { data, error } = await sb.from('suppliers').insert({name:item.name,contact:item.contact,tel:item.tel,email:item.email,cats:item.cats,note:item.note}).select().single();
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
  suppliers.push({id:data.id,...item});
}
async function dbUpdateSupplier(id,item){
  const { error } = await sb.from('suppliers').update({name:item.name,contact:item.contact,tel:item.tel,email:item.email,cats:item.cats,note:item.note}).eq('id',id);
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
}

// ── 品目マスタ ──
async function dbAddMasterItem(item){
  const supplier_id = supplierIdByName(item.supplier);
  const { data, error } = await sb.from('master_items').insert({cat:item.cat,name:item.name,unit:item.unit,price:item.price,cost:item.cost,supplier_id}).select().single();
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
  master.push({id:data.id,...item,sortOrder:data.sort_order});
}
async function dbUpdateMasterItem(id,item){
  const supplier_id = supplierIdByName(item.supplier);
  const payload = currentUserRole==='staff'
    ? {cat:item.cat,name:item.name,unit:item.unit,price:item.price,cost:item.cost,supplier_id}
    : {price:item.price,cost:item.cost}; // 発注先は価格・原価のみ更新（DB側のトリガーでも強制）
  const { error } = await sb.from('master_items').update(payload).eq('id',id);
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
}
async function dbDeleteMasterItem(id){
  const { error } = await sb.from('master_items').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}
async function dbReorderMasterItems(orderedItems){
  const updates = orderedItems.map((m,i)=>sb.from('master_items').update({sort_order:i}).eq('id',m.id));
  await Promise.all(updates);
}

// ── 見積 ──
async function dbSaveEstimate(data){
  const row = {
    no:data.no,date:data.date||null,expire:data.expire||null,status:data.status,type:data.type,
    start_date:data.startDate||null,end_date:data.endDate||null,
    client_name:data.clientName,project_name:data.projectName,site_name:data.siteName,note:data.note,
    misc_rate:data.miscRate,tax_rate:data.taxRate,payments:data.payments,sections:data.sections
  };
  if(typeof data.id==='number' && estimates.some(e=>e.id===data.id)){
    const { error } = await sb.from('estimates').update(row).eq('id',data.id);
    if(error){showToast('保存に失敗しました：'+error.message);throw error;}
    return data.id;
  }
  const { data: inserted, error } = await sb.from('estimates').insert(row).select().single();
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
  return inserted.id;
}

// ── 発注確定（発注書・原価・チャット投稿） ──
async function dbConfirmOrder(order){
  const supplier_id = supplierIdByName(order.suppliers);
  const { data: orderRow, error: orderErr } = await sb.from('orders').insert({
    no:order.no,project:order.project,date:order.date,supplier_id,
    items:order.items,subtotal:order.subtotal,tax:order.tax,total:order.total,status:'pending'
  }).select().single();
  if(orderErr){showToast('発注確定に失敗しました：'+orderErr.message);throw orderErr;}

  const costRows = order.items.map(item=>({
    date:order.date,project:order.project,name:item.name,qty:item.qty,unit:item.unit,
    amount:item.cost*item.qty,supplier_id,order_no:order.no,status:'pending'
  }));
  const { error: costErr } = await sb.from('cost_entries').insert(costRows);
  if(costErr){showToast('原価登録に失敗しました：'+costErr.message);throw costErr;}

  await dbAddChatMessage(order.suppliers,{role:'me',type:'order',orderData:order});
  return orderRow;
}
async function dbMarkOrderReceived(orderNo, supplierName){
  const supplier_id = supplierIdByName(supplierName);
  await sb.from('orders').update({status:'received'}).eq('no',orderNo).eq('supplier_id',supplier_id);
  await sb.from('cost_entries').update({status:'received'}).eq('order_no',orderNo).eq('supplier_id',supplier_id);
}

// ── チャット ──
async function dbAddChatMessage(supplierName, msg){
  const supplier_id = supplierIdByName(supplierName);
  if(!supplier_id) return;
  const { data, error } = await sb.from('chat_messages').insert({
    supplier_id, role:msg.role, type:msg.type||'text', text:msg.text||null, order_data:msg.orderData||null, unread:false
  }).select().single();
  if(error){showToast('送信に失敗しました：'+error.message);throw error;}
  if(!talkThreads[supplierName]) talkThreads[supplierName]=[];
  talkThreads[supplierName].push({id:data.id,role:data.role,type:data.type,text:data.text,orderData:data.order_data,ts:new Date(data.created_at).getTime(),unread:false});
}

// ── リアルタイム同期（他端末の変更を反映） ──
function subscribeRealtime(){
  sb.channel('app-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'suppliers'}, ()=>refetchAndRerender('suppliers'))
    .on('postgres_changes',{event:'*',schema:'public',table:'master_items'}, ()=>refetchAndRerender('master_items'))
    .on('postgres_changes',{event:'*',schema:'public',table:'chat_messages'}, ()=>refetchAndRerender('chat_messages'))
    .on('postgres_changes',{event:'*',schema:'public',table:'orders'}, ()=>refetchAndRerender('orders'))
    .on('postgres_changes',{event:'*',schema:'public',table:'cost_entries'}, ()=>refetchAndRerender('cost_entries'))
    .subscribe();
}

async function refetchAndRerender(table){
  try{
    await fetchAllData();
  }catch(e){console.warn('再取得に失敗しました',e);return;}
  if(table==='suppliers'){
    renderSupplierSelectList();
    if(document.getElementById('ordersub-supplier')?.classList.contains('active')) renderSupplierMaster();
  }
  if(table==='master_items' && document.getElementById('ordersub-master')?.classList.contains('active')) renderMaster();
  if(table==='chat_messages'){
    if(talkPanelOpen){
      if(activeTalkPanelSupplier) renderTalkPanelMessages();
      else renderTalkPanelList();
    }
  }
  if((table==='orders'||table==='cost_entries') && currentUserRole==='staff'){
    if(document.getElementById('ordersub-history')?.classList.contains('active')) renderOrders();
    if(document.getElementById('page-cost')?.classList.contains('active')) renderCost();
  }
}
