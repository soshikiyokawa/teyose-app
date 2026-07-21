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
  const { data: supplierRows, error: supErr } = await sb.from('suppliers').select('*').order('sort_order').order('id');
  if(supErr) throw supErr;
  suppliers = supplierRows.map(r=>({id:r.id,name:r.name,contact:r.contact||'',tel:r.tel||'',email:r.email||'',cats:r.cats||'',note:r.note||'',sortOrder:r.sort_order}));
  supplierIdSeq = Math.max(0,...suppliers.map(s=>s.id))+1;

  const { data: itemRows, error: itemErr } = await sb.from('master_items').select('*').order('sort_order').order('id');
  if(itemErr) throw itemErr;
  master = itemRows.map(r=>({id:r.id,cat:r.cat,name:r.name,unit:r.unit,price:Number(r.price),cost:Number(r.cost),supplier:supplierNameById(r.supplier_id),sortOrder:r.sort_order}));
  masterIdSeq = Math.max(0,...master.map(m=>m.id))+1;

  // チャットは社内＝全件／発注先＝自社分のみ／大工＝社内チャットのみ（RLSが自動で絞る）
  const { data: chatRows, error: chatErr } = await sb.from('chat_messages').select('*').order('created_at');
  if(chatErr) throw chatErr;
  talkThreads = {};
  chatRows.forEach(r=>{
    const name = r.is_internal ? INTERNAL_THREAD : supplierNameById(r.supplier_id);
    if(!talkThreads[name]) talkThreads[name]=[];
    talkThreads[name].push({id:r.id,role:r.role,type:r.type,text:r.text,orderData:r.order_data,fileUrl:r.file_url,fileName:r.file_name,fileMime:r.file_mime,ts:new Date(r.created_at).getTime(),unread:r.unread,senderName:r.sender_name||''});
  });

  // 案件と現場管理データは社内全員（staff＋carpenter）が取得する
  if(currentUserRole==='staff'||currentUserRole==='carpenter'){
    const { data: projectRows } = await sb.from('projects').select('*').order('updated_at',{ascending:false});
    projects = (projectRows||[]).map(r=>({id:r.id,name:r.name,clientName:r.client_name||'',type:r.type||'新築',address:r.address||'',note:r.note||'',startDate:r.start_date||'',endDate:r.end_date||'',mapLat:r.map_lat||null,mapLng:r.map_lng||null,updatedAt:r.updated_at}));

    await fetchGenbaData();
  }

  // 見積・原価・受発注データは管理者(staff)＋一般社員(carpenter)が取得（全機能アクセス）
  if(currentUserRole==='staff'||currentUserRole==='carpenter'){
    if(currentUserRole==='staff') await fetchWorkCalendar(); // 勤務カレンダー・社員区分は管理者のみ

    const { data: typeRows } = await sb.from('estimate_types').select('*').order('sort_order').order('id');
    estimateTypes = (typeRows||[]).map(r=>({id:r.id,name:r.name,sortOrder:r.sort_order}));
    estTypeIdSeq = Math.max(0,...estimateTypes.map(t=>t.id))+1;

    const { data: catRows } = await sb.from('estimate_categories').select('*').order('sort_order').order('id');
    estimateCategories = (catRows||[]).map(r=>({id:r.id,name:r.name,workType:r.work_type||'新築',sortOrder:r.sort_order}));
    estCatIdSeq = Math.max(0,...estimateCategories.map(c=>c.id))+1;

    const { data: presetRows } = await sb.from('estimate_presets').select('*').order('sort_order').order('id');
    estimatePresets = (presetRows||[]).map(r=>({id:r.id,cat:r.cat,name:r.name,unit:r.unit,cost:Number(r.cost),workType:r.work_type||'新築',sortOrder:r.sort_order}));
    estPresetIdSeq = Math.max(0,...estimatePresets.map(p=>p.id))+1;

    const { data: defRows } = await sb.from('estimate_defaults').select('*');
    estimateDefaults = {};
    (defRows||[]).forEach(r=>{estimateDefaults[r.type]=r.sections||[];});

    renderPresetDatalists();

    const { data: estRows } = await sb.from('estimates').select('*').order('updated_at',{ascending:false});
    estimates = (estRows||[]).map(rowToEstimate);
    estSeq = estimates.length+1;

    const { data: orderRows } = await sb.from('orders').select('*').order('created_at',{ascending:false});
    orders = (orderRows||[]).map(r=>({id:r.id,no:r.no,project:r.project,date:r.date,dueDate:r.due_date,costType:r.cost_type,suppliers:supplierNameById(r.supplier_id),items:r.items,subtotal:Number(r.subtotal),tax:Number(r.tax),total:Number(r.total),status:r.status}));

    const { data: costRows } = await sb.from('cost_entries').select('*').order('created_at',{ascending:false});
    costEntries = (costRows||[]).map(r=>({id:r.id,date:r.date,project:r.project,name:r.name,qty:Number(r.qty),unit:r.unit,amount:Number(r.amount),supplier:supplierNameById(r.supplier_id),orderNo:r.order_no,costType:r.cost_type,status:r.status}));
  }
}

function rowToEstimate(r){
  const ci=r.contract_info||{};
  return {id:r.id,title:r.title,no:r.no,date:r.date,expire:r.expire,status:r.status,type:r.type,
    startDate:r.start_date,endDate:r.end_date,clientName:r.client_name,projectName:r.project_name,siteName:r.site_name,
    note:r.note,discountAmount:Number(r.discount_amount),taxRate:Number(r.tax_rate),payments:r.payments||[],sections:r.sections||[],
    contractDate:ci.contractDate||'',contractAmount:ci.contractAmount||0,extras:ci.extras||[],
    completion:ci.completion||0,actualProfit:ci.actualProfit||0,ordersMemo:ci.ordersMemo||'',clientAddress:ci.clientAddress||'',tantou:ci.tantou||'',clientTel:ci.clientTel||'',clientEmail:ci.clientEmail||'',mapLat:ci.mapLat||null,mapLng:ci.mapLng||null,
    updatedAt:r.updated_at};
}

// ── 案件マスタ ──
async function dbSaveProject(proj){
  const row={name:proj.name,client_name:proj.clientName,type:proj.type,address:proj.address,note:proj.note,
    start_date:proj.startDate||null,end_date:proj.endDate||null,map_lat:proj.mapLat??null,map_lng:proj.mapLng??null,
    updated_at:new Date().toISOString()};
  if(proj.id){
    // 案件名が変わった場合、紐づく見積のproject_nameも一括更新する
    const oldProject=projects.find(p=>p.id===proj.id);
    const oldName=oldProject?.name;
    const {error}=await sb.from('projects').update(row).eq('id',proj.id);
    if(error){showToast('保存に失敗しました：'+error.message);throw error;}
    if(oldName && oldName!==proj.name){
      const {error:estErr}=await sb.from('estimates').update({project_name:proj.name}).eq('project_name',oldName);
      if(estErr) console.warn('見積の案件名更新に失敗：',estErr.message);
      else estimates.forEach(e=>{if(e.projectName===oldName)e.projectName=proj.name;});
    }
    return proj.id;
  }
  const {data,error}=await sb.from('projects').insert(row).select().single();
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
  return data.id;
}
async function dbDeleteProject(id){
  const {error}=await sb.from('projects').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}

// ── 見積：工事区分マスタ ──
async function dbAddEstimateType(name){
  const { data, error } = await sb.from('estimate_types').insert({name,sort_order:estimateTypes.length}).select().single();
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
  return data.id;
}
async function dbDeleteEstimateType(id){
  const { error } = await sb.from('estimate_types').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}

// ── 見積：工種マスタ ──
async function dbAddEstCategory(name,workType){
  const { data, error } = await sb.from('estimate_categories').insert({name,work_type:workType}).select().single();
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
  return data.id;
}
async function dbUpdateEstCategory(id,name){
  const { error } = await sb.from('estimate_categories').update({name}).eq('id',id);
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
}
async function dbDeleteEstCategory(id){
  const { error } = await sb.from('estimate_categories').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}
async function dbReorderEstCategories(orderedCats){
  for(let i=0;i<orderedCats.length;i++){
    const { error } = await sb.from('estimate_categories').update({sort_order:i}).eq('id',orderedCats[i].id);
    if(error){showToast('並び順の保存に失敗しました：'+error.message);throw error;}
    orderedCats[i].sortOrder = i;
  }
}

// ── 見積：工事品目マスタ ──
async function dbAddEstPreset(item){
  const { data, error } = await sb.from('estimate_presets').insert({cat:item.cat,name:item.name,unit:item.unit,cost:item.cost,work_type:item.workType}).select().single();
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
  return data.id;
}
async function dbUpdateEstPreset(id,item){
  const { error } = await sb.from('estimate_presets').update({cat:item.cat,name:item.name,unit:item.unit,cost:item.cost}).eq('id',id);
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
}
async function dbDeleteEstPreset(id){
  const { error } = await sb.from('estimate_presets').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}
async function dbReorderEstPresets(orderedPresets){
  for(let i=0;i<orderedPresets.length;i++){
    const { error } = await sb.from('estimate_presets').update({sort_order:i}).eq('id',orderedPresets[i].id);
    if(error){showToast('並び順の保存に失敗しました：'+error.message);throw error;}
    orderedPresets[i].sortOrder = i;
  }
}

// ── 見積：工事区分ごとのデフォルト明細 ──
async function dbSaveEstimateDefault(type,sectionsData){
  const { error } = await sb.from('estimate_defaults').upsert({type,sections:sectionsData,updated_at:new Date().toISOString()});
  if(error){showToast('デフォルトの保存に失敗しました：'+error.message);throw error;}
  estimateDefaults[type] = sectionsData;
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
async function dbDeleteSupplier(id){
  const { error } = await sb.from('suppliers').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}
async function dbReorderSuppliers(orderedSuppliers){
  for(let i=0;i<orderedSuppliers.length;i++){
    const { error } = await sb.from('suppliers').update({sort_order:i}).eq('id',orderedSuppliers[i].id);
    if(error){showToast('並び順の保存に失敗しました：'+error.message);throw error;}
    orderedSuppliers[i].sortOrder = i;
  }
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
  const payload = currentUserRole!=='supplier'
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
    title:data.title,no:data.no,date:data.date||null,expire:data.expire||null,status:data.status,type:data.type,
    start_date:data.startDate||null,end_date:data.endDate||null,
    client_name:data.clientName,project_name:data.projectName,site_name:data.siteName,note:data.note,
    discount_amount:data.discountAmount,tax_rate:data.taxRate,payments:data.payments,sections:data.sections,
    contract_info:{
      contractDate:data.contractDate||null,contractAmount:data.contractAmount||0,
      extras:data.extras||[],
      completion:data.completion||0,actualProfit:data.actualProfit||0,ordersMemo:data.ordersMemo||'',clientAddress:data.clientAddress||'',tantou:data.tantou||'',clientTel:data.clientTel||'',clientEmail:data.clientEmail||'',mapLat:data.mapLat||null,mapLng:data.mapLng||null
    },
    updated_at:new Date().toISOString()
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
async function dbDeleteEstimate(id){
  const { error } = await sb.from('estimates').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}

// ── 発注履歴・原価管理 ──
async function dbDeleteOrder(orderNo,supplierName){
  const supplier_id = supplierIdByName(supplierName);
  const { error: e1 } = await sb.from('cost_entries').delete().eq('order_no',orderNo).eq('supplier_id',supplier_id);
  if(e1){showToast('削除に失敗しました：'+e1.message);throw e1;}
  const { error: e2 } = await sb.from('orders').delete().eq('no',orderNo).eq('supplier_id',supplier_id);
  if(e2){showToast('削除に失敗しました：'+e2.message);throw e2;}
}
async function dbDeleteCostEntry(id){
  const { error } = await sb.from('cost_entries').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}

// ── チャット ──
async function dbDeleteChatMessage(supplierName,msgId){
  const { error } = await sb.from('chat_messages').delete().eq('id',msgId);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
  if(talkThreads[supplierName]) talkThreads[supplierName]=talkThreads[supplierName].filter(m=>m.id!==msgId);
}

// 発注書PDFをサーバー側（Edge Function）で生成・保存してもらい、ダウンロード用URLを受け取る
async function dbGenerateOrderPdf(order){
  const { data, error } = await sb.functions.invoke('generate-order-pdf', { body: order });
  if(error){showToast('発注書PDFの生成に失敗しました：'+error.message);throw error;}
  if(data?.error){showToast('発注書PDFの生成に失敗しました：'+data.error);throw new Error(data.error);}
  return data.url;
}

// ── 発注確定（発注書・原価・チャット投稿） ──
async function dbConfirmOrder(order){
  const supplier_id = supplierIdByName(order.suppliers);
  const { data: orderRow, error: orderErr } = await sb.from('orders').insert({
    no:order.no,project:order.project,date:order.date,due_date:order.dueDate||null,cost_type:order.costType,supplier_id,
    items:order.items,subtotal:order.subtotal,tax:order.tax,total:order.total,status:'pending'
  }).select().single();
  if(orderErr){showToast('発注確定に失敗しました：'+orderErr.message);throw orderErr;}

  const costRows = order.items.map(item=>({
    date:order.date,project:order.project,name:item.name,qty:item.qty,unit:item.unit,
    amount:item.cost*item.qty,supplier_id,order_no:order.no,cost_type:order.costType,status:'pending'
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
  const isInternal = supplierName===INTERNAL_THREAD;
  const supplier_id = isInternal ? null : supplierIdByName(supplierName);
  if(!isInternal && !supplier_id) return;
  const { data, error } = await sb.from('chat_messages').insert({
    supplier_id, is_internal:isInternal, role:msg.role, type:msg.type||'text', text:msg.text||null, order_data:msg.orderData||null,
    file_url:msg.fileUrl||null, file_name:msg.fileName||null, file_mime:msg.fileMime||null, unread:false,
    sender_name: currentUserDisplayName||''
  }).select().single();
  if(error){showToast('送信に失敗しました：'+error.message);throw error;}
  if(!talkThreads[supplierName]) talkThreads[supplierName]=[];
  talkThreads[supplierName].push({id:data.id,role:data.role,type:data.type,text:data.text,orderData:data.order_data,fileUrl:data.file_url,fileName:data.file_name,fileMime:data.file_mime,ts:new Date(data.created_at).getTime(),unread:false,senderName:data.sender_name||''});

  // 通知の送信。失敗してもチャット送信自体は成立させる（msg.silent=trueなら通知しない：自動転記用）
  if(msg.silent) return;
  const preview = msg.type==='order' ? `📋 発注書 ${msg.orderData?.no||''}` : msg.type==='file' ? `📎 ${msg.fileName||'ファイル'}` : (msg.text||'');
  if(isInternal){
    // 社内チャット：自分以外の社員全員（staff＋carpenter）へ
    dbSendPush('employee', null, `${INTERNAL_THREAD} ${currentUserDisplayName||''}`, preview, currentUserId).catch(()=>{});
  } else if(msg.role==='me'){
    dbSendPush('supplier', supplier_id, supplierName, preview).catch(()=>{});
  } else {
    dbSendPush('staff', null, supplierName, preview).catch(()=>{});
  }
}

// チャット添付ファイル（写真・PDF等）をSupabase Storageにアップロードし、公開URLを返す
async function dbUploadChatFile(file){
  // 保存先のキーには日本語等が使えないため、拡張子だけ残して安全な名前に変換する
  // （元のファイル名はfile_nameに別途保存し、表示時に使う）
  const extMatch = file.name.match(/\.[a-zA-Z0-9]+$/);
  const ext = extMatch ? extMatch[0] : '';
  const path = `${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`;
  const { error } = await sb.storage.from('chat-files').upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if(error){showToast('ファイルのアップロードに失敗しました：'+error.message);throw error;}
  const { data } = sb.storage.from('chat-files').getPublicUrl(path);
  return data.publicUrl;
}

// ── 勤務カレンダー（休日）＋社員区分 ──
async function fetchWorkCalendar(){
  const { data: rows } = await sb.from('work_holidays').select('*');
  workHolidays = {regular:new Set(), trainee:new Set()};
  (rows||[]).forEach(r=>{ (workHolidays[r.cal]||(workHolidays[r.cal]=new Set())).add(r.holiday_date); });
  // 事務のみ：社員区分の割り当て用に全プロフィールを取得（RLSでstaffは全件可）
  if(currentUserRole==='staff'){
    const { data: profs } = await sb.from('profiles').select('id, display_name, role, work_group, supplier_id').order('display_name');
    allProfiles = (profs||[]).map(p=>({id:p.id,displayName:p.display_name||'',role:p.role,workGroup:p.work_group||'',supplierId:p.supplier_id||null}));
  }
}
// アカウントの権限（role）と所属発注先を更新（管理者のみ）
async function dbSetRole(userId, role, supplierId){
  const { error } = await sb.from('profiles').update({role, supplier_id:supplierId||null}).eq('id',userId);
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
}
// アカウント新規作成（メール招待）。Edge Functionが招待メール送信とプロフィール作成を行う（管理者のみ）
async function dbInviteUser(payload){
  const { data, error } = await sb.functions.invoke('invite-user', { body: payload });
  if(error){showToast('招待に失敗しました：'+error.message);throw error;}
  if(data?.error){showToast(data.error);throw new Error(data.error);}
}
async function dbAddHoliday(cal, date){
  const { error } = await sb.from('work_holidays').insert({cal, holiday_date:date});
  if(error && error.code!=='23505'){showToast('保存に失敗しました：'+error.message);throw error;} // 23505=重複は無視
  workHolidays[cal].add(date);
}
async function dbRemoveHoliday(cal, date){
  const { error } = await sb.from('work_holidays').delete().eq('cal',cal).eq('holiday_date',date);
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
  workHolidays[cal].delete(date);
}
async function dbSetWorkGroup(userId, group){
  const { error } = await sb.from('profiles').update({work_group:group}).eq('id',userId);
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
  const p = allProfiles.find(x=>x.id===userId); if(p) p.workGroup=group;
}

// ── 現場管理（写真・図面・日報・有給） ──
async function fetchGenbaData(){
  const { data: photoRows } = await sb.from('site_photos').select('*').order('shot_date',{ascending:false}).order('id',{ascending:false});
  sitePhotos = (photoRows||[]).map(r=>({id:r.id,projectId:r.project_id,folderId:r.folder_id||null,url:r.url,caption:r.caption||'',shotDate:r.shot_date,uploadedBy:r.uploaded_by,uploaderName:r.uploader_name||'',createdAt:r.created_at}));

  const { data: drawingRows } = await sb.from('drawings').select('*').order('created_at',{ascending:false});
  drawings = (drawingRows||[]).map(r=>({id:r.id,projectId:r.project_id,folderId:r.folder_id||null,fileUrl:r.file_url,fileName:r.file_name,fileMime:r.file_mime||'',note:r.note||'',uploadedBy:r.uploaded_by,uploaderName:r.uploader_name||'',createdAt:r.created_at}));

  const { data: folderRows } = await sb.from('site_folders').select('*').order('name');
  siteFolders = (folderRows||[]).map(r=>({id:r.id,projectId:r.project_id,kind:r.kind,parentId:r.parent_id||null,name:r.name,createdBy:r.created_by}));

  const { data: viewRows } = await sb.from('drawing_views').select('*').order('viewed_at',{ascending:false});
  drawingViews = (viewRows||[]).map(r=>({id:r.id,drawingId:r.drawing_id,userId:r.user_id,userName:r.user_name||'',viewedAt:r.viewed_at}));

  // 日報・有給はRLSが自動で絞る（carpenter＝自分の分のみ／staff＝全員分）
  const { data: nippoRows } = await sb.from('daily_reports').select('*').order('work_date',{ascending:false}).order('id',{ascending:false});
  dailyReports = (nippoRows||[]).map(r=>({id:r.id,userId:r.user_id,userName:r.user_name||'',workDate:r.work_date,projectId:r.project_id,projectName:r.project_name||'',workKind:r.work_kind||'',content:r.content||'',startTime:r.start_time||'08:00',endTime:r.end_time||'18:00',breakMinutes:r.break_minutes,workMinutes:r.work_minutes,overtimeMinutes:r.overtime_minutes,otStatus:r.ot_status||'none',otApproverName:r.ot_approver_name||'',otReviewerName:r.ot_reviewer_name||'',otReviewNote:r.ot_review_note||''}));

  const { data: leaveRows } = await sb.from('leave_requests').select('*').order('created_at',{ascending:false});
  leaveRequests = (leaveRows||[]).map(r=>({id:r.id,userId:r.user_id,userName:r.user_name||'',startDate:r.start_date,endDate:r.end_date,leaveType:r.leave_type,days:Number(r.days),reason:r.reason||'',status:r.status,reviewerName:r.reviewer_name||'',reviewNote:r.review_note||'',reviewedAt:r.reviewed_at,createdAt:r.created_at}));

  const { data: holidayRows } = await sb.from('holiday_requests').select('*').order('created_at',{ascending:false});
  holidayRequests = (holidayRows||[]).map(r=>({id:r.id,userId:r.user_id,userName:r.user_name||'',workDate:r.work_date,projectId:r.project_id,projectName:r.project_name||'',reason:r.reason||'',substituteDate:r.substitute_date||null,approverName:r.approver_name||'',status:r.status,reviewerName:r.reviewer_name||'',reviewNote:r.review_note||'',reviewedAt:r.reviewed_at,createdAt:r.created_at}));
}

// 現場写真・図面のファイルをStorageにアップロードし、公開URLを返す
async function dbUploadSiteFile(folder, projectId, blob, ext){
  const path = `${folder}/${projectId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`;
  const { error } = await sb.storage.from('site-files').upload(path, blob, { contentType: blob.type || 'application/octet-stream' });
  if(error){showToast('アップロードに失敗しました：'+error.message);throw error;}
  const { data } = sb.storage.from('site-files').getPublicUrl(path);
  return data.publicUrl;
}

async function dbAddSitePhoto(photo){
  const { data, error } = await sb.from('site_photos').insert({
    project_id:photo.projectId, folder_id:photo.folderId||null, url:photo.url, caption:photo.caption||'', shot_date:photo.shotDate,
    uploaded_by:currentUserId, uploader_name:currentUserDisplayName||''
  }).select().single();
  if(error){showToast('写真の登録に失敗しました：'+error.message);throw error;}
  return data.id;
}
async function dbUpdateSitePhotoCaption(id, caption){
  const { error } = await sb.from('site_photos').update({caption}).eq('id',id);
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
}
async function dbDeleteSitePhoto(id){
  const { error } = await sb.from('site_photos').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}

async function dbAddDrawing(d){
  const { data, error } = await sb.from('drawings').insert({
    project_id:d.projectId, folder_id:d.folderId||null, file_url:d.fileUrl, file_name:d.fileName, file_mime:d.fileMime||'', note:d.note||'',
    uploaded_by:currentUserId, uploader_name:currentUserDisplayName||''
  }).select().single();
  if(error){showToast('図面の登録に失敗しました：'+error.message);throw error;}
  return data.id;
}
async function dbDeleteDrawing(id){
  const { error } = await sb.from('drawings').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}

// ── フォルダ（写真・図面の整理） ──
async function dbAddFolder(projectId, kind, parentId, name){
  const { data, error } = await sb.from('site_folders').insert({
    project_id:projectId, kind, parent_id:parentId||null, name, created_by:currentUserId
  }).select().single();
  if(error){showToast('フォルダの作成に失敗しました：'+error.message);throw error;}
  return data.id;
}
async function dbRenameFolder(id, name){
  const { error } = await sb.from('site_folders').update({name}).eq('id',id);
  if(error){showToast('名前の変更に失敗しました：'+error.message);throw error;}
}
async function dbDeleteFolder(id){
  const { error } = await sb.from('site_folders').delete().eq('id',id);
  if(error){showToast('フォルダの削除に失敗しました：'+error.message);throw error;}
}
// 写真・図面を別フォルダへ移動（folderId=nullで未分類へ）
async function dbMoveItem(kind, id, folderId){
  const table = kind==='photo' ? 'site_photos' : 'drawings';
  const { error } = await sb.from(table).update({folder_id:folderId||null}).eq('id',id);
  if(error){showToast('移動に失敗しました：'+error.message);throw error;}
}

// ── 図面の閲覧記録（開くたびに日時を更新） ──
async function dbRecordDrawingView(drawingId){
  const { error } = await sb.from('drawing_views').upsert({
    drawing_id:drawingId, user_id:currentUserId, user_name:currentUserDisplayName||'', viewed_at:new Date().toISOString()
  }, { onConflict:'drawing_id,user_id' });
  if(error) console.warn('閲覧記録に失敗', error.message);
}

async function dbSaveNippo(n){
  const row = {
    work_date:n.workDate, project_id:n.projectId||null, project_name:n.projectName||'',
    work_kind:n.workKind||'', content:n.content||'', start_time:n.startTime, end_time:n.endTime,
    break_minutes:n.breakMinutes, work_minutes:n.workMinutes, overtime_minutes:n.overtimeMinutes,
    ot_status:n.otStatus||'none', ot_approver_name:n.otApproverName||'',
    updated_at:new Date().toISOString()
  };
  // 申請中・残業なしに戻す場合は前回の承認情報をクリアする
  if(n.otStatus!=='approved' && n.otStatus!=='rejected'){
    row.ot_reviewer_name=''; row.ot_review_note=''; row.ot_reviewed_at=null;
  }
  if(n.id){
    const { error } = await sb.from('daily_reports').update(row).eq('id',n.id);
    if(error){showToast('日報の保存に失敗しました：'+error.message);throw error;}
    return n.id;
  }
  const { data, error } = await sb.from('daily_reports').insert({...row, user_id:currentUserId, user_name:currentUserDisplayName||''}).select().single();
  if(error){showToast('日報の保存に失敗しました：'+error.message);throw error;}
  return data.id;
}
async function dbDeleteNippo(id){
  const { error } = await sb.from('daily_reports').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}

// 残業の承認・却下（承認者のみ。結果は本人に通知）
async function dbReviewOtNippo(id, status, note){
  const n = dailyReports.find(x=>x.id===id);
  const { error } = await sb.from('daily_reports').update({
    ot_status:status, ot_reviewer_name:currentUserDisplayName||'', ot_review_note:note||'',
    ot_reviewed_at:new Date().toISOString()
  }).eq('id',id);
  if(error){showToast('更新に失敗しました：'+error.message);throw error;}
  if(n){
    const label = status==='approved' ? '承認されました' : '却下されました';
    dbSendPushToUser(n.userId, '残業申請の結果',
      `${n.workDate.replace(/-/g,'/')} の残業申請が${label}（${currentUserDisplayName}）${note?'：'+note:''}`, 'genba/nippo').catch(()=>{});
  }
}

async function dbAddLeaveRequest(lr){
  const { data, error } = await sb.from('leave_requests').insert({
    user_id:currentUserId, user_name:currentUserDisplayName||'',
    start_date:lr.startDate, end_date:lr.endDate, leave_type:lr.leaveType, days:lr.days, reason:lr.reason||''
  }).select().single();
  if(error){showToast('申請に失敗しました：'+error.message);throw error;}
  // 承認者（清川創史）へ通知＋社内チャットへ転記。失敗しても申請自体は成立させる
  dbSendPushToNames([LEAVE_APPROVER], '有給申請',
    `${currentUserDisplayName}さんから有給申請（${lr.startDate.replace(/-/g,'/')}〜）`, 'genba/leave').catch(()=>{});
  const period = lr.startDate.replace(/-/g,'/') + (lr.endDate && lr.endDate!==lr.startDate ? '〜'+lr.endDate.replace(/-/g,'/') : '') +
    (lr.leaveType!=='全日' ? `（${lr.leaveType}）` : '');
  dbAddChatMessage(INTERNAL_THREAD, {role:'me', type:'text', silent:true,
    text:`【有給申請】${period}　${lr.days}日${lr.reason?'\n理由：'+lr.reason:''}`}).catch(()=>{});
  return data.id;
}
async function dbReviewLeaveRequest(id, status, note){
  const lr = leaveRequests.find(x=>x.id===id);
  const { error } = await sb.from('leave_requests').update({
    status, review_note:note||'', reviewer_name:currentUserDisplayName||'', reviewed_at:new Date().toISOString()
  }).eq('id',id);
  if(error){showToast('更新に失敗しました：'+error.message);throw error;}
  // 申請者本人へ通知
  if(lr){
    const label = status==='approved' ? '承認されました' : '却下されました';
    dbSendPushToUser(lr.userId, '有給申請の結果', `${lr.startDate.replace(/-/g,'/')}〜の有給申請が${label}`, 'genba/leave').catch(()=>{});
  }
}
async function dbDeleteLeaveRequest(id){
  const { error } = await sb.from('leave_requests').delete().eq('id',id);
  if(error){showToast('取り下げに失敗しました：'+error.message);throw error;}
}

// ── 休日出勤申請（承認プロセスは残業と同様：承認者1人を指名→通知・リマインド） ──
async function dbAddHolidayRequest(hr){
  const { data, error } = await sb.from('holiday_requests').insert({
    user_id:currentUserId, user_name:currentUserDisplayName||'',
    work_date:hr.workDate, project_id:hr.projectId||null, project_name:hr.projectName||'',
    reason:hr.reason||'', substitute_date:hr.substituteDate||null, approver_name:hr.approverName
  }).select().single();
  if(error){showToast('申請に失敗しました：'+error.message);throw error;}
  dbSendPushToNames([hr.approverName], '休日出勤の承認のお願い',
    `${currentUserDisplayName}さん ${hr.workDate.replace(/-/g,'/')} 休日出勤（${hr.projectName||''}）`
    + (hr.substituteDate?`　振替休日：${hr.substituteDate.replace(/-/g,'/')}`:''), 'genba/holiday').catch(()=>{});
  // 社内チャットにも記録を残す（通知は承認者宛のみ。チャット転記は通知なし）
  dbAddChatMessage(INTERNAL_THREAD, {role:'me', type:'text', silent:true,
    text:`【休日出勤申請】${hr.workDate.replace(/-/g,'/')}（${hr.projectName||''}）`
      + (hr.reason?`\n理由：${hr.reason}`:'')
      + (hr.substituteDate?`\n振替休日：${hr.substituteDate.replace(/-/g,'/')}`:'')
      + `\n承認者：${hr.approverName}`}).catch(()=>{});
  return data.id;
}
async function dbReviewHolidayRequest(id, status, note){
  const hr = holidayRequests.find(x=>x.id===id);
  const { error } = await sb.from('holiday_requests').update({
    status, reviewer_name:currentUserDisplayName||'', review_note:note||'', reviewed_at:new Date().toISOString()
  }).eq('id',id);
  if(error){showToast('更新に失敗しました：'+error.message);throw error;}
  if(hr){
    const label = status==='approved' ? '承認されました' : '却下されました';
    dbSendPushToUser(hr.userId, '休日出勤申請の結果',
      `${hr.workDate.replace(/-/g,'/')} の休日出勤申請が${label}（${currentUserDisplayName}）${note?'：'+note:''}`, 'genba/holiday').catch(()=>{});
  }
}
async function dbDeleteHolidayRequest(id){
  const { error } = await sb.from('holiday_requests').delete().eq('id',id);
  if(error){showToast('取り下げに失敗しました：'+error.message);throw error;}
}

// ── プッシュ通知 ──
async function dbSavePushSubscription(sub){
  const { data: userData } = await sb.auth.getUser();
  if(!userData?.user) return;
  const json = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({
    user_id: userData.user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth
  }, { onConflict: 'endpoint' });
  if(error){showToast('通知設定の保存に失敗しました：'+error.message);throw error;}
}
// tab: 通知タップ時に開く画面（例 'genba/nippo'。省略時はアプリを開くだけ）
async function dbSendPush(targetRole, targetSupplierId, title, body, excludeUserId, tab){
  await sb.functions.invoke('send-push', { body: { targetRole, targetSupplierId, title, body, excludeUserId, tab } });
}
async function dbSendPushToUser(targetUserId, title, body, tab){
  await sb.functions.invoke('send-push', { body: { targetRole:'user', targetUserId, title, body, tab } });
}
// 表示名で宛先を指定して送信（残業承認者への通知用）。21時〜翌7時は送らない（cronのリマインドに任せる）
async function dbSendPushToNames(targetNames, title, body, tab){
  if(isQuietHoursJST()) return;
  await sb.functions.invoke('send-push', { body: { targetRole:'names', targetNames, title, body, tab } });
}

// ── リアルタイム同期（他端末の変更を反映） ──
function subscribeRealtime(){
  sb.channel('app-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'suppliers'}, ()=>refetchAndRerender('suppliers'))
    .on('postgres_changes',{event:'*',schema:'public',table:'master_items'}, ()=>refetchAndRerender('master_items'))
    .on('postgres_changes',{event:'*',schema:'public',table:'chat_messages'}, ()=>refetchAndRerender('chat_messages'))
    .on('postgres_changes',{event:'*',schema:'public',table:'orders'}, ()=>refetchAndRerender('orders'))
    .on('postgres_changes',{event:'*',schema:'public',table:'cost_entries'}, ()=>refetchAndRerender('cost_entries'))
    .on('postgres_changes',{event:'*',schema:'public',table:'site_photos'}, ()=>refetchAndRerender('site_photos'))
    .on('postgres_changes',{event:'*',schema:'public',table:'drawings'}, ()=>refetchAndRerender('drawings'))
    .on('postgres_changes',{event:'*',schema:'public',table:'site_folders'}, ()=>refetchAndRerender('site_folders'))
    .on('postgres_changes',{event:'*',schema:'public',table:'drawing_views'}, ()=>refetchAndRerender('drawing_views'))
    .on('postgres_changes',{event:'*',schema:'public',table:'daily_reports'}, ()=>refetchAndRerender('daily_reports'))
    .on('postgres_changes',{event:'*',schema:'public',table:'leave_requests'}, ()=>refetchAndRerender('leave_requests'))
    .on('postgres_changes',{event:'*',schema:'public',table:'holiday_requests'}, ()=>refetchAndRerender('holiday_requests'))
    .on('postgres_changes',{event:'*',schema:'public',table:'work_holidays'}, ()=>refetchAndRerender('work_holidays'))
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
  if((table==='orders'||table==='cost_entries') && (currentUserRole==='staff'||currentUserRole==='carpenter')){
    if(document.getElementById('ordersub-history')?.classList.contains('active')) renderOrders();
    if(document.getElementById('page-cost')?.classList.contains('active')) renderCost();
  }
  if(['site_photos','drawings','site_folders','drawing_views','daily_reports','leave_requests','holiday_requests'].includes(table)){
    if(document.getElementById('page-genba')?.classList.contains('active')) renderGenbaPage();
    renderInfoGenbaSections && renderInfoGenbaSections();
    refreshFB && refreshFB(); // 開いているファイルブラウザにも反映
  }
  if(table==='work_holidays' && document.getElementById('wc-modal')?.classList.contains('open')) renderWorkCalendar();
  // 日報の追加・修正は原価サマリーの人工集計にも即時反映する
  if(table==='daily_reports' && (currentUserRole==='staff'||currentUserRole==='carpenter') && document.getElementById('page-cost')?.classList.contains('active')){
    renderCost();
  }
}
