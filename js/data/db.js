// ════ Supabase データ層（取得・保存・複数端末リアルタイム同期） ════

// 案件チャットのスレッド名（「案件：〇〇邸」）。IDとの対応も記録する
function projectThreadName(projectId){
  const p = projects.find(x=>x.id===projectId);
  const name = PROJECT_THREAD_PREFIX + (p ? p.name : '（削除された案件）');
  projectThreadIds[name] = projectId;
  return name;
}
function isProjectThread(threadName){ return String(threadName||'').startsWith(PROJECT_THREAD_PREFIX); }

// ── 個別チャット（1対1） ──
//
// スレッド名は「個別：<相手の名前>」。相手のIDとの対応は directThreadIds に持つ。
// 見られるのはその2人だけ（migration-genba62.sql）。
function directThreadName(userId){
  const p = (allProfiles||[]).find(x=>x.id===userId);
  const name = DIRECT_THREAD_PREFIX + (p?.displayName || '（不明な相手）');
  directThreadIds[name] = userId;
  return name;
}
function isDirectThread(threadName){ return String(threadName||'').startsWith(DIRECT_THREAD_PREFIX); }
// ── グループチャット（何人か） ──
//
// スレッド名は「グループ：<グループ名>」。同じ名前のグループが他にもあるときは番号を添えて分ける。
// 見られるのはメンバーだけ（migration-genba68.sql）。
function groupById(id){ return (chatGroups||[]).find(g=>g.id===id) || null; }
function groupThreadName(groupId){
  const g = groupById(groupId);
  const base = g ? g.name : '（削除されたグループ）';
  const dup = g && (chatGroups||[]).some(x=>x.id!==g.id && x.name===g.name);
  const name = GROUP_THREAD_PREFIX + base + (dup ? `（${groupId}）` : '');
  groupThreadIds[name] = groupId;
  return name;
}
function isGroupThread(threadName){ return String(threadName||'').startsWith(GROUP_THREAD_PREFIX); }
// ── お客様チャット（案件ごと。お客様ときよかわの担当だけ） ──
//
// スレッド名は「お客様：<案件名>」。社内の案件チャットとは別物で、お客様に社内のやりとりは見えない。
// 入れるのは、その案件に登録したお客様（project_clients。ご主人・奥様など何人でも）と、
// 案件情報で選んだ社員だけ（migration-genba69.sql / migration-genba70.sql）。
// 誰の発言かは、吹き出しの上に出る名前（sender_name＝そのお客様のお名前）で分かる。
function clientChatOf(projectId){ return (clientChats||[]).find(c=>c.projectId===projectId) || null; }
function clientThreadName(projectId){
  const c = clientChatOf(projectId);
  const p = (projects||[]).find(x=>x.id===projectId);
  const name = CLIENT_THREAD_PREFIX + (c?.projectName || p?.name || '（削除された案件）');
  clientThreadIds[name] = projectId;
  return name;
}
function isClientThread(threadName){ return String(threadName||'').startsWith(CLIENT_THREAD_PREFIX); }
function isClientUser(){ return currentUserRole==='client'; }

// 社員どうしのように、送った人の名前で左右を分けるスレッドか（社内・案件・個別・グループ・お客様）
function isNamedSenderThread(threadName){
  return threadName===INTERNAL_THREAD || isProjectThread(threadName) || isDirectThread(threadName)
      || isGroupThread(threadName) || isClientThread(threadName);
}

// 自分と相手のIDを、小さいほう・大きいほうの順で返す
function directPair(otherId){
  const a = String(currentUserId||''), b = String(otherId||'');
  return a < b ? [a, b] : [b, a];
}

function supplierIdByName(name){
  const s = suppliers.find(x=>x.name===name);
  return s ? s.id : null;
}
function supplierNameById(id){
  const s = suppliers.find(x=>x.id===id);
  return s ? s.name : '（不明な発注先）';
}

// 読み込みの仕事を、同時に limit 本までに絞って走らせる。
// 弱い回線で何十本も同時に投げると帯域を取り合って逆に遅くなるため、空いた枠に次を流す
async function runWithLimit(jobs, limit){
  let i = 0;
  const workers = Array.from({length: Math.min(limit, jobs.length)}, async () => {
    while(i < jobs.length) await jobs[i++]();
  });
  await Promise.all(workers);
}

// ── 初回データ取得 ──
//
// スマホの回線では、Supabaseへの1往復に200ms前後かかる。
// 以前はこれを40回以上「1つずつ」待っていたため、開いてから使えるまでに
// 8〜10秒かかっていた（データ量は全部でも1MB足らずで、遅さの原因は往復の回数）。
//
// いまは ① 互いに関係しないものを一度に頼み ② 受け取ってから順に組み立てる。
// 待ち時間は、いちばん遅い1本ぶんで済む。
//
// 組み立ての順番には決まりがある。
//   ・発注先 → 品目・発注・原価（発注先の名前を引くため）
//   ・案件・名簿 → チャット（スレッドの名前に案件名と相手の名前を使うため）
async function fetchAllData(){
  // お客様（施主）はチャットだけの役割。ほかは権限が無く空で返るので、最初から取りに行かない
  if(isClientUser()){
    suppliers=[]; master=[]; projects=[]; estimates=[]; orders=[]; costEntries=[]; allProfiles=[];
    await fetchChatData();
    return;
  }
  const isEmployee = currentUserRole==='staff' || currentUserRole==='carpenter';
  const isSupplierUser = currentUserRole==='supplier';

  // ── ① いっぺんに頼む ──
  //
  // ただし本当に全部同時ではなく、8本ずつに絞って流す。
  // 弱い回線で何十本も同時に投げると、帯域を取り合って逆に遅くなるため
  const R = {};                                       // 受け取った生データの置き場
  const get = (key, makeQuery) => () => Promise.resolve(makeQuery()).then(res => { R[key] = res; });
  // 表がまだ無い環境でも止めないもの。失敗しても続ける
  const soft = (fn, onFail) => () => fn().catch(e => {
    console.warn('読み込みに失敗しました（続行）', e?.message || e);
    if(onFail) onFail();
  });

  const jobs = [
    get('suppliers', ()=>sb.from('suppliers').select('*').order('sort_order').order('id')),
    get('master',    ()=>sb.from('master_items').select('*').order('sort_order').order('id')),
    get('chat',      fetchChatRows),
    soft(fetchProfiles),
    soft(fetchMyNotifications, ()=>{ notificationsReady=false; }),
    soft(fetchTasks,           ()=>{ tasksReady=false; }),
    soft(fetchInvoices,        ()=>{ invoicesReady=false; }),
    soft(fetchItemPriceChanges,()=>{ priceHistoryReady=false; }),
  ];

  if(isEmployee){
    jobs.push(
      get('projects',    ()=>sb.from('projects').select('*').order('updated_at',{ascending:false})),
      get('projClients', ()=>sb.from('project_clients').select('*').order('id')),
      get('estTypes',    ()=>sb.from('estimate_types').select('*').order('sort_order').order('id')),
      get('estCats',     ()=>sb.from('estimate_categories').select('*').order('sort_order').order('id')),
      get('estPresets',  ()=>sb.from('estimate_presets').select('*').order('sort_order').order('id')),
      get('estDefaults', ()=>sb.from('estimate_defaults').select('*')),
      get('estimates',   fetchEstimateRows),
      get('orders',      ()=>sb.from('orders').select('*').order('created_at',{ascending:false})),
      get('costs',       ()=>sb.from('cost_entries').select('*').order('created_at',{ascending:false})),
      soft(fetchGenbaData),
      soft(fetchCardStatements),
      soft(fetchVehicles),
      soft(fetchInspections),
      soft(fetchAppSettings),
      soft(fetchWorkCalendar),
      soft(fetchInvoiceLines,  ()=>{ invoiceLinesReady=false; }),
      soft(fetchInvoiceHints,  ()=>{ invoiceHints=[]; }),
      soft(fetchReceipts,      ()=>{ receiptsReady=false; }),   // レシート台帳
      soft(fetchQuoteRequests, ()=>{ quoteRequestsReady=false; }),   // 見積依頼
      soft(fetchTaskTemplates, ()=>{ taskTemplatesReady=false; }),
      soft(fetchStaffAssigns,  ()=>{ ssReady=false; }),              // 人員配置スケジュール
    );
  } else if(isSupplierUser){
    jobs.push(
      get('projects', ()=>sb.from('projects').select('*')),
      get('orders',   ()=>sb.from('orders').select('*').order('date',{ascending:false})),
      soft(fetchSupplierGenbaData),
    );
  }
  await runWithLimit(jobs, 8);

  // ── ② 受け取ったものを、順に組み立てる（ここから先は通信しない） ──
  //
  // 無いと画面が空っぽになってしまうものは、失敗をそのまま上に投げる。
  // 黙って空の一覧を出すと「データが消えた」と勘違いさせてしまうため
  for(const key of ['suppliers','master','projects','estimates','orders','costs']){
    if(R[key]?.error) throw R[key].error;
  }
  suppliers = (R.suppliers.data||[]).map(r=>({id:r.id,name:r.name,contact:r.contact||'',tel:r.tel||'',email:r.email||'',cats:r.cats||'',note:r.note||'',chatworkRoomId:r.chatwork_room_id||'',orderChannels:(Array.isArray(r.order_channels)&&r.order_channels.length)?r.order_channels:['chat'],sortOrder:r.sort_order,
    closingDay:Number(r.closing_day)||0, invoiceRegNo:r.invoice_reg_no||''}));
  supplierIdSeq = Math.max(0,...suppliers.map(s=>s.id))+1;

  master = (R.master.data||[]).map(r=>({id:r.id,cat:r.cat,name:r.name,unit:r.unit,price:Number(r.price),cost:Number(r.cost),supplier:supplierNameById(r.supplier_id),sortOrder:r.sort_order,
    makerCode:r.maker_code||'', webPrice:(r.web_price==null?null:Number(r.web_price)), webPriceAt:r.web_price_at||'',
    shipping:Number(r.shipping)||0, shippingPer:(r.shipping_per==='unit'?'unit':'order'),
    perBundle:Number(r.per_bundle)||0,
    // 寸法は品目名とは別に持つ（migration-genba93.sql）。列がまだ無い環境では undefined のまま
    baseName:r.base_name||'', noDims:!!r.no_dims,
    dim1:(r.dim1==null?null:Number(r.dim1)), dim2:(r.dim2==null?null:Number(r.dim2)), dim3:(r.dim3==null?null:Number(r.dim3))}));
  masterIdSeq = Math.max(0,...master.map(m=>m.id))+1;

  if(isEmployee){
    projects = (R.projects?.data||[]).map(r=>({id:r.id,name:r.name,clientName:r.client_name||'',type:r.type||'新築',address:r.address||'',note:r.note||'',startDate:r.start_date||'',endDate:r.end_date||'',mapLat:r.map_lat||null,mapLng:r.map_lng||null,parkingAddress:r.parking_address||'',parkingLat:r.parking_lat||null,parkingLng:r.parking_lng||null,members:r.members||[],coverPhotoId:r.cover_photo_id||null,actualStartDate:r.actual_start_date||'',handoverDate:r.handover_date||'',updatedAt:r.updated_at,
      clientUserId:r.client_user_id||null, clientEmail:r.client_email||'',
      clientChatMemberIds:r.client_chat_member_ids||[], clientChatMemberNames:r.client_chat_member_names||[]}));
    applyProjectClients(R.projClients);   // 案件ごとのお客様（ご主人・奥様など）

    estimateTypes = (R.estTypes?.data||[]).map(r=>({id:r.id,name:r.name,sortOrder:r.sort_order}));
    estTypeIdSeq = Math.max(0,...estimateTypes.map(t=>t.id))+1;

    estimateCategories = (R.estCats?.data||[]).map(r=>({id:r.id,name:r.name,workType:r.work_type||'新築',sortOrder:r.sort_order}));
    estCatIdSeq = Math.max(0,...estimateCategories.map(c=>c.id))+1;

    estimatePresets = (R.estPresets?.data||[]).map(r=>({id:r.id,cat:r.cat,name:r.name,unit:r.unit,cost:Number(r.cost),workType:r.work_type||'新築',sortOrder:r.sort_order}));
    estPresetIdSeq = Math.max(0,...estimatePresets.map(p=>p.id))+1;

    estimateDefaults = {};
    (R.estDefaults?.data||[]).forEach(r=>{estimateDefaults[r.type]=r.sections||[];});
    renderPresetDatalists();

    estimates = (R.estimates?.data||[]).map(rowToEstimate);
    estSeq = estimates.length+1;

    orders = (R.orders?.data||[]).map(orderRowTo);
    costEntries = (R.costs?.data||[]).map(r=>({id:r.id,date:r.date,project:r.project,name:r.name,qty:Number(r.qty),unit:r.unit,amount:Number(r.amount),supplier:supplierNameById(r.supplier_id),orderNo:r.order_no,costType:r.cost_type,status:r.status}));
  } else if(isSupplierUser){
    // 業者：参加している案件だけ（RLSでも絞られる）。案件情報の表示にも使う
    projects = (R.projects?.data||[])
      .filter(r=>isMyProjectMember(r.members))
      .map(r=>({id:r.id,name:r.name,type:r.type||'',address:r.address||'',note:r.note||'',
        startDate:r.start_date||'',endDate:r.end_date||'',actualStartDate:r.actual_start_date||'',handoverDate:r.handover_date||'',
        mapLat:r.map_lat||null,mapLng:r.map_lng||null,parkingAddress:r.parking_address||'',
        members:r.members||[]}));
    // 自社宛の発注（受領ボタンの状態に使う）
    orders = (R.orders?.data||[]).map(orderRowTo);
  }

  // チャットは、案件と名簿がそろってから組み立てる。
  // 先に組み立てると、案件チャット・お客様チャットの名前が「（削除された案件）」になってしまう
  buildChatData(R.chat);
}

// 発注の行を、画面が使う形にする（社員も業者も同じ形）
function orderRowTo(r){
  return {id:r.id,no:r.no,project:r.project,date:r.date,dueDate:r.due_date,dueAsap:!!r.due_asap,costType:r.cost_type,
    paymentMethod:r.payment_method||'',suppliers:supplierNameById(r.supplier_id),items:r.items,
    subtotal:Number(r.subtotal),tax:Number(r.tax),total:Number(r.total),status:r.status,receivedAt:r.received_at||'',
    priceEdits:r.price_edits||[],createdByName:r.created_by_name||'',
    deliveryPlace:r.delivery_place||'',deliveryAddress:r.delivery_address||'',note:r.note||'',
    // 業者さんが受領のときに入れる納品予定日（migration-genba95.sql）。
    // deliveryDates は品目ごと、deliveryOn はそのうちいちばん遅い日
    deliveryOn:r.delivery_on||'', deliveryDates:Array.isArray(r.delivery_dates)?r.delivery_dates:[],
    // 業者さんが「納品完了」にした品目（migration-genba96.sql）
    deliveredDates:Array.isArray(r.delivered_dates)?r.delivered_dates:[],
    // 発注したあとでキャンセルした品目（同じく migration-genba96.sql）
    cancelledItems:Array.isArray(r.cancelled_items)?r.cancelled_items:[]};
}

// ── 見積の明細は、その案件を開いたときに読む ──
//
// 見積1件の明細は数百行になることもある。開くたびに全件ぶん取りに行くと、
// 件数が増えるほど立ち上がりが遅くなるので、ふだんは明細を除いたものだけ読む。
// 一覧に出す「見積総額」「原価」は、データベース側で足した数字を受け取る。
//
// 読み込んであるかどうかは sectionsLoaded で見る。
//   true      … 明細まで持っている（計算も保存もできる）
//   false     … まだ。合計の数字（sectionsTotal / sectionsCost）だけ持っている
//   undefined … 画面で組み立てたもの（明細を持っている）
function estSectionsReady(e){
  return !!e && (e.sectionsLoaded === true
              || (e.sectionsLoaded === undefined && Array.isArray(e.sections)));
}
function estSectionsSum(e, field){
  if(estSectionsReady(e)){
    return (e.sections||[]).reduce((t,s)=>
      t + (s.items||[]).reduce((t2,i)=>t2 + (Number(i.qty)||0)*(Number(i[field])||0), 0), 0);
  }
  return Number(field==='price' ? e?.sectionsTotal : e?.sectionsCost) || 0;
}
function estWorkTotal(e){ return estSectionsSum(e,'price'); }   // 明細の売価合計
function estWorkCost(e){  return estSectionsSum(e,'cost');  }   // 明細の原価合計

// その見積の明細を読み込む（すでに持っていれば何もしない）
async function ensureEstimateSections(est){
  if(!est || estSectionsReady(est)) return est;
  const { data, error } = await sb.from('estimates').select('sections').eq('id', est.id).single();
  if(error){ showToast('明細を読み込めませんでした：'+error.message); throw error; }
  est.sections = data?.sections || [];
  est.sectionsLoaded = true;
  return est;
}

// 開いたときの読み込み。明細を除いた estimates_lite を使う。
// まだ無い環境（migration-genba90.sql が未実行）では、これまでどおり明細ごと読む
let _estLiteOk = true;
async function fetchEstimateRows(){
  if(_estLiteOk){
    const res = await sb.from('estimates_lite').select('*').order('updated_at',{ascending:false});
    if(!res.error) return res;
    const code = String(res.error.code||'');
    if(code!=='42P01' && code!=='PGRST205' && code!=='PGRST202') return res;
    console.warn('estimates_lite がまだ無いので、明細ごと読みます（supabase/migration-genba90.sql）');
    _estLiteOk = false;
  }
  return sb.from('estimates').select('*').order('updated_at',{ascending:false});
}

function rowToEstimate(r){
  const ci=r.contract_info||{};
  return {id:r.id,title:r.title,no:r.no,date:r.date,expire:r.expire,status:r.status,type:r.type,
    startDate:r.start_date,endDate:r.end_date,clientName:r.client_name,projectName:r.project_name,siteName:r.site_name,
    note:r.note,discountAmount:Number(r.discount_amount),taxRate:Number(r.tax_rate),payments:r.payments||[],
    sections:r.sections||[],
    sectionsLoaded: r.sections !== undefined,
    sectionsTotal: Number(r.sections_total)||0,
    sectionsCost:  Number(r.sections_cost)||0,
    contractDate:ci.contractDate||'',contractAmount:ci.contractAmount||0,extras:ci.extras||[],
    completion:ci.completion||0,actualProfit:ci.actualProfit||0,ordersMemo:ci.ordersMemo||'',clientAddress:ci.clientAddress||'',tantou:ci.tantou||'',clientTel:ci.clientTel||'',clientEmail:ci.clientEmail||'',mapLat:ci.mapLat||null,mapLng:ci.mapLng||null,
    updatedAt:r.updated_at};
}

// ── 案件マスタ ──
async function dbSaveProject(proj){
  // 新しく作る案件は、指定が無ければ管理者を参加メンバーに入れる。
  // 案件モーダルからの作成にもかけたいので、保存の入口でまとめて面倒を見る
  if(!proj.id && !(proj.members||[]).length && typeof staffMemberNames==='function'){
    proj={...proj, members:staffMemberNames()};
  }
  const row={name:proj.name,client_name:proj.clientName,type:proj.type,address:proj.address,note:proj.note,
    start_date:proj.startDate||null,end_date:proj.endDate||null,
    actual_start_date:proj.actualStartDate||null,handover_date:proj.handoverDate||null,map_lat:proj.mapLat??null,map_lng:proj.mapLng??null,
    parking_address:proj.parkingAddress||'',parking_lat:proj.parkingLat??null,parking_lng:proj.parkingLng??null,
    members:proj.members||[],
    client_email:proj.clientEmail||'',
    client_chat_member_ids:proj.clientChatMemberIds||[],
    client_chat_member_names:proj.clientChatMemberNames||[],
    updated_at:new Date().toISOString()};
  // 実績日の列（migration-genba28.sql）が未適用でも保存できるようにする
  const stripNewCols = r => { const {actual_start_date, handover_date, ...rest} = r; return rest; };
  // お客様チャットの列（migration-genba69.sql）が未適用でも保存できるようにする
  const stripClientCols = r => { const {client_email, client_chat_member_ids, client_chat_member_names, ...rest} = r; return rest; };
  if(proj.id){
    // 案件名が変わった場合、紐づく見積のproject_nameも一括更新する
    const oldProject=projects.find(p=>p.id===proj.id);
    const oldName=oldProject?.name;
    let {error}=await sb.from('projects').update(row).eq('id',proj.id);
    if(error && /actual_start_date|handover_date/.test(error.message||'')){
      console.warn('着工日・引渡日の列が未作成のため、その2つを除いて保存します');
      ({error}=await sb.from('projects').update(stripNewCols(row)).eq('id',proj.id));
    }
    if(error && /client_email|client_chat_member/.test(error.message||'')){
      console.warn('お客様チャットの列が未作成のため、その分を除いて保存します');
      ({error}=await sb.from('projects').update(stripClientCols(row)).eq('id',proj.id));
    }
    if(error){showToast('保存に失敗しました：'+error.message);throw error;}
    if(oldName && oldName!==proj.name){
      const {error:estErr}=await sb.from('estimates').update({project_name:proj.name}).eq('project_name',oldName);
      if(estErr) console.warn('見積の案件名更新に失敗：',estErr.message);
      else estimates.forEach(e=>{if(e.projectName===oldName)e.projectName=proj.name;});
    }
    return proj.id;
  }
  let {data,error}=await sb.from('projects').insert(row).select().single();
  if(error && /actual_start_date|handover_date/.test(error.message||'')){
    ({data,error}=await sb.from('projects').insert(stripNewCols(row)).select().single());
  }
  if(error && /client_email|client_chat_member/.test(error.message||'')){
    ({data,error}=await sb.from('projects').insert(stripClientCols(row)).select().single());
  }
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
  const { data, error } = await sb.from('suppliers').insert({name:item.name,contact:item.contact,tel:item.tel,email:item.email,cats:item.cats,note:item.note,chatwork_room_id:item.chatworkRoomId||'',order_channels:item.orderChannels||['chat'],closing_day:item.closingDay||0,invoice_reg_no:item.invoiceRegNo||''}).select().single();
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
  suppliers.push({id:data.id,...item});
}
async function dbUpdateSupplier(id,item){
  const { error } = await sb.from('suppliers').update({name:item.name,contact:item.contact,tel:item.tel,email:item.email,cats:item.cats,note:item.note,chatwork_room_id:item.chatworkRoomId||'',order_channels:item.orderChannels||['chat'],closing_day:item.closingDay||0,invoice_reg_no:item.invoiceRegNo||''}).eq('id',id);
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
// あとから足した列（品番＝migration-genba32.sql／寸法＝migration-genba93.sql）が
// まだ無い環境でも保存できるよう、その列で弾かれたら、その列を外して保存し直す
let makerCodeColumnReady = true;
let dimsColumnReady = true;
function stripMakerCode(payload){
  const {maker_code, ...rest} = payload;
  return rest;
}
function stripDims(payload){
  const {base_name, dim1, dim2, dim3, no_dims, ...rest} = payload;
  return rest;
}
// 品目の寸法まわりを、保存する形にする
function masterDimsRow(item){
  // 寸法まわりを何も持っていない品目（分ける前に読み込んだままのもの）は、触らない。
  // 空で上書きして、すでに入っている品目名・寸法を消してしまわないため
  if(!item.baseName && item.dim1==null && item.dim2==null && item.dim3==null && !item.noDims) return {};
  const none = !!item.noDims;
  const n = v => (v==null || v==='' || none) ? null : Number(v);
  return { base_name:item.baseName||'', dim1:n(item.dim1), dim2:n(item.dim2), dim3:n(item.dim3), no_dims:none };
}
// send(payload) を呼び、足りない列で弾かれたらその列を外してやり直す
async function masterSaveWithFallback(payload, send){
  let res = await send(payload);
  for(let i=0; i<2 && res.error; i++){
    const msg = res.error.message||'';
    if(/maker_code/.test(msg)){ makerCodeColumnReady = false; payload = stripMakerCode(payload); }
    else if(/base_name|dim1|dim2|dim3|no_dims/.test(msg)){ dimsColumnReady = false; payload = stripDims(payload); }
    else break;
    res = await send(payload);
  }
  return res;
}
async function dbAddMasterItem(item){
  const supplier_id = supplierIdByName(item.supplier);
  const row = {cat:item.cat,name:item.name,unit:item.unit,price:item.price,cost:item.cost,supplier_id,maker_code:item.makerCode||'',
    shipping:item.shipping||0, shipping_per:item.shippingPer||'order', per_bundle:item.perBundle||0,
    ...masterDimsRow(item)};
  const { data, error } = await masterSaveWithFallback(row,
    r => sb.from('master_items').insert(r).select().single());
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
  master.push({id:data.id,...item,sortOrder:data.sort_order,webPrice:null,webPriceAt:''});
}
async function dbUpdateMasterItem(id,item){
  const supplier_id = supplierIdByName(item.supplier);
  const payload = currentUserRole!=='supplier'
    ? {cat:item.cat,name:item.name,unit:item.unit,price:item.price,cost:item.cost,supplier_id,maker_code:item.makerCode||'',
       shipping:item.shipping||0, shipping_per:item.shippingPer||'order', per_bundle:item.perBundle||0,
       ...masterDimsRow(item)}
    // 発注先は原価とメーカー送料だけ更新できる（品目名・寸法などはDB側のトリガーでも止めている）
    : {price:item.price,cost:item.cost, shipping:item.shipping||0, shipping_per:item.shippingPer||'order',
       per_bundle:item.perBundle||0};
  const { error } = await masterSaveWithFallback(payload,
    r => sb.from('master_items').update(r).eq('id',id));
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
}
async function dbCheckEkreaPrices(){
  const { data, error } = await sb.functions.invoke('ekrea-price', {body:{}});
  if(error){
    // どこで止まっているのか分かるように、原因ごとに書き分ける
    let msg;
    const m = error.message||'';
    if(/Failed to send|NetworkError|Failed to fetch/i.test(m)){
      msg = '価格取得の機能がまだ入っていません。ekrea-price をデプロイしてください';
    }else if(/40[13]/.test(m)){
      msg = '価格取得を実行する権限がありません（管理者アカウントで実行してください）';
    }else{
      msg = '価格の取得に失敗しました：'+m;
    }
    showToast(msg); throw error;
  }
  if(data?.error){
    const msg = /maker_code|web_price/.test(data.error)
      ? 'データベースの準備が必要です。supabase/migration-genba32.sql を実行してください'
      : '価格の取得に失敗しました：'+data.error;
    showToast(msg); throw new Error(data.error);
  }
  return data;
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
    discount_amount:data.discountAmount,tax_rate:data.taxRate,payments:data.payments,
    contract_info:{
      contractDate:data.contractDate||null,contractAmount:data.contractAmount||0,
      extras:data.extras||[],
      completion:data.completion||0,actualProfit:data.actualProfit||0,ordersMemo:data.ordersMemo||'',clientAddress:data.clientAddress||'',tantou:data.tantou||'',clientTel:data.clientTel||'',clientEmail:data.clientEmail||'',mapLat:data.mapLat||null,mapLng:data.mapLng||null
    },
    updated_at:new Date().toISOString()
  };
  // 明細は、手元に持っているものだけ書き戻す。
  // 読み込んでいない見積（案件一覧から金額だけ直したときなど）に空を書くと、
  // データベースの明細が消えてしまうため
  if(estSectionsReady(data)) row.sections = data.sections;

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
// 発注書PDFを作る。
//
// PDFには5MBの日本語フォントを埋め込むため、作る側が立ち上がったばかりだと
// 時間切れで落ちることがある（2026-09-28に5件中3件が作られていなかった）。
// 1回目が落ちたら少し待ってもう一度頼む。2回目はフォントが手元に残っていて速い
async function dbGenerateOrderPdf(order){
  let last = '';
  for(let i=0; i<2; i++){
    if(i) await new Promise(r=>setTimeout(r, 1500));
    const { data, error } = await sb.functions.invoke('generate-order-pdf', { body: order });
    if(data?.url) return data.url;
    last = data?.error || error?.message || '理由不明';
    console.warn(`発注書PDFの生成に失敗（${i+1}回目）：`, last);
  }
  showToast('発注書PDFを作れませんでした：'+last+'（発注そのものは記録されます）', 8000);
  throw new Error(last);
}

// ── 発注確定（発注書・原価・チャット投稿） ──
async function dbConfirmOrder(order){
  const supplier_id = supplierIdByName(order.suppliers);
  const base = {
    no:order.no,project:order.project,date:order.date,due_date:order.dueDate||null,due_asap:!!order.dueAsap,cost_type:order.costType,supplier_id,
    items:order.items,subtotal:order.subtotal,tax:order.tax,total:order.total,status:'pending',
    created_by_name:order.createdByName||'',   // 発注書の「担当者」（migration-genba67.sql）
    created_by:currentUserId||null,            // 経費の発注を本人だけに見せるのに使う（migration-genba77.sql）
    delivery_place:order.deliveryPlace||'',    // 納品場所（migration-genba71.sql）
    delivery_address:order.deliveryAddress||'',
    note:order.note||''                        // 備考（migration-genba73.sql）
  };
  let { data: orderRow, error: orderErr } =
    await sb.from('orders').insert({...base, payment_method:order.paymentMethod||''}).select().single();
  // 支払方法の列（migration-genba24.sql）が未適用でも発注は通す
  if(orderErr && /payment_method/.test(orderErr.message||'')){
    console.warn('payment_method列が未作成のため、支払方法を保存せずに続行します');
    ({ data: orderRow, error: orderErr } = await sb.from('orders').insert(base).select().single());
  }
  // 担当者の列（migration-genba67.sql / genba77.sql）が未適用でも発注は通す
  if(orderErr && /created_by_name|created_by/.test(orderErr.message||'')){
    console.warn('担当者の列が未作成のため、担当者を保存せずに続行します');
    const { created_by_name, created_by, ...noName } = base;
    ({ data: orderRow, error: orderErr } = await sb.from('orders').insert({...noName, payment_method:order.paymentMethod||''}).select().single());
  }
  // 納品場所の列（migration-genba71.sql）が未適用でも発注は通す
  if(orderErr && /delivery_place|delivery_address|'note'|column .*note/.test(orderErr.message||'')){
    console.warn('納品場所・備考の列が未作成のため、その分を除いて保存します');
    const { delivery_place, delivery_address, note, ...noPlace } = base;
    ({ data: orderRow, error: orderErr } = await sb.from('orders').insert({...noPlace, payment_method:order.paymentMethod||''}).select().single());
  }
  if(orderErr){showToast('発注確定に失敗しました：'+orderErr.message);throw orderErr;}

  const costRows = order.items.map(item=>({
    date:order.date,project:order.project,name:item.name,qty:item.qty,unit:item.unit,
    amount:lineBase(item),supplier_id,order_no:order.no,cost_type:order.costType,status:'pending'
  }));
  const { error: costErr } = await sb.from('cost_entries').insert(costRows);
  if(costErr){showToast('原価登録に失敗しました：'+costErr.message);throw costErr;}

  await dbSendOrderToSupplier(order);
  return orderRow;
}
// 納品予定日の列がまだ無いときの案内（migration-genba95.sql）
function orderDeliveryColumnMissing(error){
  return /delivery_on|delivery_dates/.test(error?.message||'') && /column|schema cache|does not exist/i.test(error?.message||'');
}
// delivery … {deliveryOn, deliveryDates}。業者さんが受領のときに入れる納品予定日（品目ごと）。
//            きよかわの社員が日付なしで受領済みにするときは null
async function dbMarkOrderReceived(orderNo, supplierName, delivery){
  const supplier_id = supplierIdByName(supplierName);
  const row = {status:'received'};
  const dates = delivery ? { delivery_on: delivery.deliveryOn||null, delivery_dates: delivery.deliveryDates||[] } : {};
  // 誰がいつ受領したか（列が無い環境でも動くよう、失敗したら status だけで更新し直す）
  let { error } = await sb.from('orders')
    .update({...row, ...dates, received_at:new Date().toISOString(), received_by:currentUserDisplayName||''})
    .eq('no',orderNo).eq('supplier_id',supplier_id);
  // 納品予定日は必須なので、その列が無いときは黙って捨てずに止める
  if(error && delivery && orderDeliveryColumnMissing(error)){
    showToast('データベースの準備が必要です。supabase/migration-genba95.sql を実行してください', 7000);
    throw error;
  }
  if(error && !/納品予定日/.test(error.message||''))
    ({ error } = await sb.from('orders').update({...row, ...dates}).eq('no',orderNo).eq('supplier_id',supplier_id));
  if(error){ showToast('受領の記録に失敗しました：'+error.message, 7000); throw error; }
  await sb.from('cost_entries').update(row).eq('order_no',orderNo).eq('supplier_id',supplier_id);
}
// 受領したあとで、納品予定日だけを変える
async function dbSetOrderDelivery(orderNo, supplierName, delivery){
  const supplier_id = supplierIdByName(supplierName);
  const { error } = await sb.from('orders')
    .update({ delivery_on: delivery.deliveryOn||null, delivery_dates: delivery.deliveryDates||[] })
    .eq('no',orderNo).eq('supplier_id',supplier_id);
  if(error){
    showToast(orderDeliveryColumnMissing(error)
      ? 'データベースの準備が必要です。supabase/migration-genba95.sql を実行してください'
      : '納品予定日を保存できませんでした：'+error.message, 7000);
    throw error;
  }
}

// ── 単価の変更履歴（いつからの単価か。migration-genba40.sql） ──
let itemPriceChanges = [];
let priceHistoryReady = true;

async function fetchItemPriceChanges(){
  const { data, error } = await sb.from('item_price_changes')
    .select('*').order('effective_from',{ascending:false}).order('id',{ascending:false});
  priceHistoryReady = !error;
  itemPriceChanges = (data||[]).map(r=>({id:r.id, itemId:r.item_id, cost:Number(r.cost),
    prevCost:(r.prev_cost==null?null:Number(r.prev_cost)), effectiveFrom:r.effective_from,
    changedBy:r.changed_by||'', createdAt:r.created_at}));
}

// 単価の変更を登録する。適用日が今日以前なら、いまの単価も入れ替える
async function dbSaveItemPrice(item, cost, effectiveFrom){
  const today = localYmd();
  const { error } = await sb.from('item_price_changes').insert({
    item_id:item.id, cost, prev_cost:item.cost, effective_from:effectiveFrom,
    changed_by:currentUserDisplayName||''
  });
  if(error){
    showToast(/item_price_changes/.test(error.message||'')
      ? 'データベースの準備が必要です。supabase/migration-genba40.sql を実行してください'
      : '単価の登録に失敗しました：'+error.message);
    throw error;
  }
  if(effectiveFrom <= today){
    const { error: e2 } = await sb.from('master_items').update({price:cost, cost}).eq('id',item.id);
    if(e2){ showToast('単価の反映に失敗しました：'+e2.message); throw e2; }
  }
  await fetchItemPriceChanges();
}

// ── 請求書（発注先が月ごとに送る。migration-genba38.sql） ──
let invoices = [];
let invoicesReady = true;

async function fetchInvoices(){
  const { data, error } = await sb.from('invoices').select('*').order('month',{ascending:false}).order('id',{ascending:false});
  invoicesReady = !error;
  invoices = (data||[]).map(r=>({id:r.id, supplierId:r.supplier_id, supplierName:r.supplier_name||'', month:r.month||'',
    title:r.title||'', filePath:r.file_path, fileName:r.file_name||'', fileMime:r.file_mime||'',
    amount:(r.amount==null?null:Number(r.amount)), note:r.note||'', uploadedBy:r.uploaded_by||'', createdAt:r.created_at,
    regNo:r.reg_no||'', dueOn:r.due_on||'', paidOn:r.paid_on||'',
    paidAmount:(r.paid_amount==null?null:Number(r.paid_amount)), readByAi:!!r.read_by_ai,
    aiTotal:(r.ai_total==null?null:Number(r.ai_total)), amountByHand:!!r.amount_by_hand}));
}

// 請求書を送る（ファイルを保管して、一覧に1件足す）
async function dbAddInvoice({supplierId, supplierName, month, file, amount, note, regNo, readByAi, dueOn}){
  // 請求月は保管場所の一部にもなるので、形が違うものは受け付けない
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month||''))){
    showToast('請求月が正しくありません'); throw new Error('bad month');
  }
  const ext=(file.name.match(/\.[a-zA-Z0-9]+$/)||[''])[0];
  const [y,m]=month.split('-');
  const title=`${supplierName}_${y}年${m}月`;
  // 保管場所は「発注先ID/請求月/日時.拡張子」。日本語はキーに使えないため
  const path=`${supplierId}/${month}/${Date.now()}${ext}`;
  // 中身が空のファイルは送っても保存できない（保管場所が「No content provided」で断る）
  if(!file.size){
    showToast('このファイルは中身が空です。別のファイルを選んでください');
    throw new Error('empty file');
  }
  const put = () => sb.storage.from('invoices')
    .upload(path, file, { contentType:file.type || 'application/octet-stream' });
  let { error: upErr } = await put();
  if(upErr){
    // ログインの期限切れなら入れ直して1回だけやり直す（チャットの添付と同じ）
    try{ await sb.auth.refreshSession(); }catch(_){}
    ({ error: upErr } = await put());
  }
  if(upErr){
    // 原因を切り分けられるよう、選んだファイルの様子も一緒に出す
    const kind = `${Math.round(file.size/1024)}KB／${file.type||'種類不明'}`;
    showToast(`請求書の保存に失敗しました：${upErr.message}（${kind}）`);
    console.error('請求書の保存に失敗', {path, size:file.size, type:file.type, name:file.name, error:upErr});
    throw upErr;
  }

  const { data, error } = await sb.from('invoices').insert({
    supplier_id:supplierId, supplier_name:supplierName, month, title,
    file_path:path, file_name:file.name||'', file_mime:file.type||'',
    amount:amount||null, note:note||'', uploaded_by:currentUserDisplayName||'',
    reg_no:regNo||'', read_by_ai:!!readByAi, due_on:dueOn||null
  }).select().single();
  if(error){
    await sb.storage.from('invoices').remove([path]);   // 一覧に載らないファイルを残さない
    // 表が無いときだけ準備を促す。それ以外は本当のエラーをそのまま出す
    // （以前は「invoices」の字が入っていれば何でも準備不足と出していて、原因が隠れていた）
    showToast(error.code==='42P01'
      ? 'データベースの準備が必要です。supabase/migration-genba38.sql を実行してください'
      : '請求書の登録に失敗しました：'+error.message);
    throw error;
  }
  return data;
}

// ── 請求書の明細（現場ごとの請求原価。migration-genba58.sql） ──
let invoiceLines = [];
let invoiceLinesReady = true;

async function fetchInvoiceLines(){
  const { data, error } = await sb.from('invoice_lines').select('*')
    .order('invoice_id',{ascending:false}).order('line_no');
  invoiceLinesReady = !error;
  invoiceLines = (data||[]).map(r=>({id:r.id, invoiceId:r.invoice_id, lineNo:r.line_no,
    rawProject:r.raw_project||'', project:r.project||'', workDate:r.work_date||'',
    name:r.name||'', qty:(r.qty==null?null:Number(r.qty)), unit:r.unit||'',
    amount:Number(r.amount)||0, costType:r.cost_type||'材料費', note:r.note||''}));
}

// 読み取った明細を入れ直す（同じ請求書の分は一度消してから入れる）
async function dbReplaceInvoiceLines(invoiceId, lines){
  const { error: delErr } = await sb.from('invoice_lines').delete().eq('invoice_id', invoiceId);
  if(delErr){ showToast('明細の入れ替えに失敗しました：'+delErr.message); throw delErr; }
  if(!lines.length) return;
  const rows = lines.map((l,i)=>({
    invoice_id:invoiceId, line_no:i,
    raw_project:l.rawProject||'', project:l.project||'',
    work_date:l.workDate||null, name:l.name||'',
    qty:(l.qty==null?null:l.qty), unit:l.unit||'',
    amount:Math.round(l.amount)||0, cost_type:l.costType||'材料費', note:l.note||''
  }));
  const { error } = await sb.from('invoice_lines').insert(rows);
  if(error){
    showToast(/invoice_lines/.test(error.message||'') && error.code==='42P01'
      ? 'データベースの準備が必要です。supabase/migration-genba58.sql を実行してください'
      : '明細の保存に失敗しました：'+error.message);
    throw error;
  }
}

// 1行の割り当て先（現場）を変える
async function dbSetInvoiceLineProject(id, project){
  const { error } = await sb.from('invoice_lines').update({ project:project||'' }).eq('id', id);
  if(error){ showToast('割り当ての保存に失敗しました：'+error.message); throw error; }
}

// 支払の記録を書き換える（管理者のみ。DB側のトリガーでも発注先を止めている）
async function dbSetInvoicePayment(id, {dueOn, paidOn, paidAmount}){
  const { error } = await sb.from('invoices')
    .update({ due_on:dueOn||null, paid_on:paidOn||null, paid_amount:(paidAmount??null) })
    .eq('id', id);
  if(error){ showToast('支払の記録に失敗しました：'+error.message); throw error; }
}

// 請求書のPDF・写真をAIに読ませて、請求額などを取り出す。
// supplierId を渡すと、その発注先について覚えた「読み取りのコツ」も一緒に使う
async function dbReadInvoice(filePath, supplierId){
  return invokeReadInvoice({ filePath, supplierId: supplierId||null });
}

// 人が入れた正しい金額から「次に使える手がかり」を1文つくらせる
async function dbLearnInvoiceRead(filePath, supplierId, rightTotal, aiTotal){
  const r = await invokeReadInvoice({ filePath, supplierId: supplierId||null,
    learnTotal: rightTotal, aiTotal: (aiTotal==null?null:aiTotal) });
  return String(r?.hint||'').trim();
}

// 人が直した明細（足した行・消した行・品名や金額を変えた行）から1文つくらせる
async function dbLearnInvoiceLines(filePath, supplierId, fix){
  const r = await invokeReadInvoice({ filePath, supplierId: supplierId||null, learnLines: fix });
  return String(r?.hint||'').trim();
}

async function invokeReadInvoice(body){
  const { data, error } = await sb.functions.invoke('read-invoice', { body });
  if(error || data?.error){
    let msg = data?.error;
    if(!msg && error?.context && typeof error.context.json==='function'){
      try{ const j = await error.context.json(); msg = j?.error; }catch(_){}
    }
    throw new Error(msg || error?.message || '読み取りに失敗しました');
  }
  return data;
}

// ── 請求書の読み取りのコツ（発注先ごと。migration-genba63.sql） ──
let invoiceHints = [];
async function fetchInvoiceHints(){
  const { data, error } = await sb.from('invoice_read_hints').select('*')
    .order('created_at',{ascending:false});
  if(error){ invoiceHints=[]; return; }
  invoiceHints = (data||[]).map(r=>({id:r.id, supplierId:r.supplier_id, hint:r.hint||'',
    kind:r.kind||'total',
    aiTotal:(r.ai_total==null?null:Number(r.ai_total)),
    rightTotal:(r.right_total==null?null:Number(r.right_total)),
    sourceMonth:r.source_month||'', createdBy:r.created_by||'', createdAt:r.created_at}));
}
async function dbAddInvoiceHint({supplierId, hint, kind, aiTotal, rightTotal, sourceMonth}){
  const { error } = await sb.from('invoice_read_hints').insert({
    supplier_id:supplierId, hint, kind:kind||'total',
    ai_total:(aiTotal??null), right_total:(rightTotal??null),
    source_month:sourceMonth||'', created_by:currentUserDisplayName||''});
  if(error){
    showToast(error.code==='42P01' || /kind/.test(error.message||'')
      ? 'データベースの準備が必要です。supabase/migration-genba63.sql と 64 を実行してください'
      : '読み取りのコツを覚えられませんでした：'+error.message);
    throw error;
  }
}
async function dbDeleteInvoiceHint(id){
  const { error } = await sb.from('invoice_read_hints').delete().eq('id', id);
  if(error){ showToast('削除に失敗しました：'+error.message); throw error; }
}

// 請求額を書き換える（手入力・AIの読み取り、どちらからも通る）
async function dbSetInvoiceAmount(id, {amount, regNo, dueOn, aiTotal, byHand, readByAi}){
  const patch = { amount:(amount??null) };
  if(regNo   !== undefined) patch.reg_no  = regNo||'';
  if(dueOn   !== undefined) patch.due_on  = dueOn||null;
  if(aiTotal !== undefined) patch.ai_total = (aiTotal??null);
  if(byHand  !== undefined) patch.amount_by_hand = !!byHand;
  if(readByAi!== undefined) patch.read_by_ai = !!readByAi;
  const { error } = await sb.from('invoices').update(patch).eq('id', id);
  if(error){
    showToast(/ai_total|amount_by_hand/.test(error.message||'')
      ? 'データベースの準備が必要です。supabase/migration-genba63.sql を実行してください'
      : '請求額の保存に失敗しました：'+error.message);
    throw error;
  }
}

// 請求書を開く（1時間だけ有効なリンクを作る）
async function dbInvoiceUrl(filePath){
  const { data, error } = await sb.storage.from('invoices').createSignedUrl(filePath, 3600);
  if(error){ showToast('請求書を開けませんでした：'+error.message); throw error; }
  return data.signedUrl;
}

async function dbDeleteInvoice(inv){
  const { error } = await sb.from('invoices').delete().eq('id',inv.id);
  if(error){ showToast('削除に失敗しました：'+error.message); throw error; }
  await sb.storage.from('invoices').remove([inv.filePath]);
}

// メッセージへのリアクション（スタンプ）をトグル。自分の名前を付ける／外す
async function dbToggleReaction(msgId, reaction){
  let msg=null;
  for(const k in talkThreads){ const f=(talkThreads[k]||[]).find(m=>m.id===msgId); if(f){msg=f;break;} }
  if(!msg) return;
  const reactions = {...(msg.reactions||{})};
  const arr = Array.isArray(reactions[reaction]) ? [...reactions[reaction]] : [];
  const me = currentUserDisplayName||'';
  const i = arr.indexOf(me);
  if(i>=0) arr.splice(i,1); else arr.push(me);
  if(arr.length) reactions[reaction]=arr; else delete reactions[reaction];
  const { error } = await sb.from('chat_messages').update({reactions}).eq('id',msgId);
  if(error){showToast('リアクションに失敗しました：'+error.message);return;}
  msg.reactions=reactions;
  renderTalkPanelMessages();
}

// メッセージ本文の編集（自分のテキストのみ想定）
async function dbEditChatMessage(msgId, newText){
  const now=new Date().toISOString();
  const { error } = await sb.from('chat_messages').update({text:newText, edited_at:now}).eq('id',msgId);
  if(error){showToast('編集に失敗しました：'+error.message);throw error;}
  for(const k in talkThreads){ const m=(talkThreads[k]||[]).find(x=>x.id===msgId); if(m){m.text=newText;m.editedAt=now;break;} }
}
// ブックマークのトグル（自分の名前を付ける／外す）
async function dbToggleBookmark(msgId){
  let msg=null;
  for(const k in talkThreads){ const f=(talkThreads[k]||[]).find(m=>m.id===msgId); if(f){msg=f;break;} }
  if(!msg) return;
  const arr=Array.isArray(msg.bookmarks)?[...msg.bookmarks]:[];
  const me=currentUserDisplayName||'';
  const i=arr.indexOf(me);
  if(i>=0) arr.splice(i,1); else arr.push(me);
  const { error } = await sb.from('chat_messages').update({bookmarks:arr}).eq('id',msgId);
  if(error){showToast('保存に失敗しました：'+error.message);return;}
  msg.bookmarks=arr;
}
// 開いているスレッドを既読にする。
// すでに最新のメッセージまで読んでいるなら書かない。
// 毎回書くと chat_reads のリアルタイム通知が飛んで、再取得・描き直しが繰り返される。
function markThreadReadIfNeeded(supplier){
  const thread = threadKeyOf(supplier);
  const msgs = talkThreads[supplier] || [];
  const newest = msgs.reduce((t,m)=>Math.max(t, m.ts||0), 0);
  const mine = (chatReads||[]).find(r=>r.userId===currentUserId && r.thread===thread);
  if(newest && mine && mine.lastReadAt >= newest) return Promise.resolve();
  return dbMarkThreadRead(thread).then(updateChatBadge).catch(()=>{});
}

// スレッドを開いた時刻を既読として記録
async function dbMarkThreadRead(thread){
  const nowMs=Date.now();
  const { error } = await sb.from('chat_reads').upsert({
    user_id:currentUserId, user_name:currentUserDisplayName||'', thread, last_read_at:new Date(nowMs).toISOString()
  }, { onConflict:'user_id,thread' });
  if(error){ console.warn('既読記録に失敗', error.message); return; }
  const ex=chatReads.find(r=>r.userId===currentUserId && r.thread===thread);
  if(ex) ex.lastReadAt=nowMs; else chatReads.push({userId:currentUserId,userName:currentUserDisplayName||'',thread,lastReadAt:nowMs});
}

// ── チャット ──
async function dbAddChatMessage(supplierName, msg){
  const isClient = isClientThread(supplierName);
  const client_project_id = isClient ? (clientThreadIds[supplierName]||null) : null;
  if(isClient && !client_project_id) return;
  const isGroup = !isClient && isGroupThread(supplierName);
  const group_id = isGroup ? (groupThreadIds[supplierName]||null) : null;
  if(isGroup && !group_id) return;
  const isDirect = !isClient && !isGroup && isDirectThread(supplierName);
  const otherId = isDirect ? (directThreadIds[supplierName]||null) : null;
  if(isDirect && !otherId) return;
  const [direct_a, direct_b] = isDirect ? directPair(otherId) : [null, null];
  const isProject = !isClient && !isGroup && !isDirect && isProjectThread(supplierName);
  const project_id = isProject ? (projectThreadIds[supplierName]||null) : null;
  const isInternal = supplierName===INTERNAL_THREAD;
  const supplier_id = (isInternal||isProject||isDirect||isGroup||isClient) ? null : supplierIdByName(supplierName);
  if(!isInternal && !isProject && !isDirect && !isGroup && !isClient && !supplier_id) return;
  const { data, error } = await sb.from('chat_messages').insert({
    supplier_id, project_id, direct_a, direct_b, group_id, client_project_id,
    is_internal:isInternal, role:msg.role, type:msg.type||'text', text:msg.text||null, order_data:msg.orderData||null,
    file_url:msg.fileUrl||null, file_name:msg.fileName||null, file_mime:msg.fileMime||null, unread:false,
    sender_name: currentUserDisplayName||'',
    reply_to_id:msg.replyToId||null, reply_to_text:msg.replyToText||null, reply_to_sender:msg.replyToSender||null
  }).select().single();
  if(error){
    const e = new Error(error.message); e.friendly = true;
    showToast('送信に失敗しました：'+error.message);
    throw e;
  }
  if(!talkThreads[supplierName]) talkThreads[supplierName]=[];
  talkThreads[supplierName].push({id:data.id,role:data.role,type:data.type,text:data.text,orderData:data.order_data,fileUrl:data.file_url,fileName:data.file_name,fileMime:data.file_mime,ts:new Date(data.created_at).getTime(),unread:false,senderName:data.sender_name||'',reactions:{},replyToText:data.reply_to_text||'',replyToSender:data.reply_to_sender||'',editedAt:null,bookmarks:[]});

  // 通知の送信。失敗してもチャット送信自体は成立させる（msg.silent=trueなら通知しない：自動転記用）
  if(msg.silent) return;
  const preview = msg.type==='order' ? `📋 発注書 ${msg.orderData?.no||''}`
    : msg.type==='quote' ? `📝 見積依頼 ${msg.orderData?.no||''}`
    : msg.type==='file' ? `📎 ${msg.fileName||'ファイル'}` : (msg.text||'');
  // 宛先が指定されていれば、どのスレッドでもその人にだけ通知する（自分は除く）
  const picked = Array.isArray(msg.notifyNames)
    ? msg.notifyNames.filter(n=>n && n!==currentUserDisplayName) : [];

  // 通知をタップしたときの行き先。スレッド名ではなく番号で持つ（js/talk.js の threadNameOfKey）。
  // 個別チャットだけは、受け取った人から見た相手＝送った自分になる
  const goTalk = isClient   ? 'talk:client:'+client_project_id
               : isGroup    ? 'talk:group:'+group_id
               : isDirect   ? 'talk:direct:'+currentUserId
               : isProject  ? 'talk:project:'+project_id
               : isInternal ? 'talk:internal'
               : supplier_id ? 'talk:supplier:'+supplier_id : 'talk';

  if(isClient){
    const proj = (projects||[]).find(p=>p.id===client_project_id);
    const chat = clientChatOf(client_project_id);
    const label = chat?.projectName || proj?.name || 'お客様チャット';
    if(isClientUser()){
      // お客様 → きよかわの担当者へ
      const names = (chat?.memberNames||[]).filter(Boolean);
      if(names.length) dbSendPushToNames(names, `${label}（お客様）`, preview, goTalk).catch(()=>{});
    } else {
      // きよかわ → その案件のお客様（ご主人・奥様など、ご登録済みの方みなさん）へ
      const ids = (proj?.clients||[]).map(c=>c.userId).filter(Boolean);
      if(!ids.length && proj?.clientUserId) ids.push(proj.clientUserId);
      ids.forEach(uid=>dbSendPushToUser(uid, 'きよかわ より', preview, goTalk).catch(()=>{}));
    }
  } else if(isGroup){
    const g = groupById(group_id);
    const names = picked.length ? picked
      : (g?.memberNames||[]).filter(n=>n && n!==currentUserDisplayName);
    if(names.length) dbSendPushToNames(names, `${g?.name||'グループ'} ${currentUserDisplayName||''}`, preview, goTalk).catch(()=>{});
  } else if(isDirect){
    // 個別チャット：相手ひとりに知らせる
    const other=(allProfiles||[]).find(p=>p.id===otherId);
    if(other?.displayName){
      dbSendPushToNames([other.displayName], `個別 ${currentUserDisplayName||''}`, preview, goTalk).catch(()=>{});
    }
  } else if(isProject){
    // 案件チャット：指定があればその人、無ければ参加メンバー（自分以外）へ
    const proj = projects.find(p=>p.id===project_id);
    const names = picked.length ? picked : otherMemberNames(proj?.members);
    if(names.length) dbSendPushToNames(names, `${supplierName} ${currentUserDisplayName||''}`, preview, goTalk).catch(()=>{});
  } else if(isInternal){
    const title = `${INTERNAL_THREAD} ${currentUserDisplayName||''}`;
    if(picked.length){
      dbSendPushToNames(picked, title, preview, goTalk).catch(()=>{});
    } else {
      // 既定：自分以外の社員全員（staff＋carpenter）へ
      dbSendPush('employee', null, title, preview, currentUserId, goTalk).catch(()=>{});
    }
  } else if(msg.role==='me'){
    // きよかわ→発注先。宛先を選んでいればその人だけ（発注先の担当者でも社員でも指名できる）
    if(picked.length) dbSendPushToNamesNow(picked, supplierName, preview, goTalk).catch(()=>{});
    else dbSendPush('supplier', supplier_id, supplierName, preview, null, goTalk).catch(()=>{});
    // ChatWorkルームが設定されていれば転送。宛先の指定にかかわらず送る。
    // 写真・資料はファイルそのものを添える。発注書は dbSendOrderToSupplier が
    // PDFを添えて送るため、ここでは送らない（noChatwork）
    if(!msg.noChatwork){
      const cwFile = msg.type==='file'
        ? {fileUrl:msg.fileUrl, fileName:msg.fileName, fileMime:msg.fileMime} : null;
      dbForwardToChatWork(supplier_id, currentUserDisplayName||'', preview, cwFile).catch(()=>{});
    }
  } else {
    // 発注先→きよかわ。宛先を選んでいればその人だけ、
    // 指定なし（ALL）なら社員全員（管理者＋一般社員）へ。発注先チャットは大工も見られるため
    if(picked.length) dbSendPushToNamesNow(picked, supplierName, preview, goTalk).catch(()=>{});
    else dbSendPush('employee', null, supplierName, preview, currentUserId, goTalk).catch(()=>{});
  }
}

// ════ グループチャットの作成・変更 ════
//
// メンバーは userId で持ち、表示名の控えも一緒に入れる（発注先の人は社員以外の名簿を引けないため）。
// 自分は必ずメンバーに入れる。
function _groupMemberRows(memberIds){
  const ids = [...new Set([currentUserId, ...(memberIds||[])].filter(Boolean))];
  const nameOf = id => id===currentUserId ? (currentUserDisplayName||'') : ((allProfiles||[]).find(p=>p.id===id)?.displayName || '');
  return { member_ids: ids, member_names: ids.map(nameOf) };
}
async function dbCreateChatGroup(name, memberIds){
  const row = { name: String(name||'').trim(), created_by: currentUserId, ..._groupMemberRows(memberIds) };
  const { data, error } = await sb.from('chat_groups').insert(row).select().single();
  if(error){ showToast('グループを作れませんでした：'+error.message); throw error; }
  const g = {id:data.id, name:data.name, memberIds:data.member_ids||[], memberNames:data.member_names||[], createdBy:data.created_by};
  chatGroups.push(g);
  return g;
}
async function dbUpdateChatGroup(id, name, memberIds){
  const row = { name: String(name||'').trim(), updated_at: new Date().toISOString(), ..._groupMemberRows(memberIds) };
  const { error } = await sb.from('chat_groups').update(row).eq('id', id);
  if(error){ showToast('グループを保存できませんでした：'+error.message); throw error; }
  const g = groupById(id);
  if(g){ g.name=row.name; g.memberIds=row.member_ids; g.memberNames=row.member_names; }
}
// 自分だけ抜ける。抜けたあとは自分から見えなくなるので、専用の手続きを使う（migration-genba68.sql）
async function dbLeaveChatGroup(id){
  const { error } = await sb.rpc('leave_chat_group', { p_group_id: id });
  if(error){ showToast('退出できませんでした：'+error.message); throw error; }
  chatGroups = chatGroups.filter(g=>g.id!==id);
}
// 作った人だけ消せる。中のメッセージも消える
async function dbDeleteChatGroup(id){
  const { error } = await sb.from('chat_groups').delete().eq('id', id);
  if(error){ showToast('削除できませんでした：'+error.message); throw error; }
  chatGroups = chatGroups.filter(g=>g.id!==id);
}

// ════ お客様のチャット案内（アカウントを作ってご案内メールを送る） ════
//
// 案件情報の「チャット案内」から呼ぶ。作られるのは「チャットだけ」のお客様アカウント。
// displayName は、そのお客様のお名前。チャットの発言者名になる（ご主人・奥様の見分けに使う）
// password を渡すと、ご案内メールを送らずにその場で使える状態にする
// （タブレットをお渡しして、お客様ご自身に決めていただいたとき）
async function dbInviteClient(projectId, email, displayName, password){
  const body = { projectId, email, displayName: displayName||'',
                 redirectTo: location.origin + location.pathname };
  if(password) body.password = password;
  const { data, error } = await sb.functions.invoke('invite-client', { body });
  let detail = '';
  if(error){ try{ detail = (await error.context?.json?.())?.error || ''; }catch(_){} }
  const msg = data?.error || detail || (error ? error.message : '');
  if(msg){ showToast('ご案内メールを送れませんでした：'+msg, 6000); throw new Error(msg); }
  return data;
}

// ════ 見積依頼（migration-genba78.sql） ════
//
// 発注の前に、発注先へ見積をお願いした記録。発注書と同じようにPDFを作って送る。
let quoteRequests = [];
let quoteRequestsReady = true;

function quoteRowTo(r){
  return { id:r.id, no:r.no, project:r.project||'', supplierId:r.supplier_id,
    supplierName:r.supplier_name||supplierNameById(r.supplier_id), replyBy:r.reply_by||'',
    note:r.note||'', items:r.items||[], status:r.status||'sent', pdfUrl:r.pdf_url||'',
    answeredAt:r.answered_at||null, createdByName:r.created_by_name||'', createdAt:r.created_at };
}
async function fetchQuoteRequests(){
  const { data, error } = await sb.from('quote_requests').select('*').order('created_at',{ascending:false});
  quoteRequestsReady = !error;
  if(error){ quoteRequests = []; throw error; }
  quoteRequests = (data||[]).map(quoteRowTo);
}

async function dbGenerateQuotePdf(q){
  let last = '';
  for(let i=0;i<2;i++){
    if(i) await new Promise(r=>setTimeout(r, 1500));
    const { data, error } = await sb.functions.invoke('generate-quote-pdf', { body: q });
    if(data?.url) return data.url;
    last = data?.error || error?.message || '理由不明';
    console.warn(`見積依頼書PDFの生成に失敗（${i+1}回目）：`, last);
  }
  showToast('見積依頼書PDFを作れませんでした：'+last+'（依頼そのものは記録されます）', 8000);
  throw new Error(last);
}

// 見積依頼を記録して、発注先へ送る（チャット・ChatWork・メールは発注先の設定どおり）
async function dbSendQuoteRequest(q){
  const supplier_id = supplierIdByName(q.supplierName);
  const row = {
    no:q.no, project:q.project||'', supplier_id, supplier_name:q.supplierName||'',
    reply_by:q.replyBy||null, note:q.note||'', items:q.items||[], status:'sent',
    pdf_url:q.pdfUrl||'', created_by:currentUserId||null, created_by_name:q.createdByName||'',
  };
  const { data, error } = await sb.from('quote_requests').insert(row).select().single();
  if(error){
    showToast(error.code==='42P01'
      ? 'データベースの準備が必要です。supabase/migration-genba78.sql を実行してください'
      : '見積依頼の記録に失敗しました：'+error.message, 6000);
    throw error;
  }
  const saved = quoteRowTo(data);
  quoteRequests.unshift(saved);

  // 発注先へ届ける（送付先の設定は発注と同じものを使う）
  const sup = (suppliers||[]).find(s=>s.id===supplier_id);
  const ch = orderChannelsOf(sup);
  const staffName = q.createdByName || currentUserDisplayName || '';
  const lines = (q.items||[]).map(i=>`・${i.name}${i.spec?`（${i.spec}）`:''} ${i.qty}${i.unit}`).join('\n');
  const text = `【見積依頼】${q.no}\n件名：${q.project}\n`
    + (q.replyBy ? `見積回答希望日：${q.replyBy}\n` : '')
    + `\n${lines}\n`
    + (q.note ? `\n備考：${q.note}\n` : '')
    + `\nお見積りをお願いいたします。（この書類は発注ではありません）`
    + (staffName ? `\n担当者：${staffName}` : '');

  if(ch.includes('chat')){
    // 中身は order_data の列に入れる（type で発注書と見分ける）
    await dbAddChatMessage(q.supplierName, { role:'me', type:'quote', orderData:{...q, pdfUrl:q.pdfUrl}, noChatwork:true });
  }
  if(ch.includes('chatwork')){
    dbForwardToChatWork(supplier_id, staffName, text,
      q.pdfUrl ? {fileUrl:q.pdfUrl, fileName:`見積依頼書_${q.no}.pdf`, fileNameAscii:`rfq_${q.no}.pdf`, fileMime:'application/pdf'} : null
    ).catch(()=>{});
  }
  if(ch.includes('email')){
    await dbMailQuoteToSupplier(q, sup);
  }
  return saved;
}

async function dbMailQuoteToSupplier(q, sup){
  if(!sup?.email){ showToast(`${q.supplierName}にメールアドレスが登録されていません`, 4000); return; }
  showToast(`${sup.name}へメールを送っています…`, 20000);
  const { data, error } = await sb.functions.invoke('send-order-mail', { body:{ quote:q, pdfUrl:q.pdfUrl } });
  if(error || data?.error){
    let detail = '';
    if(error){ try{ detail = (await error.context?.json?.())?.error || ''; }catch(_){} }
    showToast('メールを送れませんでした：'+(data?.error || detail || error?.message || ''), 8000);
    return;
  }
  showToast(`${sup.name}へ見積依頼書をメールしました`);
}

// 見積の回答（品目ごとの単価）を記録する
async function dbSaveQuoteAnswer(id, items){
  const { error } = await sb.from('quote_requests')
    .update({ items, status:'answered', answered_at:new Date().toISOString() }).eq('id',id);
  if(error){ showToast('回答の保存に失敗しました：'+error.message); throw error; }
  const q = quoteRequests.find(x=>x.id===id);
  if(q){ q.items = items; q.status = 'answered'; q.answeredAt = new Date().toISOString(); }
}

// 回答があった／終わったことを記録する
async function dbSetQuoteStatus(id, status){
  const patch = { status };
  if(status==='answered') patch.answered_at = new Date().toISOString();
  const { error } = await sb.from('quote_requests').update(patch).eq('id',id);
  if(error){ showToast('保存に失敗しました：'+error.message); throw error; }
  const q = quoteRequests.find(x=>x.id===id);
  if(q){ q.status = status; if(patch.answered_at) q.answeredAt = patch.answered_at; }
}
async function dbDeleteQuoteRequest(id){
  const { error } = await sb.from('quote_requests').delete().eq('id',id);
  if(error){ showToast('削除に失敗しました：'+error.message); throw error; }
  quoteRequests = quoteRequests.filter(q=>q.id!==id);
}

// ════ レシート台帳（migration-genba76.sql） ════
let receiptLedger = [];
let receiptsReady = true;

//
// 整えたレシートの画像と、読み取った内容を残す。あとから支出の元をたどれるように。
function receiptRowTo(r){
  return { id:r.id, orderNo:r.order_no||'', paidOn:r.paid_on||'', shop:r.shop||'',
    project:r.project||'', costType:r.cost_type||'', paymentMethod:r.payment_method||'',
    subtotal:Number(r.subtotal)||0, tax:Number(r.tax)||0, total:Number(r.total)||0,
    taxRows:r.tax_rows||[], items:r.items||[], filePath:r.file_path||'',
    note:r.note||'', createdByName:r.created_by_name||'', createdAt:r.created_at };
}
async function fetchReceipts(){
  const { data, error } = await sb.from('receipts').select('*')
    .order('paid_on',{ascending:false}).order('id',{ascending:false});
  receiptsReady = !error;
  if(error){ receiptLedger = []; throw error; }
  receiptLedger = (data||[]).map(receiptRowTo);
}

// 台帳に1件残す。画像は非公開の置き場所に入れ、見るときだけ期限付きのリンクを作る
async function dbSaveReceipt(rec, imageBase64){
  let filePath = '';
  if(imageBase64){
    // 置き場所は「年月/日付_発注番号.jpg」。日本語は使えないので使わない
    const ym = String(rec.paidOn||'').slice(0,7).replace('-','') || 'unknown';
    filePath = `${ym}/${(rec.paidOn||'').replace(/-/g,'')}_${rec.orderNo||Date.now()}.jpg`;
    const bin = Uint8Array.from(atob(imageBase64), c=>c.charCodeAt(0));
    const { error: upErr } = await sb.storage.from('receipts')
      .upload(filePath, bin, { contentType:'image/jpeg', upsert:true });
    if(upErr){ console.warn('レシート画像を置けませんでした', upErr.message); filePath = ''; }
  }
  const row = {
    order_no:rec.orderNo||'', paid_on:rec.paidOn||localYmd(new Date()), shop:rec.shop||'',
    project:rec.project||'', cost_type:rec.costType||'', payment_method:rec.paymentMethod||'',
    subtotal:rec.subtotal||0, tax:rec.tax||0, total:rec.total||0,
    tax_rows:rec.taxRows||[], items:rec.items||[], file_path:filePath, note:rec.note||'',
    created_by:currentUserId||null, created_by_name:currentUserDisplayName||'',
  };
  const { data, error } = await sb.from('receipts').insert(row).select().single();
  if(error){
    console.warn('レシート台帳に残せませんでした', error.message);
    showToast(error.code==='42P01'
      ? 'レシート台帳の準備が必要です。supabase/migration-genba76.sql を実行してください'
      : 'レシート台帳に残せませんでした：'+error.message, 6000);
    return null;
  }
  const saved = receiptRowTo(data);
  receiptLedger.unshift(saved);
  return saved;
}
// 画像を見るためのリンク（1時間だけ有効）
async function dbReceiptUrl(filePath){
  const { data, error } = await sb.storage.from('receipts').createSignedUrl(filePath, 3600);
  if(error){ showToast('レシート画像を開けませんでした：'+error.message); throw error; }
  return data.signedUrl;
}
async function dbDeleteReceipt(rec){
  if(rec.filePath){ try{ await sb.storage.from('receipts').remove([rec.filePath]); }catch(_){} }
  const { error } = await sb.from('receipts').delete().eq('id',rec.id);
  if(error){ showToast('削除に失敗しました：'+error.message); throw error; }
  receiptLedger = receiptLedger.filter(r=>r.id!==rec.id);
}

// ── 案件ごとのお客様（ご主人・奥様など何人でも。migration-genba70.sql） ──
function projectClientRowTo(r){
  return { id:r.id, name:r.name||'', email:r.email||'', userId:r.user_id||null, invitedAt:r.invited_at||'' };
}
// 1案件ぶん読み直す
async function dbFetchProjectClients(projectId){
  const { data, error } = await sb.from('project_clients').select('*').eq('project_id',projectId).order('id');
  if(error){ console.warn('お客様の読み込みに失敗：',error.message); return []; }
  return (data||[]).map(projectClientRowTo);
}
// 読んできた全案件ぶんの行を projects[].clients に載せる（表が無くても落とさない）
function applyProjectClients(res){
  if(!res || res.error){
    if(res?.error) console.warn('お客様の読み込みに失敗：', res.error.message);
    projects.forEach(p=>{ if(!p.clients) p.clients = []; });
    return;
  }
  const byProject = new Map();
  (res.data||[]).forEach(r=>{
    if(!byProject.has(r.project_id)) byProject.set(r.project_id, []);
    byProject.get(r.project_id).push(projectClientRowTo(r));
  });
  projects.forEach(p=>{ p.clients = byProject.get(p.id) || []; });
}
// 1回だけ読み直したいとき（案件情報の画面から）
async function fetchProjectClients(){
  applyProjectClients(await sb.from('project_clients').select('*').order('id'));
}
// 画面の行をそのまま保存する。消された行は呼ぶ側（removeClientRow）で消している
async function dbSaveProjectClients(projectId, rows){
  const clean = (rows||[])
    .map(r=>({ ...r, name:String(r.name||'').trim(), email:String(r.email||'').trim() }))
    .filter(r=>r.email);
  for(const r of clean){
    if(r.id){
      const { error } = await sb.from('project_clients').update({name:r.name, email:r.email}).eq('id',r.id);
      if(error){ showToast('お客様の保存に失敗しました：'+error.message); throw error; }
    } else {
      const { data, error } = await sb.from('project_clients')
        .insert({project_id:projectId, name:r.name, email:r.email}).select().single();
      if(error){ showToast('お客様の保存に失敗しました：'+error.message); throw error; }
      r.id = data.id;
    }
  }
  const list = await dbFetchProjectClients(projectId);
  const i = projects.findIndex(p=>p.id===projectId);
  if(i>=0) projects[i].clients = list;
  return list;
}
async function dbDeleteProjectClient(id){
  const { error } = await sb.from('project_clients').delete().eq('id',id);
  if(error){ showToast('削除に失敗しました：'+error.message); throw error; }
}

// 発注先チャットのきよかわ側発言をChatWorkへ転送（発注先にルームID設定がある場合のみ）。
// file を渡すと、そのファイルをChatWorkに添えて送る（5MBを超えるものはリンクになる）
async function dbForwardToChatWork(supplierId, senderName, text, file){
  if(!supplierId || (!text && !file?.fileUrl)) return;
  const sup = suppliers.find(s=>s.id===supplierId);
  if(!sup || !sup.chatworkRoomId) return; // ルーム未設定なら送らない（無駄打ち防止）
  if(!orderChannelsOf(sup).includes('chatwork')) return;   // 送付先に選ばれていない
  const { data, error } = await sb.functions.invoke('chatwork-forward', { body:{ supplierId, senderName, text, ...(file||{}) } });
  // ファイルを添えたつもりが添わずリンクになった場合は、その理由を画面に出す。
  // 出さないと「送ったつもり」のまま気づけない（ChatWork側にはリンクだけが届く）
  if(file?.fileUrl){
    if(error || data?.error){
      showToast(`ChatWorkへ送れませんでした：${data?.error || error?.message || ''}`, 8000);
    } else if(data && data.attached===false){
      showToast(`ChatWorkにはリンクで届きました${data.note ? '：'+data.note : ''}`, 8000);
    }
  }
  return data;
}

// チャット添付ファイル（写真・PDF等）をSupabase Storageにアップロードし、公開URLを返す
// fileName・mime を渡せる（写真は送る前にJPEGへ変換するため、元の名前と違うことがある）
async function dbUploadChatFile(file, fileName, mime){
  if(file.size > 40*1024*1024){
    const e = new Error('ファイルが大きすぎます（40MBまで）'); e.friendly = true;
    showToast(e.message); throw e;
  }
  // 保存先のキーには日本語等が使えないため、拡張子だけ残して安全な名前に変換する
  // （元のファイル名はfile_nameに別途保存し、表示時に使う）
  const name = fileName || file.name || '';
  const extMatch = name.match(/\.[a-zA-Z0-9]+$/);
  const ext = extMatch ? extMatch[0] : '';
  const type = mime || file.type || 'application/octet-stream';
  // 同じ名前にならないよう、やり直しのたびに別のキーにする
  const put = () => {
    const path = `${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`;
    return sb.storage.from('chat-files').upload(path, file, { contentType: type })
      .then(r => ({ ...r, path }));
  };
  let res = await put();
  if(res.error){   // ログインの期限切れなら入れ直して1回だけやり直す
    try{ await sb.auth.refreshSession(); }catch(_){}
    res = await put();
  }
  if(res.error){
    const e = new Error(uploadErrorMessage(res.error)); e.friendly = true;
    showToast('ファイルのアップロードに失敗しました：'+e.message);
    throw e;
  }
  const { data } = sb.storage.from('chat-files').getPublicUrl(res.path);
  return data.publicUrl;
}

// ── 勤務カレンダー（休日）＋社員区分 ──
async function fetchWorkCalendar(){
  const { data: rows } = await sb.from('work_holidays').select('*');
  workHolidays = {regular:new Set(), trainee:new Set()};
  (rows||[]).forEach(r=>{ (workHolidays[r.cal]||(workHolidays[r.cal]=new Set())).add(r.holiday_date); });
}

// 社員一覧（区分の割り当て・チャットの通知先選択に使う）。社員なら誰でも取得
async function fetchProfiles(){
  // 発注先の人は、名前と区分だけの名簿を読む（チャットの通知先を指名するために使う）。
  // 見えるのは きよかわの社員と、自分と同じ発注先の担当者だけ（migration-genba54.sql）
  if(currentUserRole==='supplier'){
    const { data: dir, error } = await sb.from('chat_directory').select('id, display_name, role, supplier_id');
    if(error){ console.warn('名簿の取得に失敗しました', error); allProfiles = []; return; }
    allProfiles = (dir||[]).map(p=>({id:p.id, displayName:p.display_name||'', role:p.role,
      workGroup:'', supplierId:p.supplier_id||null, hireDate:'', leaveAdjust:0, leaveAdjustNote:''}));
    return;
  }
  // 有給の列（migration-genba20.sql）が未適用でも動くよう、失敗したら従来の列だけで取得する。
  // 一般社員は名簿（employee_directory）も要るので、一緒に頼んで待ち時間を1回ぶんにする
  const BASE = 'id, display_name, role, work_group, supplier_id';
  const [profRes, dirRes] = await Promise.all([
    sb.from('profiles').select(BASE+', hire_date, leave_adjust, leave_adjust_note').order('display_name'),
    currentUserRole!=='staff'
      ? sb.from('employee_directory').select('id, display_name, role, work_group')
      : Promise.resolve({data:null}),
  ]);
  let profs = profRes.data;
  if(profRes.error){
    leaveColumnsReady = false;
    ({ data: profs } = await sb.from('profiles').select(BASE).order('display_name'));
  } else {
    leaveColumnsReady = true;
  }
  allProfiles = (profs||[]).map(p=>({id:p.id,displayName:p.display_name||'',role:p.role,workGroup:p.work_group||'',supplierId:p.supplier_id||null,
    hireDate:p.hire_date||'', leaveAdjust:Number(p.leave_adjust)||0, leaveAdjustNote:p.leave_adjust_note||''}));
  // 一般社員は自分の行しか取れないので、出面表の休日判定用に名前と区分だけ足す
  // （有給の設定は含まれない名簿。migration-genba31.sql）
  if(currentUserRole!=='staff'){
    // 区分（role）の列はmigration-genba34.sqlで足したもの。無くても動くようにしておく
    let dir = dirRes.data;
    if(!dir) ({ data: dir } = await sb.from('employee_directory').select('id, display_name, work_group'));
    (dir||[]).forEach(p=>{
      if(allProfiles.some(x=>x.id===p.id)) return;
      allProfiles.push({id:p.id, displayName:p.display_name||'', role:p.role||'carpenter', workGroup:p.work_group||'',
        supplierId:null, hireDate:'', leaveAdjust:0, leaveAdjustNote:''});
    });
  }
}

// 有給の設定（雇用契約開始日・調整日数）を保存（管理者のみ）
async function dbSetLeaveSettings(userId, hireDate, adjust, note){
  const { error } = await sb.from('profiles')
    .update({hire_date:hireDate||null, leave_adjust:adjust||0, leave_adjust_note:note||''}).eq('id',userId);
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
  const p = allProfiles.find(x=>x.id===userId);
  if(p){ p.hireDate=hireDate||''; p.leaveAdjust=Number(adjust)||0; p.leaveAdjustNote=note||''; }
}
// アカウントの名前・メールアドレスを変える（管理者のみ）。
// opts に {read:true} を渡すと、いま登録されている内容を読むだけ
async function dbUpdateAccount(userId, opts){
  const { data, error } = await sb.functions.invoke('update-account', { body:{ userId, ...(opts||{}) } });
  let detail = '';
  if(error){ try{ detail = (await error.context?.json?.())?.error || ''; }catch(_){} }
  const msg = data?.error || detail || (error ? error.message : '');
  if(msg) throw new Error(msg);
  return data;
}
// アカウントの権限（role）と所属発注先を更新（管理者のみ）
async function dbSetRole(userId, role, supplierId){
  const { error } = await sb.from('profiles').update({role, supplier_id:supplierId||null}).eq('id',userId);
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
}
// アカウント新規作成（メール招待）。Edge Functionが招待メール送信とプロフィール作成を行う（管理者のみ）
async function dbInviteUser(payload){
  // 招待メールのリンクの戻り先。アプリはGitHub Pagesのサブフォルダ（/teyose-app/）にあるので、
  // ここで渡さないとサイトの入口（存在しないページ）に飛んでしまう
  const redirectTo = location.origin + location.pathname;
  const { data, error } = await sb.functions.invoke('invite-user', { body: {...payload, redirectTo} });
  if(error){showToast('招待に失敗しました：'+error.message);throw error;}
  if(data?.error){showToast(data.error);throw new Error(data.error);}
  // マニュアルを添えられたか、送れなかったかを画面に伝える
  return { attached: !!data?.attached, note: data?.note || '' };
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
// 発注先向け：現場写真・図面・フォルダだけ取得する（日報などは対象外）
async function fetchSupplierGenbaData(){
  // 3つは互いに関係しないので、いっぺんに頼む
  const [photoRes, drawingRes, folderRes] = await Promise.all([
    sb.from('site_photos').select('*').order('shot_date',{ascending:false}).order('id',{ascending:false}),
    sb.from('drawings').select('*').order('created_at',{ascending:false}),
    sb.from('site_folders').select('*').order('name'),
  ]);
  const photoRows = photoRes.data, drawingRows = drawingRes.data, folderRows = folderRes.data;
  sitePhotos = (photoRows||[]).map(r=>({id:r.id,projectId:r.project_id,folderId:r.folder_id||null,url:r.url,caption:r.caption||'',shotDate:r.shot_date,uploadedBy:r.uploaded_by,uploaderName:r.uploader_name||'',createdAt:r.created_at}));

  drawings = (drawingRows||[]).map(r=>({id:r.id,projectId:r.project_id,folderId:r.folder_id||null,kind:r.kind||'drawing',fileUrl:r.file_url,fileName:r.file_name,fileMime:r.file_mime||'',note:r.note||'',uploadedBy:r.uploaded_by,uploaderName:r.uploader_name||'',createdAt:r.created_at}));

  siteFolders = (folderRows||[]).map(r=>({id:r.id,projectId:r.project_id,kind:r.kind,parentId:r.parent_id||null,name:r.name,createdBy:r.created_by}));
}

async function fetchGenbaData(){
  // 残業時間の集計は覚えてあるので、元になる日報を取り直したら捨てる
  if(typeof otForgetHours==='function') otForgetHours();
  // 現場管理の9つは互いに関係しないので、いっぺんに頼む（スマホでの待ち時間を減らすため）
  const [photoRows_, drawingRows_, folderRows_, viewRows_, nippoRows_, npRows_, leaveRows_, holidayRows_, licRows_] = await Promise.all([
    sb.from('site_photos').select('*').order('shot_date',{ascending:false}).order('id',{ascending:false}),
    sb.from('drawings').select('*').order('created_at',{ascending:false}),
    sb.from('site_folders').select('*').order('name'),
    sb.from('drawing_views').select('*').order('viewed_at',{ascending:false}),
    sb.from('daily_reports').select('*').order('work_date',{ascending:false}).order('id',{ascending:false}),
    sb.from('nippo_photos').select('*').order('report_id',{ascending:false}).order('sort_order').order('id'),
    sb.from('leave_requests').select('*').order('created_at',{ascending:false}),
    sb.from('holiday_requests').select('*').order('created_at',{ascending:false}),
    sb.from('licenses').select('*'),
  ]);
  const photoRows = photoRows_.data, drawingRows = drawingRows_.data, folderRows = folderRows_.data,
        viewRows = viewRows_.data, nippoRows = nippoRows_.data,
        leaveRows = leaveRows_.data, holidayRows = holidayRows_.data, licRows = licRows_.data;
  sitePhotos = (photoRows||[]).map(r=>({id:r.id,projectId:r.project_id,folderId:r.folder_id||null,url:r.url,caption:r.caption||'',shotDate:r.shot_date,uploadedBy:r.uploaded_by,uploaderName:r.uploader_name||'',createdAt:r.created_at}));

  drawings = (drawingRows||[]).map(r=>({id:r.id,projectId:r.project_id,folderId:r.folder_id||null,kind:r.kind||'drawing',fileUrl:r.file_url,fileName:r.file_name,fileMime:r.file_mime||'',note:r.note||'',uploadedBy:r.uploaded_by,uploaderName:r.uploader_name||'',createdAt:r.created_at}));

  siteFolders = (folderRows||[]).map(r=>({id:r.id,projectId:r.project_id,kind:r.kind,parentId:r.parent_id||null,name:r.name,createdBy:r.created_by}));

  drawingViews = (viewRows||[]).map(r=>({id:r.id,drawingId:r.drawing_id,userId:r.user_id,userName:r.user_name||'',viewedAt:r.viewed_at}));

  // 日報・有給はRLSが自動で絞る（carpenter＝自分の分のみ／staff＝全員分）
  dailyReports = (nippoRows||[]).map(r=>({id:r.id,userId:r.user_id,userName:r.user_name||'',workDate:r.work_date,projectId:r.project_id,projectName:r.project_name||'',workKind:r.work_kind||'',content:r.content||'',startTime:r.start_time||'08:00',endTime:r.end_time||'18:00',breakMinutes:r.break_minutes,workMinutes:r.work_minutes,overtimeMinutes:r.overtime_minutes,otStatus:r.ot_status||'none',otApproverName:r.ot_approver_name||'',otReviewerName:r.ot_reviewer_name||'',otReviewNote:r.ot_review_note||''}));

  // 日報に付けた写真（表がまだ無くても落とさない）
  {
    const npRows = npRows_.data;
    nippoPhotosReady = !npRows_.error;
    nippoPhotos = (npRows||[]).map(r=>({id:r.id, reportId:r.report_id, url:r.url,
      caption:r.caption||'', sortOrder:r.sort_order||0,
      uploadedBy:r.uploaded_by, uploaderName:r.uploader_name||'', createdAt:r.created_at,
      igScore:(r.ig_score==null?null:Number(r.ig_score)),
      igComment:r.ig_comment||'', igScoredAt:r.ig_scored_at||''}));
  }

  leaveRequests = (leaveRows||[]).map(r=>({id:r.id,userId:r.user_id,userName:r.user_name||'',startDate:r.start_date,endDate:r.end_date,leaveType:r.leave_type,days:Number(r.days),reason:r.reason||'',status:r.status,reviewerName:r.reviewer_name||'',reviewNote:r.review_note||'',reviewedAt:r.reviewed_at,absenceDates:r.absence_dates||[],createdAt:r.created_at}));

  holidayRequests = (holidayRows||[]).map(r=>({id:r.id,userId:r.user_id,userName:r.user_name||'',workDate:r.work_date,projectId:r.project_id,projectName:r.project_name||'',reason:r.reason||'',substituteDate:r.substitute_date||null,approverName:r.approver_name||'',status:r.status,reviewerName:r.reviewer_name||'',reviewNote:r.review_note||'',reviewedAt:r.reviewed_at,createdAt:r.created_at}));

  // 免許・自動車保険（RLSで本人と管理者の分だけが返る）。migration-genba22.sql 未実行でも動くようにする
  licenseTableReady = !licRows_.error;
  licenses = (licRows||[]).map(r=>({userId:r.user_id,userName:r.user_name||'',
    licenseNo:r.license_no||'', licenseExpire:r.license_expire||'', licensePhoto:r.license_photo||'',
    insurer:r.insurer||'', liabilityPerson:r.liability_person||'', liabilityObject:r.liability_object||'',
    insuranceExpire:r.insurance_expire||'', insurancePhoto:r.insurance_photo||'',
    note:r.note||'', updatedAt:r.updated_at, updatedBy:r.updated_by||''}));

  // 給与（清川創史・清川優香のみ。他の人は取りにいかないし、RLSも1行も返さない）
  if(typeof isPayrollAdmin==='function' && isPayrollAdmin()) await fetchSalaries();
}

// ── 給与（清川創史・清川優香のみ） ──
async function fetchSalaries(){
  const { data, error } = await sb.from('employee_salaries').select('*')
    .order('user_id').order('effective_month',{ascending:false});
  salaryTableReady = !error;
  employeeSalaries = (data||[]).map(r=>({
    id:r.id, userId:r.user_id, userName:r.user_name||'', effectiveMonth:r.effective_month,
    basePay:Number(r.base_pay)||0, familyAllowance:Number(r.family_allowance)||0,
    positionAllowance:Number(r.position_allowance)||0, skillAllowance:Number(r.skill_allowance)||0,
    fixedOvertime:Number(r.fixed_overtime)||0, commuteAllowance:Number(r.commute_allowance)||0,
    vehicleAllowance:Number(r.vehicle_allowance)||0,
    note:r.note||'', updatedBy:r.updated_by||'', updatedAt:r.updated_at
  }));
}

// 同じ社員・同じ適用月度の登録は1つだけ（あれば上書き）
async function dbSaveSalary(s){
  const row = {
    user_id:s.userId, user_name:s.userName||'', effective_month:s.effectiveMonth,
    base_pay:s.basePay|0, family_allowance:s.familyAllowance|0,
    position_allowance:s.positionAllowance|0, skill_allowance:s.skillAllowance|0,
    fixed_overtime:s.fixedOvertime|0, commute_allowance:s.commuteAllowance|0,
    vehicle_allowance:s.vehicleAllowance|0, note:s.note||'',
    updated_by:currentUserDisplayName||'', updated_at:new Date().toISOString()
  };
  const { error } = await sb.from('employee_salaries').upsert(row, {onConflict:'user_id,effective_month'});
  if(error){showToast('給与の保存に失敗しました：'+error.message);throw error;}
  await fetchSalaries();
}

async function dbDeleteSalary(id){
  const { error } = await sb.from('employee_salaries').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
  await fetchSalaries();
}

// ── 車両管理 ──
async function fetchVehicles(){
  const { data: vRows, error } = await sb.from('vehicles').select('*').order('sort_order').order('id');
  vehicleTableReady = !error;
  if(error){ vehicles=[]; vehicleRecords=[]; return; }
  vehicles = (vRows||[]).map(r=>({id:r.id,name:r.name,plate:r.plate||'',managerName:r.manager_name||'',
    inspectionDate:r.inspection_date||'',note:r.note||'',sortOrder:r.sort_order||0}));
  const { data: rRows } = await sb.from('vehicle_records').select('*').order('done_date',{ascending:false});
  vehicleRecords = (rRows||[]).map(r=>({id:r.id,vehicleId:r.vehicle_id,kind:r.kind,doneDate:r.done_date,
    nextDate:r.next_date||'',odo:r.odo||null,note:r.note||'',userName:r.user_name||''}));
}
async function dbSaveVehicle(id, patch){
  const map={name:'name',plate:'plate',managerName:'manager_name',inspectionDate:'inspection_date',note:'note'};
  const row={updated_at:new Date().toISOString()};
  Object.entries(patch).forEach(([k,v])=>{ if(map[k]!==undefined) row[map[k]]=v; });
  const { error } = id
    ? await sb.from('vehicles').update(row).eq('id',id)
    : await sb.from('vehicles').insert(row);
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
}
async function dbDeleteVehicle(id){
  const { error } = await sb.from('vehicles').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}
async function dbAddVehicleRecord(rec){
  const { error } = await sb.from('vehicle_records').insert({
    vehicle_id:rec.vehicleId, kind:rec.kind, done_date:rec.doneDate, next_date:rec.nextDate||null,
    odo:rec.odo||null, note:rec.note||'', user_name:currentUserDisplayName||''
  });
  if(error){showToast('登録に失敗しました：'+error.message);throw error;}
}
async function dbDeleteVehicleRecord(id){
  const { error } = await sb.from('vehicle_records').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}

// ── カード明細（JCB）──
async function fetchCardStatements(){
  if(currentUserRole!=='staff') return;
  const { data, error } = await sb.from('card_statements').select('*').order('use_date',{ascending:false});
  cardTableReady = !error;
  cardStatements = (data||[]).map(r=>({id:r.id, brand:r.brand||'JCB', payDate:r.pay_date||'', cardLast4:r.card_last4||'', cardHolder:r.card_holder||'',
    useDate:r.use_date||'', merchant:r.merchant||'', amount:Number(r.amount)||0, category:r.category||'', area:r.area||'',
    memo:r.memo||'', project:r.project||'', costType:r.cost_type||'', orderNo:r.order_no||'',
    costEntryId:r.cost_entry_id||null, status:r.status||'unassigned', rowKey:r.row_key||''}));
}
async function dbAddCardStatements(rows){
  const payload = rows.map(r=>({
    brand:r.brand||'JCB',
    pay_date:r.payDate||null, card_last4:r.cardLast4||'', card_holder:r.cardHolder||'',
    use_date:r.useDate||null, merchant:r.merchant||'', amount:r.amount||0,
    category:r.category||'', area:r.area||'', memo:r.memo||'',
    project:r.project||'', cost_type:r.costType||'', order_no:r.orderNo||'',
    status:r.status||'unassigned', row_key:r.rowKey
  }));
  // 同じ行が既にある場合は無視する（二重取り込み防止）
  const { error } = await sb.from('card_statements').upsert(payload, {onConflict:'row_key', ignoreDuplicates:true});
  if(error){showToast('取り込みに失敗しました：'+error.message);throw error;}
}
async function dbUpdateCardStatement(id, patch){
  const { error } = await sb.from('card_statements').update({...patch, updated_at:new Date().toISOString()}).eq('id',id);
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
}
// カード明細から原価を1件登録する（税込→税抜に換算）
async function dbRegisterCardCost(row, {project, costType, name}){
  const amountEx = Math.round(Number(row.amount||0)/1.1);
  const { data, error } = await sb.from('cost_entries').insert({
    date:row.useDate||null, project:project||'', name:name||row.merchant, qty:1, unit:'式',
    amount:amountEx, supplier_id:null, order_no:'', cost_type:costType||'諸経費', status:'received'
  }).select().single();
  if(error){showToast('原価登録に失敗しました：'+error.message);throw error;}
  await dbUpdateCardStatement(row.id, {project:project||'', cost_type:costType||'', status:'registered', cost_entry_id:data.id});
  return data.id;
}

// ── 免許・自動車保険 ──

// 証拠写真を license-files（非公開バケット）へ保存し、保存先パスを返す
async function dbUploadLicensePhoto(userId, blob, kind){
  const path = `${userId}/${kind}_${Date.now()}.jpg`;
  const { error } = await sb.storage.from('license-files').upload(path, blob, {contentType:'image/jpeg', upsert:false});
  if(error){showToast('写真の保存に失敗しました：'+error.message);throw error;}
  return path;
}
// 非公開バケットなので、表示のたびに期限付きURLを作る（1時間有効）
async function dbLicensePhotoUrl(path){
  if(!path) return '';
  const { data, error } = await sb.storage.from('license-files').createSignedUrl(path, 3600);
  if(error) return '';
  return data?.signedUrl||'';
}
async function dbDeleteLicensePhoto(path){
  if(!path) return;
  await sb.storage.from('license-files').remove([path]);
}
async function dbSaveLicense(userId, userName, patch){
  const row = {user_id:userId, user_name:userName||'', updated_at:new Date().toISOString(), updated_by:currentUserDisplayName||''};
  const map = {licenseNo:'license_no', licenseExpire:'license_expire', licensePhoto:'license_photo',
    insurer:'insurer', liabilityPerson:'liability_person', liabilityObject:'liability_object',
    insuranceExpire:'insurance_expire', insurancePhoto:'insurance_photo', note:'note'};
  Object.entries(patch).forEach(([k,v])=>{ if(map[k]!==undefined) row[map[k]] = (v===''&&/expire/i.test(k)) ? null : v; });
  const { error } = await sb.from('licenses').upsert(row, {onConflict:'user_id'});
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
}
// 撮影した画像から項目を読み取る（kind: 'license' / 'insurance'）
async function dbReadLicenseImage(base64, mediaType, kind){
  const { data, error } = await sb.functions.invoke('read-license', { body:{ image:base64, mediaType, kind } });
  if(error) throw new Error(error.message);
  if(data?.error) throw new Error(data.error);
  return data?.result || {};
}

// 現場写真・図面のファイルをStorageにアップロードし、公開URLを返す
// 失敗の原因を見分けて、次にどうすればよいかを伝える
function uploadErrorMessage(err){
  const m = String(err?.message || err || '');
  const st = Number(err?.statusCode || err?.status || 0);
  if(/row-level security|Unauthorized|not authorized|JWT|401|403/i.test(m) || st===401 || st===403)
    return 'ログインの期限が切れている可能性があります。一度ログアウトして入り直してください';
  if(/maximum allowed size|Payload too large|413|too large/i.test(m) || st===413)
    return 'ファイルが大きすぎます。小さくしてからお試しください';
  if(/Failed to fetch|NetworkError|network/i.test(m))
    return '通信が不安定です。電波の良い場所でもう一度お試しください';
  if(/Duplicate|already exists/i.test(m))
    return '同じ名前のファイルがすでにあります。もう一度お試しください';
  return m || '原因不明のエラーです';
}

async function dbUploadSiteFile(folder, projectId, blob, ext){
  if(blob.size > 40*1024*1024){
    showToast('ファイルが大きすぎます（40MBまで）');
    throw new Error('file too large');
  }
  const put = () => {
    const path = `${folder}/${projectId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`;
    return sb.storage.from('site-files').upload(path, blob, { contentType: blob.type || 'application/octet-stream' })
      .then(r=>({...r, path}));
  };
  let res = await put();
  // ログインの期限切れで弾かれることがあるので、入れ直してから1回だけやり直す
  if(res.error){
    try{ await sb.auth.refreshSession(); }catch(_){}
    res = await put();
  }
  if(res.error){
    showToast('アップロードに失敗しました：'+uploadErrorMessage(res.error));
    throw res.error;
  }
  const { data } = sb.storage.from('site-files').getPublicUrl(res.path);
  return data.publicUrl;
}

// ── 日報に付ける写真（migration-genba65.sql） ──
//
// ファイルは現場写真と同じ site-files バケットの nippo/ に置く。
// 表の行だけ別にして、日報を消したら写真も消えるようにしてある。
async function dbAddNippoPhotos(reportId, urls){
  if(!urls.length) return;
  const base = (nippoPhotos||[]).filter(p=>p.reportId===reportId).length;
  const rows = urls.map((url,i)=>({ report_id:reportId, url, caption:'', sort_order:base+i,
    uploaded_by:currentUserId, uploader_name:currentUserDisplayName||'' }));
  const { error } = await sb.from('nippo_photos').insert(rows);
  if(error){
    showToast(error.code==='42P01'
      ? 'データベースの準備が必要です。supabase/migration-genba65.sql を実行してください'
      : '写真の登録に失敗しました：'+error.message);
    throw error;
  }
}
// 写真を「Instagramに載せるのに向いているか」でAIに採点させる（一度に12枚まで）
async function dbScoreNippoPhotos(photoIds){
  const { data, error } = await sb.functions.invoke('score-photo', { body:{ photoIds } });
  if(error || data?.error){
    let msg = data?.error;
    if(!msg && error?.context && typeof error.context.json==='function'){
      try{ const j = await error.context.json(); msg = j?.error; }catch(_){}
    }
    throw new Error(msg || error?.message || '採点に失敗しました');
  }
  return data?.results || [];
}

// 採点の基準を、採点している当人（Edge Function）から取ってくる。
// 画面に書き写さないので、見せている基準と実際の採点が食い違わない
async function dbPhotoScoreCriteria(){
  const { data, error } = await sb.functions.invoke('score-photo', { body:{ criteria:true } });
  if(error || data?.error){
    let msg = data?.error;
    if(!msg && error?.context && typeof error.context.json==='function'){
      try{ const j = await error.context.json(); msg = j?.error; }catch(_){}
    }
    throw new Error(msg || error?.message || '採点基準を読み出せませんでした');
  }
  return data?.criteria || null;
}

async function dbDeleteNippoPhoto(id){
  const { error } = await sb.from('nippo_photos').delete().eq('id', id);
  if(error){ showToast('写真の削除に失敗しました：'+error.message); throw error; }
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
    project_id:d.projectId, folder_id:d.folderId||null, kind:d.kind||'drawing', file_url:d.fileUrl, file_name:d.fileName, file_mime:d.fileMime||'', note:d.note||'',
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
// 名前で決まっているフォルダ（例：日報写真）を用意する。
// すでにあればその番号を返し、無ければ作る。
// 別の端末が先に作っていることもあるので、作る前にもう一度データベースを見る
async function dbEnsureSiteFolder(projectId, kind, name){
  const found = (siteFolders||[]).find(f=>f.projectId===projectId && f.kind===kind
                  && !f.parentId && f.name===name);
  if(found) return found.id;
  const { data } = await sb.from('site_folders').select('id')
    .eq('project_id', projectId).eq('kind', kind).is('parent_id', null).eq('name', name).limit(1);
  if(data && data.length){
    siteFolders.push({id:data[0].id, projectId, kind, parentId:null, name, createdBy:null});
    return data[0].id;
  }
  const id = await dbAddFolder(projectId, kind, null, name);
  siteFolders.push({id, projectId, kind, parentId:null, name, createdBy:currentUserId});
  return id;
}

// 日報から写真を消したときに、現場写真へ写してあった分も片付ける。
// 同じファイル（URL）を指している行を消す。できなくても日報側の操作は止めない
async function dbDeleteSitePhotosByUrls(urls){
  const list = [...new Set((urls||[]).filter(Boolean))];
  if(!list.length) return;
  const { error } = await sb.from('site_photos').delete().in('url', list);
  if(error) console.warn('現場写真の片付けに失敗', error.message);
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
  // 誰の日報か。清川創史が社員の代わりに書くときだけ自分以外になる
  const ownerId = n.userId || currentUserId;
  const ownerName = n.userId ? (n.userName||'') : (currentUserDisplayName||'');
  if(n.id){
    const { error } = await sb.from('daily_reports').update({...row, user_id:ownerId, user_name:ownerName}).eq('id',n.id);
    if(error){showToast('日報の保存に失敗しました：'+error.message);throw error;}
    return n.id;
  }
  const { data, error } = await sb.from('daily_reports').insert({...row, user_id:ownerId, user_name:ownerName}).select().single();
  if(error){showToast('日報の保存に失敗しました：'+error.message);throw error;}
  return data.id;
}
async function dbDeleteNippo(id){
  const { error } = await sb.from('daily_reports').delete().eq('id',id);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}

// 出面表の手直し：承認済みの有給のうち、指定した日を欠勤扱いにする／戻す（管理者のみ）
async function dbSetLeaveAbsence(id, dates){
  const list = [...new Set(dates||[])].sort();
  const { error } = await sb.from('leave_requests').update({absence_dates:list}).eq('id',id);
  if(error){showToast('更新に失敗しました：'+error.message);throw error;}
  const lr = leaveRequests.find(x=>x.id===id);
  if(lr) lr.absenceDates = list;
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
// 管理者：取得実績の代理登録（承認済みとして記録。通知もチャット転記もしない）
async function dbAddLeaveRecord(rec){
  const { data, error } = await sb.from('leave_requests').insert({
    user_id:rec.userId, user_name:rec.userName||'',
    start_date:rec.startDate, end_date:rec.endDate, leave_type:rec.leaveType, days:rec.days,
    reason:rec.reason||'（実績入力）', status:'approved',
    reviewer_name:currentUserDisplayName||'', reviewed_at:new Date().toISOString()
  }).select().single();
  if(error){showToast('登録に失敗しました：'+error.message);throw error;}
  return data.id;
}
async function dbReviewLeaveRequest(id, status, note){
  const lr = leaveRequests.find(x=>x.id===id);

  // 承認するときは、残日数で足りない分を欠勤扱いにする
  const absence = (status==='approved' && lr && typeof leaveAbsenceDates==='function')
    ? leaveAbsenceDates(lr) : [];

  const row = {
    status, review_note:note||'', reviewer_name:currentUserDisplayName||'', reviewed_at:new Date().toISOString()
  };
  if(status==='approved') row.absence_dates = absence;

  let { error } = await sb.from('leave_requests').update(row).eq('id',id);
  // absence_dates の列（migration-genba50.sql）が未適用でも承認は通す
  if(error && /absence_dates/.test(error.message||'')){
    console.warn('absence_dates列が未作成のため、欠勤扱いを保存せずに続行します');
    delete row.absence_dates;
    ({ error } = await sb.from('leave_requests').update(row).eq('id',id));
  }
  if(error){showToast('更新に失敗しました：'+error.message);throw error;}
  if(lr && row.absence_dates) lr.absenceDates = absence;

  // 申請者本人へ通知
  if(lr){
    const period = lr.startDate.replace(/-/g,'/');
    if(status==='approved' && absence.length){
      const half = lr.leaveType!=='全日';
      const d = absence.length * (half?0.5:1);
      dbSendPushToUser(lr.userId, '有給申請の結果（欠勤扱いを含みます）',
        `${period}〜の申請を承認しました。ただし有給の残日数が足りないため、${lvNum(d)}日分（${absence.map(x=>x.slice(5).replace('-','/')).join('・')}）は欠勤として出面表に登録します。`,
        'genba/leave').catch(()=>{});
    } else {
      const label = status==='approved' ? '承認されました' : '却下されました';
      dbSendPushToUser(lr.userId, '有給申請の結果', `${period}〜の有給申請が${label}`, 'genba/leave').catch(()=>{});
    }
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
// quiet=true のときは、失敗しても画面に出さない（起動時の自動の作り直しで使う）
async function dbSavePushSubscription(sub, quiet){
  const { data: userData } = await sb.auth.getUser();
  if(!userData?.user) throw new Error('ログインが確認できませんでした');
  const json = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({
    user_id: userData.user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth
  }, { onConflict: 'endpoint' });
  if(error){ if(!quiet) showToast('通知設定の保存に失敗しました：'+error.message); throw error; }
}

async function dbDeletePushSubscription(endpoint){
  if(!endpoint) return;
  const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if(error) console.warn('古い登録を消せませんでした', error.message);
}

// この端末の登録が、データベースに残っているか
async function dbHasPushSubscription(endpoint){
  if(!endpoint || !currentUserId) return false;
  const { data, error } = await sb.from('push_subscriptions')
    .select('id').eq('user_id', currentUserId).eq('endpoint', endpoint).limit(1);
  if(error) return false;
  return !!(data && data.length);
}
// tab: 通知タップ時に開く画面（例 'genba/nippo'。省略時はアプリを開くだけ）
async function dbSendPush(targetRole, targetSupplierId, title, body, excludeUserId, tab){
  await sb.functions.invoke('send-push', { body: { targetRole, targetSupplierId, title, body, excludeUserId, tab } });
}
async function dbSendPushToUser(targetUserId, title, body, tab){
  await sb.functions.invoke('send-push', { body: { targetRole:'user', targetUserId, title, body, tab } });
}
// 表示名で宛先を指定して送信（残業承認者・タスクの引き継ぎなど）。
// 21時〜翌7時のぶんは鳴らさず、サーバー側でいったん預かって翌朝7時に届く
// （以前はここで捨てていたため、夜の連絡が消えていた。migration-genba60.sql）
async function dbSendPushToNames(targetNames, title, body, tab){
  await sb.functions.invoke('send-push', { body: { targetRole:'names', targetNames, title, body, tab } });
}
// 上と同じ。以前は「夜でも鳴らす」ために分けていたが、いまは夜のぶんも
// 捨てずに翌朝届くので、呼び分ける必要はない（呼び出し側はそのまま残してある）
async function dbSendPushToNamesNow(targetNames, title, body, tab){
  await sb.functions.invoke('send-push', { body: { targetRole:'names', targetNames, title, body, tab } });
}
// アカウントを指定して1人に通知する（名前が同じ人がいても取り違えない）
async function dbSendPushToUser(targetUserId, title, body, tab){
  if(!targetUserId) return;
  await sb.functions.invoke('send-push', { body: { targetRole:'user', targetUserId, title, body, tab } });
}
// 請求書が登録されたことを管理者にメールで知らせる（通知を消してしまっても残るように）。
// 送り先は Secrets の INVOICE_MAIL_TO、無ければ管理者のアカウントのメールアドレス
async function dbNotifyInvoice(invoiceId){
  const { data, error } = await sb.functions.invoke('notify-invoice', { body:{ invoiceId } });
  if(error || data?.error) console.warn('請求書のお知らせメールを送れませんでした：', data?.error || error?.message);
  return data;
}
// 役割（staff など）でまとめて通知する。
// excludeSelf を true にすると、送った本人には通知しない（自分の操作は知らせなくてよい）
async function dbSendPushToRole(targetRole, title, body, tab, excludeSelf){
  await sb.functions.invoke('send-push', { body: { targetRole, title, body, tab,
    ...(excludeSelf ? { excludeUserId: currentUserId } : {}) } });
}

// ── リアルタイム同期（他端末の変更を反映） ──
function subscribeRealtime(){
  sb.channel('app-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'suppliers'}, ()=>refetchAndRerender('suppliers'))
    .on('postgres_changes',{event:'*',schema:'public',table:'master_items'}, ()=>refetchAndRerender('master_items'))
    .on('postgres_changes',{event:'*',schema:'public',table:'chat_messages'}, onChatMessageChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'chat_reads'}, onChatReadChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'chat_groups'}, ()=>refetchChatAndRerender())
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
    .on('postgres_changes',{event:'*',schema:'public',table:'licenses'}, ()=>refetchAndRerender('licenses'))
    .on('postgres_changes',{event:'*',schema:'public',table:'vehicles'}, ()=>refetchAndRerender('vehicles'))
    .on('postgres_changes',{event:'*',schema:'public',table:'vehicle_records'}, ()=>refetchAndRerender('vehicles'))
    .on('postgres_changes',{event:'*',schema:'public',table:'inspection_records'}, ()=>refetchAndRerender('inspections'))
    .on('postgres_changes',{event:'*',schema:'public',table:'notifications'}, ()=>refreshNotifications())
    .on('postgres_changes',{event:'*',schema:'public',table:'tasks'}, ()=>refreshTasks())
    .on('postgres_changes',{event:'*',schema:'public',table:'staff_assignments'}, ()=>refreshStaffAssigns())
    .on('postgres_changes',{event:'*',schema:'public',table:'task_templates'}, ()=>refreshTaskTemplates())
    .subscribe(status=>{
      // つなぎ直したときは、切れていた間の分を取りこぼしているので一度だけ取り直す
      if(status==='SUBSCRIBED'){
        if(_chatWasSubscribed) refetchChatAndRerender();
        _chatWasSubscribed = true;
      }
    });
}
let _chatWasSubscribed = false;

// 新着メッセージ（自分以外の投稿）が増えたら、着信音を鳴らして未読バッジを更新する
let _lastChatMsgId = null;
function latestChatMsgId(){
  let max=0, mine=true;
  Object.values(talkThreads).forEach(list=>(list||[]).forEach(m=>{
    if(typeof m.id==='number' && m.id>max){ max=m.id; mine = m.senderName===currentUserDisplayName; }
  }));
  return {max, mine};
}
function notifyNewChatMessages(){
  const {max, mine} = latestChatMsgId();
  const isNew = _lastChatMsgId!==null && max>_lastChatMsgId && !mine;
  _lastChatMsgId = max;
  if(isNew) playChatChime();
  updateChatBadge();
}

async function refetchAndRerender(table){
  try{
    await fetchAllData();
  }catch(e){console.warn('再取得に失敗しました',e);return;}
  // 残業時間の集計は覚えてあるので、元のデータが変わったら捨てる
  if(typeof otForgetHours==='function') otForgetHours();
  if(table==='suppliers'){
    renderSupplierSelectList();
    if(document.getElementById('ordersub-supplier')?.classList.contains('active')) renderSupplierMaster();
  }
  if(table==='master_items' && document.getElementById('ordersub-master')?.classList.contains('active')) renderMaster();
  if(table==='chat_messages'){
    notifyNewChatMessages();   // 着信音・未読バッジ
    if(talkPanelOpen){
      if(activeTalkPanelSupplier){
        renderTalkPanelMessages();
        // 開いているスレッドは読んだものとして扱う
        dbMarkThreadRead(threadKeyOf(activeTalkPanelSupplier)).then(updateChatBadge).catch(()=>{});
      } else {
        renderTalkPanelList();
      }
    }
  }
  // 納品タブ（業者さん）。選んでいる品目は覚えてあるので、描き直しても消えない
  if(table==='orders' && document.getElementById('page-delivery')?.classList.contains('active')
     && typeof renderDeliveryPage==='function') renderDeliveryPage();
  if((table==='orders'||table==='cost_entries') && (currentUserRole==='staff'||currentUserRole==='carpenter')){
    if(document.getElementById('ordersub-history')?.classList.contains('active')) renderOrders();
    if(document.getElementById('page-cost')?.classList.contains('active')) renderCost();
  }
  if(['site_photos','drawings','site_folders','drawing_views','daily_reports','leave_requests','holiday_requests','licenses','vehicles'].includes(table)){
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

// 案件一覧のカードに出す表紙写真を選ぶ（管理者・社員）
async function dbSetProjectCover(projectId, photoId){
  const { error } = await sb.from('projects').update({cover_photo_id:photoId}).eq('id',projectId);
  if(error){showToast('保存に失敗しました：'+error.message);throw error;}
  const p=projects.find(x=>x.id===projectId);
  if(p) p.coverPhotoId=photoId;
}


// ── 会社共通の設定（1人工あたりの労務費など。migration-genba36.sql） ──
async function fetchAppSettings(){
  const { data, error } = await sb.from('app_settings').select('key, value');
  appSettingsReady = !error;
  appSettings = {};
  (data||[]).forEach(r=>{ appSettings[r.key] = r.value||{}; });
}
async function dbSaveAppSetting(key, value){
  const { error } = await sb.from('app_settings')
    .upsert({key, value, updated_at:new Date().toISOString(), updated_by:currentUserDisplayName||''}, {onConflict:'key'});
  if(error){
    showToast(/app_settings/.test(error.message||'')
      ? 'データベースの準備が必要です。supabase/migration-genba36.sql を実行してください'
      : '保存に失敗しました：'+error.message);
    throw error;
  }
  appSettings[key]=value;
}
// ── 定期点検（実施記録） ──
async function fetchInspections(){
  const { data, error } = await sb.from('inspection_records').select('*').order('done_date',{ascending:false});
  inspectionTableReady = !error;
  inspectionRecords = (data||[]).map(r=>({id:r.id, projectId:r.project_id, kind:r.kind,
    doneDate:r.done_date||'', guidedDate:r.guided_date||'', note:r.note||'', userName:r.user_name||''}));
}
// マイグレーション㉚が未実行だと guided_date が無い／実施日が必須のままなので、直し方を伝える
function inspectionSaveError(error){
  const m=String(error?.message||'');
  if(/guided_date/.test(m) || /done_date/.test(m)){
    showToast('データベースの準備が必要です。supabase/migration-genba30.sql を実行してください');
  }else{
    showToast('保存に失敗しました：'+m);
  }
  throw error;
}
async function dbSaveInspection(projectId, kind, doneDate, note){
  const cur=(inspectionRecords||[]).find(r=>r.projectId===projectId && r.kind===kind);
  const { error } = await sb.from('inspection_records').upsert({
    project_id:projectId, kind, done_date:doneDate, guided_date:cur?.guidedDate||null,
    note:note||'', user_name:currentUserDisplayName||''
  }, {onConflict:'project_id,kind'});
  if(error) inspectionSaveError(error);
}
async function dbDeleteInspection(projectId, kind){
  const { error } = await sb.from('inspection_records').delete().eq('project_id',projectId).eq('kind',kind);
  if(error){showToast('削除に失敗しました：'+error.message);throw error;}
}

// 定期点検：お客様への案内が済んだ日を記録する（実施日はそのまま残す）
async function dbSaveInspectionGuide(projectId, kind, guidedDate){
  const cur=(inspectionRecords||[]).find(r=>r.projectId===projectId && r.kind===kind);
  const { error } = await sb.from('inspection_records').upsert({
    project_id:projectId, kind, guided_date:guidedDate||null,
    done_date:cur?.doneDate||null, note:cur?.note||'', user_name:currentUserDisplayName||''
  }, {onConflict:'project_id,kind'});
  if(error) inspectionSaveError(error);
}


// ════ 発注書の送付先（発注先マスタで選ぶ） ════
//
//   chat     … 手寄のチャットに発注書を出す（発注先のアカウントに届く）
//   chatwork … ChatWorkのルームへ転送する（ルームIDを入れてある発注先のみ）
//   email    … メールで送る
//
// 何も選ばれていない古いデータは、これまでどおり chat とみなす。
const ORDER_CHANNEL_LABEL = {chat:'チャット', chatwork:'ChatWork', email:'メール'};
function orderChannelsOf(sup){
  const a = sup && Array.isArray(sup.orderChannels) ? sup.orderChannels.filter(Boolean) : [];
  return a.length ? a : ['chat'];
}

// 発注確定のあと、選ばれている送り先へ発注書を送る
async function dbSendOrderToSupplier(order){
  const sup = (suppliers||[]).find(s=>s.name===order.suppliers);
  const ch = orderChannelsOf(sup);

  // 発注書PDF。ChatWorkとメールで使う（発注確定のときに作ってあるので、あればそれを使う）
  let pdfUrl = order.pdfUrl || '';
  if(!pdfUrl && (ch.includes('chatwork') || ch.includes('email'))){
    try{ pdfUrl = await dbGenerateOrderPdf(order); }catch(_){}   // 作れなくても送信は続ける
  }

  // チャット（ChatWorkへはこのあとまとめて送るので、ここでは転送しない）
  if(ch.includes('chat')){
    await dbAddChatMessage(order.suppliers,{role:'me',type:'order',orderData:order,noChatwork:true});
  }

  // ChatWork（発注書PDFを添えて送る。PDFが無いときは中身を文字で知らせる）
  if(ch.includes('chatwork')){
    // 見出しには送った人の名前が出る。本文にも「担当者」を書いて、誰に連絡すればよいか分かるようにする
    const staffName = order.createdByName || currentUserDisplayName || '';
    const preview = `発注書 ${order.no}（${order.project}）合計 ¥${fmt(order.total)}`
      + (order.paymentMethod ? '' : `\n納品場所：${orderDeliveryLabel(order)}`)
      + (staffName ? `\n担当者：${staffName}` : '')
      + (order.note ? `\n備考：${order.note}` : '');
    dbForwardToChatWork(sup?.id, staffName, preview,
      pdfUrl ? {fileUrl:pdfUrl, fileName:`発注書_${order.no}.pdf`, fileNameAscii:`order_${order.no}.pdf`, fileMime:'application/pdf'} : null).catch(()=>{});
  }

  // メール（発注書PDFを添えて送る）
  if(ch.includes('email')){
    await dbMailOrderToSupplier(order, sup, pdfUrl);
  }
}

// 発注書をメールで送る。先にPDFを作ってから、そのPDFを添えて送信する
async function dbMailOrderToSupplier(order, sup, readyPdfUrl){
  if(!sup?.email){
    showToast(`${order.suppliers}にメールアドレスが登録されていません`, 4000);
    return;
  }
  showToast(`${sup.name}へメールを送っています…`, 20000);
  let pdfUrl = readyPdfUrl || '';
  if(!pdfUrl){
    try{
      pdfUrl = await dbGenerateOrderPdf(order);   // 失敗しても本文だけで送る
    }catch(_){}
  }
  const { data, error } = await sb.functions.invoke('send-order-mail', { body:{ order, pdfUrl } });
  if(error || data?.error){
    // Supabaseは2xx以外だと中身を読まずにエラーにするので、理由をこちらで取り出す
    let detail = '';
    try{ detail = (await error?.context?.json?.())?.error || ''; }catch(_){}
    showToast('メールを送れませんでした：'+(data?.error || detail || error?.message || '原因不明'), 6000);
    return;
  }
  showToast(`${sup.email} へ発注書をメールしました`, 4000);
}


// ════ チャットだけを取り直す ════
//
// 新しいメッセージが届いたときに、案件・見積・発注・タスクまで全部取り直していると
// 何十件も通信が走って数秒かかる。チャットは2件だけ取れば足りるので分けてある。
// お客様チャットの参加者（案件情報で選んだきよかわ側の担当）を読み直して、手元の案件に反映する。
//
// 案件を読み込んだあとに、ほかの端末・ほかの社員がお客様チャットを作った・担当を変えた場合、
// 手元の案件は古いままで「自分が入っているお客様チャット」に気づけない。
// チャットを組み立て直すたびに、この2列だけを軽く読み直す。
// 手元の案件にも反映するので、そのあとの画面表示（案件情報の参加者欄）もそろう。
// 読めなかったときは null を返し、呼び出し元は手元の案件のままで組み立てる。
//
// 通信（clientChatMembershipRows）と反映（applyClientChatMembership）を分けてあるのは、
// 起動時にほかの読み込みと一緒に走らせるため
function clientChatMembershipRows(){
  if(!(currentUserRole==='staff'||currentUserRole==='carpenter')) return Promise.resolve({data:null,error:null});
  return sb.from('projects').select('id, name, client_chat_member_ids, client_chat_member_names');
}
function applyClientChatMembership(res){
  if(!res || res.error || !res.data){
    // 列がまだ無い環境などでは、手元の案件のままで組み立てる
    if(res?.error) console.warn('お客様チャットの参加者を読み直せませんでした', res.error.message);
    return null;
  }
  const byId = new Map(res.data.map(r=>[r.id, r]));
  projects.forEach(p=>{
    const r = byId.get(p.id);
    if(!r) return;
    p.clientChatMemberIds   = r.client_chat_member_ids   || [];
    p.clientChatMemberNames = r.client_chat_member_names || [];
  });
  return res.data;
}

// チャットの読み込みは「通信（fetchChatRows）」と「組み立て（buildChatData）」に分けてある。
// 起動時は、ほかの読み込みと一緒に通信だけ先に走らせ、案件と名簿がそろってから組み立てる。
// こうしないと、案件チャット・お客様チャットの名前が「（削除された案件）」になってしまう
// ── 開いたときに読むチャットの量 ──
//
// やりとりは消えずに積み上がるので、全部取りに行くと使うほど立ち上がりが遅くなる。
// スレッドごとに直近だけを読み、古いところは「もっと前を読む」で足す。
const CHAT_FIRST_LOAD = 100;   // 開いたときに、スレッドごとに読む件数
const CHAT_MORE_LOAD  = 100;   // 「もっと前を読む」で足す件数

async function fetchChatRows(){
  const [msgs, groups, reads, mine] = await Promise.all([
    fetchChatMessageRows(),
    sb.from('chat_groups').select('*').order('created_at'),
    sb.from('chat_reads').select('*'),
    // お客様チャットの持ち主。お客様は案件そのものを見られないので、専用の手続きから受け取る
    isClientUser() ? sb.rpc('app_my_client_chats') : clientChatMembershipRows(),
  ]);
  if(msgs.error) throw msgs.error;
  return { msgs, groups, reads, mine };
}

// スレッドごとの直近だけを読む。
// データベース側の手続き（migration-genba89.sql）がまだ入っていない環境では、
// これまでどおり全部読む（入れ替えの途中でも使えなくならないようにするため）
let _chatRecentRpcOk = true;
async function fetchChatMessageRows(){
  if(_chatRecentRpcOk){
    const res = await sb.rpc('app_recent_chat', { p_per_thread: CHAT_FIRST_LOAD });
    if(!res.error) return res;
    // 手続きが無い（42883／PGRST202）ときだけ、これまでのやり方に戻す
    const code = String(res.error.code||'');
    if(code!=='42883' && code!=='PGRST202') return res;
    console.warn('app_recent_chat がまだ無いので、全件読みます（supabase/migration-genba89.sql）');
    _chatRecentRpcOk = false;
  }
  return sb.from('chat_messages').select('*').order('created_at');
}

// 「もっと前を読む」。いま持っているいちばん古い1件より前を、同じスレッドから取る
async function dbOlderChatRows(anchorId){
  const { data, error } = await sb.rpc('app_chat_older',
    { p_anchor_id: anchorId, p_limit: CHAT_MORE_LOAD });
  if(error){ showToast('前のやりとりを読めませんでした：'+error.message); throw error; }
  return data || [];
}

async function fetchChatData(prefetched){
  const raw = prefetched || await fetchChatRows();
  buildChatData(raw);
}

// 受け取った行から、画面が使う形に組み立てる（ここでは通信しない）
function buildChatData(raw){
  const chatRows = raw.msgs.data || [];
  // お客様チャット
  try{
    if(isClientUser()){
      if(raw.mine?.error) throw raw.mine.error;
      clientChats = (raw.mine?.data||[]).map(r=>({projectId:r.project_id, projectName:r.project_name, memberNames:r.member_names||[]}));
    } else {
      // きよかわ側：案件情報で自分が選ばれているお客様チャットだけ。
      // 手元の案件が古いと、できたばかりのお客様チャットに気づけないので読み直したものを使う
      const fresh = applyClientChatMembership(raw.mine);
      clientChats = fresh
        ? fresh.filter(r=>(r.client_chat_member_ids||[]).includes(currentUserId))
               .map(r=>({projectId:r.id, projectName:r.name, memberNames:r.client_chat_member_names||[]}))
        : (projects||[])
               .filter(p=>(p.clientChatMemberIds||[]).includes(currentUserId))
               .map(p=>({projectId:p.id, projectName:p.name, memberNames:p.clientChatMemberNames||[]}));
    }
  }catch(e){ console.warn('お客様チャットの取得に失敗しました', e); clientChats = []; }
  clientThreadIds = {};

  // グループは、自分がメンバーのものだけ返ってくる（RLS）。表がまだ無い環境でも止めない
  if(raw.groups?.error){ console.warn('グループの取得に失敗しました', raw.groups.error.message); chatGroups = []; }
  else chatGroups = (raw.groups?.data||[]).map(g=>({id:g.id, name:g.name, memberIds:g.member_ids||[], memberNames:g.member_names||[], createdBy:g.created_by||null}));
  groupThreadIds = {};
  talkThreads = {};
  chatOlder = {};
  chatRows.forEach(r=>{
    const name = chatThreadNameOfRow(r);
    // 行き先の分からないものは置かない。
    // 入れてしまうと「null」という名前のスレッドができ、発注先チャットに紛れ込む
    if(!name) return;
    if(!talkThreads[name]) talkThreads[name]=[];
    talkThreads[name].push(chatRowToMsg(r));
  });
  // 読める上限いっぱいまで来たスレッドは、まだ前がある見込み。
  // （全件読みに落ちているときは、前はもう無い）
  if(_chatRecentRpcOk){
    for(const name in talkThreads){
      if(talkThreads[name].length >= CHAT_FIRST_LOAD) chatOlder[name] = true;
    }
  }
  // まだやりとりの無いグループ・お客様チャットも一覧に出す
  chatGroups.forEach(g=>{ const n=groupThreadName(g.id); if(!talkThreads[n]) talkThreads[n]=[]; });
  clientChats.forEach(c=>{ const n=clientThreadName(c.projectId); if(!talkThreads[n]) talkThreads[n]=[]; });

  // 既読管理
  chatReads = (raw.reads?.data||[]).map(chatReadRowTo);
}

// チャットの変更で呼ばれる。取り直すのはチャットだけにして、待ち時間を短くする。
//
//   fromReads … 既読（chat_reads）が変わっただけのとき true。
//     このときは既読を書き直さない。書き直すとまたリアルタイムで通知が飛んできて
//     「再取得 → 既読を書く → 通知 → 再取得 …」と延々と回り、画面がチカチカする。
// ════ チャットの差分反映（1件だけ当てる） ════
//
// 以前は、誰かが1通書くたびにチャットを全件取り直していた（メッセージ400件＋既読200件）。
// 人数と件数が増えるほど通信量が増え、2026-09に転送量の上限に当たる一因になった。
// リアルタイムで届く「変わった行そのもの」を当てて、取り直さないようにする。
// 当てられない形（知らないグループ・案件など）のときだけ、これまでどおり全件取り直す。

// データベースの行 → 画面で使う形
function chatRowToMsg(r){
  return {id:r.id, role:r.role, type:r.type, text:r.text, orderData:r.order_data,
    fileUrl:r.file_url, fileName:r.file_name, fileMime:r.file_mime,
    ts:new Date(r.created_at).getTime(), unread:r.unread, senderName:r.sender_name||'',
    reactions:r.reactions||{}, replyToText:r.reply_to_text||'', replyToSender:r.reply_to_sender||'',
    editedAt:r.edited_at||null, bookmarks:r.bookmarks||[]};
}
function chatReadRowTo(r){
  return {userId:r.user_id, userName:r.user_name||'', thread:r.thread, lastReadAt:new Date(r.last_read_at).getTime()};
}
// 行 → どのスレッドのものか。分からなければ null（全件取り直しに落とす）
function chatThreadNameOfRow(r){
  // お客様に見えるのはお客様チャットだけ。ほかの行が混ざっても置かない
  if(isClientUser() && !r.client_project_id) return null;
  if(r.client_project_id) return clientChatOf(r.client_project_id) ? clientThreadName(r.client_project_id) : null;
  if(r.group_id)          return groupById(r.group_id) ? groupThreadName(r.group_id) : null;
  if(r.direct_a)          return directThreadName(r.direct_a===currentUserId ? r.direct_b : r.direct_a);
  if(r.project_id)        return projectThreadName(r.project_id);
  if(r.is_internal)       return INTERNAL_THREAD;
  return supplierNameById(r.supplier_id);
}

// 届いた1件を当てる。当てられたら true
function applyChatMessageChange(payload){
  const kind = payload?.eventType;
  if(kind==='DELETE'){
    const id = payload.old?.id;
    if(id==null) return false;
    for(const name in talkThreads){
      const i = (talkThreads[name]||[]).findIndex(m=>m.id===id);
      if(i>=0){ talkThreads[name].splice(i,1); return true; }
    }
    return true;   // もともと持っていない（自分に関係ない）ものは、何もしなくてよい
  }
  const r = payload?.new;
  if(!r || r.id==null) return false;
  const name = chatThreadNameOfRow(r);
  if(!name) return false;              // 知らないグループ・案件 → 取り直す
  const msg = chatRowToMsg(r);
  if(!talkThreads[name]) talkThreads[name]=[];
  const list = talkThreads[name];
  const i = list.findIndex(m=>m.id===msg.id);
  if(i>=0){ list[i] = msg; return true; }
  if(kind==='UPDATE'){
    // 編集・リアクションなのに手元に無い＝取りこぼしているので取り直す
    return false;
  }
  list.push(msg);
  // 届く順が前後しても並びが崩れないようにする
  if(list.length>1 && list[list.length-2].ts > msg.ts) list.sort((a,b)=>a.ts-b.ts);
  return true;
}

// 既読の1件を当てる
function applyChatReadChange(payload){
  if(payload?.eventType==='DELETE'){
    const id = payload.old?.id;
    if(id==null) return false;
    return true;   // 既読が消えることは運用上ない
  }
  const r = payload?.new;
  if(!r || !r.thread || !r.user_id) return false;
  const rec = chatReadRowTo(r);
  const i = chatReads.findIndex(x=>x.userId===rec.userId && x.thread===rec.thread);
  if(i>=0) chatReads[i] = rec; else chatReads.push(rec);
  return true;
}

// 差分を当てたあとの画面の更新（取り直したときと同じ後始末）
function afterChatChanged(fromReads){
  notifyNewChatMessages();   // 着信音・未読バッジ
  if(!talkPanelOpen) return;
  if(activeTalkPanelSupplier){
    renderTalkPanelMessages();
    if(!fromReads) markThreadReadIfNeeded(activeTalkPanelSupplier);
  } else {
    renderTalkPanelList();
  }
}

// リアルタイムの入口。当てられなければ全件取り直しに落とす
function onChatMessageChange(payload){
  if(applyChatMessageChange(payload)) afterChatChanged(false);
  else refetchChatAndRerender();
}
function onChatReadChange(payload){
  if(applyChatReadChange(payload)) afterChatChanged(true);
  else refetchChatAndRerender(true);
}

async function refetchChatAndRerender(fromReads){
  // 開いているのがグループなら、取り直す前にIDを覚えておく（名前が変わるとスレッド名も変わるため）
  const openGroupId = (activeTalkPanelSupplier && isGroupThread(activeTalkPanelSupplier)) ? groupThreadIds[activeTalkPanelSupplier] : null;
  try{ await fetchChatData(); }
  catch(e){ console.warn('チャットの再取得に失敗しました', e); return; }
  if(openGroupId && talkPanelOpen){
    if(!groupById(openGroupId)){
      // ほかの人に外された・グループが消された
      closeTalkPanelThread();
      showToast('グループのメンバーから外れたため、閉じました');
      return;
    }
    const now = groupThreadName(openGroupId);
    if(now!==activeTalkPanelSupplier){
      activeTalkPanelSupplier = now;
      const t=document.getElementById('talk-panel-title'); if(t) t.textContent = now;
    }
    const g = groupById(openGroupId);
    const meta = document.querySelector('#talk-panel-meta .talk-group-meta');
    if(meta) meta.innerHTML = `メンバー：${esc((g.memberNames||[]).filter(Boolean).join('、')||'—')}<span>変更</span>`;
  }
  afterChatChanged(fromReads);
}
