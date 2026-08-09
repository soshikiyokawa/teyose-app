// ════ 見積：保存・新規作成・読み込み・一覧 ════

function openGoogleMap(){
  const lat = window._currentMapLat;
  const lng = window._currentMapLng;
  if(lat && lng){
    window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank', 'noopener');
  } else {
    const addr = document.getElementById('est-site')?.value.trim();
    if(!addr){ showToast('工事場所を入力してください'); return; }
    window.open('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(addr), '_blank', 'noopener');
  }
}

function updateMapPinIndicator(){
  const el = document.getElementById('map-pin-indicator');
  if(!el) return;
  el.style.display = (window._currentMapLat && window._currentMapLng) ? 'inline' : 'none';
}

let _leafletMap = null, _leafletMarker = null;

// 工事場所（案件情報タブの入力欄。未入力なら選択中の案件の住所）を取得
function _currentSiteAddress(){
  const v = document.getElementById('est-site')?.value.trim();
  return v || selectedProject?.address || '';
}

// 住所から緯度経度を検索（日本国内優先。番地入りで見つからなければ番地を落として再検索）
async function _geocodeAddress(addr){
  const tryFetch = async q => {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=jp&limit=1&q=${encodeURIComponent(q)}`);
    const data = await res.json();
    return data.length ? L.latLng(parseFloat(data[0].lat), parseFloat(data[0].lon)) : null;
  };
  let hit = await tryFetch(addr);
  if(!hit){
    // 「1-2-3」のような番地部分を削って市区町村レベルで再検索
    const rough = addr.replace(/[0-9０-９][-‐－0-9０-９]*\s*$/, '').trim();
    if(rough && rough !== addr) hit = await tryFetch(rough);
  }
  return hit;
}

async function openMapPicker(){
  const addr = _currentSiteAddress();
  document.getElementById('map-picker-overlay').style.display = 'flex';
  await new Promise(r=>setTimeout(r,100));

  if(!_leafletMap){
    _leafletMap = L.map('map-picker-container').setView([34.5, 132.5], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      attribution:'© OpenStreetMap contributors', maxZoom:19
    }).addTo(_leafletMap);
    _leafletMap.on('click', e=>{
      if(_leafletMarker) _leafletMarker.setLatLng(e.latlng);
      else _leafletMarker = L.marker(e.latlng,{draggable:true}).addTo(_leafletMap);
      document.getElementById('map-picker-coords').textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
    });
  } else {
    _leafletMap.invalidateSize();
  }

  // 既存ピンがあれば表示
  if(window._currentMapLat && window._currentMapLng){
    const latlng = L.latLng(window._currentMapLat, window._currentMapLng);
    if(_leafletMarker) _leafletMarker.setLatLng(latlng);
    else _leafletMarker = L.marker(latlng,{draggable:true}).addTo(_leafletMap);
    _leafletMap.setView(latlng, 16);
    document.getElementById('map-picker-coords').textContent = `${window._currentMapLat.toFixed(6)}, ${window._currentMapLng.toFixed(6)}`;
    _leafletMarker.on('dragend', e=>{
      const p = e.target.getLatLng();
      document.getElementById('map-picker-coords').textContent = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
    });
    return;
  }

  // 工事場所の住所で検索して、その位置を中心に地図を表示
  if(addr){
    document.getElementById('map-picker-coords').textContent = `「${addr}」を検索中…`;
    try{
      const latlng = await _geocodeAddress(addr);
      if(latlng){
        if(_leafletMarker) _leafletMarker.setLatLng(latlng);
        else _leafletMarker = L.marker(latlng,{draggable:true}).addTo(_leafletMap);
        _leafletMap.setView(latlng, 17);
        document.getElementById('map-picker-coords').textContent = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
        _leafletMarker.on('dragend', e=>{
          const p = e.target.getLatLng();
          document.getElementById('map-picker-coords').textContent = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
        });
      } else {
        document.getElementById('map-picker-coords').textContent = '地図をタップしてピンを置いてください';
        showToast('住所が見つかりませんでした。地図をタップしてピンを置いてください。');
      }
    }catch(_){
      document.getElementById('map-picker-coords').textContent = '地図をタップしてピンを置いてください';
      showToast('住所検索に失敗しました');
    }
  } else {
    showToast('工事場所を入力すると、その住所を中心に表示します');
  }
}

// 既にピンがある場合でも、工事場所の住所を中心に開き直す
async function recenterMapToAddress(){
  const addr = _currentSiteAddress();
  if(!addr){ showToast('工事場所が入力されていません'); return; }
  document.getElementById('map-picker-coords').textContent = `「${addr}」を検索中…`;
  try{
    const latlng = await _geocodeAddress(addr);
    if(!latlng){ showToast('住所が見つかりませんでした'); document.getElementById('map-picker-coords').textContent='地図をタップしてピンを置いてください'; return; }
    _leafletMap.setView(latlng, 17);
    if(_leafletMarker){
      // ピンは動かさず地図だけ移動（座標表示は現在のピンのまま）
      const p = _leafletMarker.getLatLng();
      document.getElementById('map-picker-coords').textContent = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
    } else {
      document.getElementById('map-picker-coords').textContent = '地図をタップしてピンを置いてください';
    }
    showToast(`「${addr}」を表示しました`);
  }catch(_){ showToast('住所検索に失敗しました'); }
}

function closeMapPicker(){ document.getElementById('map-picker-overlay').style.display = 'none'; }

function saveMapPin(){
  if(!_leafletMarker){ showToast('ピンを置いてください'); return; }
  const p = _leafletMarker.getLatLng();
  window._currentMapLat = p.lat;
  window._currentMapLng = p.lng;
  updateMapPinIndicator();
  closeMapPicker();
  showToast('✅ ピン位置を保存しました（案件保存で確定します）');
}

function clearMapPin(){
  window._currentMapLat = null;
  window._currentMapLng = null;
  if(_leafletMarker){ _leafletMarker.remove(); _leafletMarker = null; }
  document.getElementById('map-picker-coords').textContent = '地図をタップしてピンを置いてください';
  updateMapPinIndicator();
}

function defaultEstTitle(){
  const d=new Date();
  return '御見積書'+d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');
}

function collectEstData(){
  const v=id=>document.getElementById(id).value;
  return {id:editingEstId||Date.now(),title:v('est-title')||defaultEstTitle(),no:v('est-no'),date:v('est-date'),expire:v('est-expire'),status:v('est-status'),type:v('est-type'),
    startDate:v('est-start-date'),endDate:v('est-end-date'),
    clientName:v('est-client'),projectName:v('est-project'),siteName:v('est-site'),note:v('est-note'),
    clientAddress:v('est-client-address'),clientTel:v('est-client-tel'),clientEmail:v('est-client-email'),tantou:v('est-tantou'),mapLat:window._currentMapLat||null,mapLng:window._currentMapLng||null,
    contractDate:v('est-contract-date'),contractAmount:payAmtVal('est-contract-amount'),
    completion:parseFloat(document.getElementById('est-completion')?.value)||0,
    estProfitRate:parseFloat(document.getElementById('est-profit-rate')?.value)||0,
    actualProfit:payAmtVal('est-actual-profit'),
    extras:[
      {date:v('est-extra1-date'),amount:payAmtVal('est-extra1-amount')},
      {date:v('est-extra2-date'),amount:payAmtVal('est-extra2-amount')},
      {date:v('est-extra3-date'),amount:payAmtVal('est-extra3-amount')}
    ],
    payments:estPaymentsFromForm(),
    sections:sections.map(s=>({...s,items:[...s.items]})),discountAmount:parseFloat(v('discount-amount'))||0,taxRate:parseFloat(v('tax-rate'))||10};
}

// 入金の行（この順に並べる）。ラベルで保存するので、行が増えても既存データがずれない
const EST_PAY_ROWS = [
  {id:'est-pay0', label:'契約時金'},
  {id:'est-pay1', label:'着工金'},
  {id:'est-pay2', label:'上棟時金'},
  {id:'est-pay3', label:'最終金'}
];
// 画面 → 保存する形
function estPaymentsFromForm(){
  const v=id=>document.getElementById(id)?.value||'';
  return EST_PAY_ROWS.map(r=>({
    label:r.label,
    date:v(r.id+'-date'), amount:payAmtVal(r.id+'-amount'),
    actualDate:v(r.id+'-actual-date'), actualAmount:payAmtVal(r.id+'-actual-amount')
  }));
}
// 保存されている形 → 画面（ラベルで照合。ラベルの無い古いデータは並び順で拾う）
function estPaymentsToForm(payments){
  const list=payments||[];
  const sv=(id,val)=>{const el=document.getElementById(id); if(el) el.value=val||'';};
  // 古いデータ（契約時金が無い3行）は、着工金から順に入っているとみなす
  const legacy = !list.some(p=>p?.label) ? true : false;
  EST_PAY_ROWS.forEach((r,i)=>{
    const p = legacy ? list[i-1] : list.find(x=>x?.label===r.label);
    sv(r.id+'-date', p?.date);
    payAmtLoad(r.id+'-amount', p?.amount);
    sv(r.id+'-actual-date', p?.actualDate);
    payAmtLoad(r.id+'-actual-amount', p?.actualAmount);
  });
  estUpdateInfoTotals();
}

async function saveEstInfo(){
  if(!editingEstId){ return saveEstimate(); } // 見積がまだ無ければ新規作成する
  const existing = estimates.find(e=>e.id===editingEstId);
  if(!existing) return;
  const v=id=>document.getElementById(id)?.value||'';
  const updated = {...existing,
    title:v('est-title')||defaultEstTitle(),no:v('est-no'),date:v('est-date'),expire:v('est-expire'),
    status:v('est-status'),type:v('est-type'),
    startDate:v('est-start-date'),endDate:v('est-end-date'),
    clientName:v('est-client'),projectName:v('est-project'),siteName:v('est-site'),note:v('est-note'),
    clientAddress:v('est-client-address'),clientTel:v('est-client-tel'),clientEmail:v('est-client-email'),tantou:v('est-tantou'),mapLat:window._currentMapLat||null,mapLng:window._currentMapLng||null,
    contractDate:v('est-contract-date'),contractAmount:payAmtVal('est-contract-amount'),
    extras:[
      {date:v('est-extra1-date'),amount:payAmtVal('est-extra1-amount')},
      {date:v('est-extra2-date'),amount:payAmtVal('est-extra2-amount')},
      {date:v('est-extra3-date'),amount:payAmtVal('est-extra3-amount')}
    ],
    payments:estPaymentsFromForm()
  };
  try{
    await dbSaveEstimate(updated);
  }catch(e){ return; }
  const i=estimates.findIndex(e=>e.id===editingEstId);
  if(i>=0) estimates[i]=updated;
  updated.updatedAt=new Date().toISOString();
  estDirty=false;
  updateEstBadge();
  renderProjectSidebar();
  showToast('見積情報を保存しました');
}

async function saveEstimate(){
  const data=collectEstData();
  let savedId;
  try{
    savedId = await dbSaveEstimate(data);
  }catch(e){return;}
  data.id = savedId;
  data.updatedAt = new Date().toISOString();
  if(editingEstId){const i=estimates.findIndex(e=>e.id===editingEstId);if(i>=0)estimates[i]=data;}
  else{estimates.unshift(data);}
  editingEstId = savedId;
  estDirty = false;
  updateEstBadge();
  renderProjectSidebar();
  alert('保存しました：'+(data.title||data.projectName||data.siteName||data.no||'無題'));
}

// 編集中の内容を、別の名前を付けて新しい見積として保存する（上書きしない）
async function saveEstimateAs(){
  const current=document.getElementById('est-title').value || defaultEstTitle();
  const newTitle=prompt('保存名を入力してください',current);
  if(newTitle===null) return; // キャンセル
  document.getElementById('est-title').value=newTitle.trim()||defaultEstTitle();
  editingEstId=null; // 新規保存させる
  await saveEstimate();
}

// ── 未保存確認ダイアログ ──
let _estDirtyCallback=null;
function confirmEstDiscard(cb){
  if(!estDirty){cb();return;}
  _estDirtyCallback=cb;
  document.getElementById('est-dirty-modal').classList.add('open');
}
async function estDirtyConfirm(action){
  document.getElementById('est-dirty-modal').classList.remove('open');
  if(action==='cancel'){_estDirtyCallback=null;return;}
  if(action==='save') await saveEstimate();
  if(_estDirtyCallback){_estDirtyCallback();_estDirtyCallback=null;}
}

// 新規作成（未保存確認あり）
function newEstimateChecked(){confirmEstDiscard(()=>newEstimate());}

function newEstimate(){
  editingEstId=null;
  ['est-no','est-date','est-expire','est-start-date','est-end-date','est-actual-start','est-handover','est-client','est-client-address','est-client-tel','est-client-email','est-tantou','est-project','est-site','est-note',
   'est-contract-date','est-extra1-date','est-extra2-date','est-extra3-date',
   'est-pay0-date','est-pay0-amount','est-pay1-date','est-pay1-amount','est-pay2-date','est-pay2-amount','est-pay3-date','est-pay3-amount',
   'est-pay0-actual-date','est-pay0-actual-amount','est-pay1-actual-date','est-pay1-actual-amount','est-pay2-actual-date','est-pay2-actual-amount','est-pay3-actual-date','est-pay3-actual-amount'
  ].forEach(id=>document.getElementById(id).value='');
  ['est-contract-amount','est-extra1-amount','est-extra2-amount','est-extra3-amount'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('est-status').value='draft';
  document.getElementById('est-type').value='新築';
  document.getElementById('discount-amount').value='0';
  document.getElementById('tax-rate').value='10';
  document.getElementById('est-title').value=defaultEstTitle();
  document.getElementById('est-no').value='E'+new Date().getFullYear()+'-'+String(estSeq++).padStart(3,'0');
  const now=new Date();
  document.getElementById('est-date').value=now.toISOString().slice(0,10);
  const expire=new Date(now);
  expire.setMonth(expire.getMonth()+1);
  document.getElementById('est-expire').value=expire.toISOString().slice(0,10);
  // 案件が選択されていれば、その情報を自動入力する
  const initType = selectedProject?.type||'新築';
  if(selectedProject){
    document.getElementById('est-client').value=selectedProject.clientName;
    document.getElementById('est-type').value=initType;
    fillProjectInfoTab(selectedProject); // 物件名・工事場所・着工/完工予定日・地図ピンは案件から
  }
  loadDefaultSectionsForType(initType);
  renderPresetDatalists();
  estDirty=false;
  updateEstBadge();renderSections();estSubTab('info');
  renderProjectSidebar();
  updateProjDeleteBtn();
  updateProjDateLabels();
  estUpdateInfoTotals();
}

function cloneSections(list){
  return (list||[]).map(s=>({...s,items:s.items.map(i=>({...i}))}));
}

// 指定の工事区分のデフォルト明細を読み込む（無ければ空の工種を1つ用意）
function loadDefaultSectionsForType(type){
  const def=estimateDefaults[type];
  if(def && def.length){
    sections=cloneSections(def);
    secSeq=Math.max(secSeq,...sections.map(s=>s.id))+1;
    itemSeq=Math.max(itemSeq,1,...sections.flatMap(s=>s.items.map(i=>i.id)))+1;
  } else {
    sections=[];
    addSection('仮設工事');
  }
}

// 工事区分の選択を変えたときに、その区分のデフォルト明細を読み込み直す
function applyDefaultForCurrentType(){
  const type=document.getElementById('est-type').value;
  if(sections.length && !confirm(`現在の明細を消して「${type}」のデフォルトを読み込みますか？`)) return;
  loadDefaultSectionsForType(type);
  renderPresetDatalists();
  renderSections();
}

// 現在の明細を、選択中の工事区分のデフォルトとして保存する
async function saveCurrentAsDefault(){
  const type=document.getElementById('est-type').value;
  if(!sections.length){alert('明細が空です');return;}
  if(!confirm(`現在の明細を「${type}」のデフォルトとして保存しますか？\n以後この工事区分で新規見積を作成した際の初期値になります。`)) return;
  try{
    await dbSaveEstimateDefault(type,cloneSections(sections));
  }catch(e){return;}
  showToast(`「${type}」のデフォルトを保存しました`);
}

function loadEstimate(est){
  editingEstId=est.id;
  const sv=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||'';};
  sv('est-title',est.title);sv('est-no',est.no);sv('est-date',est.date);sv('est-expire',est.expire);sv('est-status',est.status);sv('est-type',est.type);
  sv('est-client',est.clientName);sv('est-client-address',est.clientAddress);sv('est-client-tel',est.clientTel);sv('est-client-email',est.clientEmail);sv('est-tantou',est.tantou);
  sv('est-note',est.note);
  // 物件名・工事場所・着工/完工予定日・地図ピンは案件（projects）側の情報。下で案件から反映する
  sv('discount-amount',est.discountAmount);sv('tax-rate',est.taxRate);
  const pays=est.payments||[];
  sv('est-contract-date',est.contractDate);payAmtLoad('est-contract-amount',est.contractAmount);
  const ex=est.extras||[];
  sv('est-extra1-date',ex[0]?.date);payAmtLoad('est-extra1-amount',ex[0]?.amount);
  sv('est-extra2-date',ex[1]?.date);payAmtLoad('est-extra2-amount',ex[1]?.amount);
  sv('est-extra3-date',ex[2]?.date);payAmtLoad('est-extra3-amount',ex[2]?.amount);
  estPaymentsToForm(pays);
  sections=est.sections.map(s=>({...s,items:[...s.items]}));
  secSeq=Math.max(secSeq,...sections.map(s=>s.id))+1;
  itemSeq=Math.max(itemSeq,1,...sections.flatMap(s=>s.items.map(i=>i.id)))+1;
  renderPresetDatalists();
  estDirty=false;
  updateEstBadge();renderSections();estSubTab('info');
  selectedProjectName = est.projectName || null;
  selectedProject = projects.find(p=>p.name===est.projectName)||null;
  // 案件情報タブは案件（projects）から反映。案件が見つからない旧見積は見積の値で表示
  if(selectedProject) fillProjectInfoTab(selectedProject);
  else fillProjectInfoTab({name:est.projectName,address:est.siteName,startDate:est.startDate,endDate:est.endDate,mapLat:est.mapLat,mapLng:est.mapLng});
  renderProjectSidebar();
  renderInfoGenbaSections && renderInfoGenbaSections();
}

function calcEstTotal(e){
  const w=(e.sections||[]).reduce((t,s)=>t+s.items.reduce((s2,i)=>s2+i.qty*i.price,0),0);
  const sub=Math.max(0,w-(e.discountAmount||0));
  return sub+Math.round(sub*(e.taxRate||10)/100);
}

// ── 左サイドバー＋モバイル案件セレクト：案件マスタをベースに表示 ──
let _sidebarStatusFilter='';
function setSidebarStatusFilter(s){
  _sidebarStatusFilter=s;
  const label={'':'全て','draft':'下書き','sent':'提出済み','approved':'受注','construction':'工事中','completed':'完工'}[s]||'全て';
  document.querySelectorAll('.sf-btn').forEach(b=>b.classList.toggle('active',b.textContent.trim()===label));
  renderProjectSidebar();
}

// 案件の並び：工事中 → 受注 → 提出済み → 下書き → 完工。同じステータスの中は新しい順
const PROJ_STATUS_ORDER = ['construction','approved','sent','draft','completed'];

// ステータスの表示名（下書き・提出済み・受注・工事中・完工）
const EST_STATUS_LABEL = {draft:'下書き', sent:'提出済み', approved:'受注', construction:'工事中', completed:'完工'};
function estStatusLabel(s){ return EST_STATUS_LABEL[s] || '完工'; }
function projStatusOf(p){
  const list=(estimates||[]).filter(e=>e.projectName===p.name);
  if(!list.length) return 'draft';   // 見積がまだ無い案件は下書き扱い
  const newest=[...list].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0))[0];
  return newest.status||'draft';
}
function sortProjectsForList(list){
  return [...list].sort((a,b)=>{
    const ra=PROJ_STATUS_ORDER.indexOf(projStatusOf(a));
    const rb=PROJ_STATUS_ORDER.indexOf(projStatusOf(b));
    if(ra!==rb) return (ra<0?99:ra)-(rb<0?99:rb);
    return new Date(b.updatedAt||0)-new Date(a.updatedAt||0);
  });
}

function renderProjectSidebar(){
  const kw=(document.getElementById('est-sidebar-search')?.value||'').trim().toLowerCase();
  const sorted=sortProjectsForList(projects);

  // モバイル用セレクト（全件）
  const msel=document.getElementById('est-sidebar-mobile-select');
  if(msel){
    msel.innerHTML='<option value="">案件を選択...</option>'+
      sorted.map(p=>`<option value="${p.id}"${selectedProject?.id===p.id?' selected':''}>${esc(p.name)}${p.clientName?'（'+esc(p.clientName)+'）':''}</option>`).join('');
  }

  // デスクトップ用サイドバーリスト
  const el=document.getElementById('est-project-sidebar-list');
  if(!el) return;
  let list=sorted;
  if(kw) list=list.filter(p=>p.name.toLowerCase().includes(kw)||(p.clientName||'').toLowerCase().includes(kw));
  if(_sidebarStatusFilter){
    const pids=new Set(estimates.filter(e=>e.status===_sidebarStatusFilter).map(e=>e.projectName));
    list=list.filter(p=>pids.has(p.name));
  }
  if(!list.length){el.innerHTML='<div style="padding:10px;font-size:12px;color:var(--text-muted)">案件がありません</div>';return;}
  el.innerHTML=list.map(p=>`
    <div onclick="selectProjectSidebar(${p.id})"
      style="padding:8px 10px;font-size:12px;cursor:pointer;border-radius:6px;margin:2px 6px;${selectedProject?.id===p.id?'background:var(--wood);color:#fff;font-weight:700':'color:var(--text-sub)'}">
      <div style="display:flex;align-items:center;gap:4px">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>
        <button onclick="event.stopPropagation();openEditProject(${p.id})"
          style="flex-shrink:0;background:none;border:none;cursor:pointer;font-size:10px;padding:1px 3px;border-radius:3px;opacity:.6;${selectedProject?.id===p.id?'color:#fff':'color:var(--text-muted)'}"
          title="編集">編集</button>
      </div>
      ${p.clientName?`<div style="font-size:10px;opacity:.7;margin-top:1px">${esc(p.clientName)}</div>`:''}
    </div>`).join('');
}

function filterProjectSidebar(){ renderProjectSidebar(); }

// モバイル案件セレクト：id で選択（空選択で解除）
function selectProjectSidebarMobile(val){
  if(!val){ selectedProject=null; selectedProjectName=null; renderProjectSidebar(); renderEstListBody(); return; }
  selectProjectSidebar(parseInt(val,10));
}

// 案件を選択 → その案件の最新見積を読み込む
function selectProjectSidebar(id){
  confirmEstDiscard(()=>_selectProjectSidebarGo(id));
}
function _selectProjectSidebarGo(id){
  selectedProject=projects.find(p=>p.id===id)||null;
  selectedProjectName=selectedProject?.name||null;
  const matches=estimates.filter(e=>e.projectName===selectedProject?.name);
  matches.sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0));
  if(matches.length) loadEstimate(matches[0]);
  else newEstimate(); // 見積が無い案件：案件情報を表示（見積書は任意）
  renderEstListBody();
  onProjectChanged && onProjectChanged();
  renderInfoGenbaSections && renderInfoGenbaSections();
  applySupplierProjectView && applySupplierProjectView();
  resetScheduleEdit && resetScheduleEdit();
  updateProjDeleteBtn();
  // 原価管理ページを開いたまま案件を切り替えた場合も即反映（在庫分表示は解除）
  if(document.getElementById('page-cost')?.classList.contains('active')){
    costViewStock=false;
    renderCost();
  }
}

// ── 案件情報タブ（物件名・工事場所・着工/完工予定日・地図ピン）は案件（projects）に保存する ──
// 見積書なしで案件を立ち上げ・編集できる
function fillProjectInfoTab(p){
  const sv=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||'';};
  sv('est-project', p?.name);
  sv('est-site', p?.address);
  sv('est-start-date', p?.startDate);
  sv('est-end-date', p?.endDate);
  sv('est-actual-start', p?.actualStartDate);
  sv('est-handover', p?.handoverDate);
  updateProjDateLabels();
  window._currentMapLat = p?.mapLat||null;
  window._currentMapLng = p?.mapLng||null;
  updateMapPinIndicator && updateMapPinIndicator();
  // 契約済み駐車場
  sv('est-parking', p?.parkingAddress);
  window._parkingLat = p?.parkingLat||null;
  window._parkingLng = p?.parkingLng||null;
  updateParkingPinIndicator && updateParkingPinIndicator();
  renderParkingDocs && renderParkingDocs();
  // 案件チャットの参加メンバー
  if(typeof projectMembers!=='undefined'){
    projectMembers = [...(p?.members||[])];
    renderProjectMembers && renderProjectMembers();
  }
}

async function saveProjectInfo(){
  const name=document.getElementById('est-project').value.trim();
  if(!name){ showToast('物件名を入力してください'); return; }
  const base=selectedProject||{};
  const proj={
    id: selectedProject?.id || undefined,
    name,
    clientName: base.clientName||'',
    type: base.type||'新築',
    address: document.getElementById('est-site').value.trim(),
    note: base.note||'',
    startDate: document.getElementById('est-start-date').value||'',
    endDate: document.getElementById('est-end-date').value||'',
    actualStartDate: document.getElementById('est-actual-start')?.value||'',
    handoverDate: document.getElementById('est-handover')?.value||'',
    mapLat: window._currentMapLat||null,
    mapLng: window._currentMapLng||null,
    parkingAddress: document.getElementById('est-parking')?.value.trim()||'',
    parkingLat: window._parkingLat||null,
    parkingLng: window._parkingLng||null,
    members: (typeof projectMembers!=='undefined') ? [...projectMembers] : (base.members||[])
  };
  let savedId;
  try{ savedId=await dbSaveProject(proj); }catch(e){ return; }
  proj.id=savedId; proj.updatedAt=new Date().toISOString();
  const i=projects.findIndex(p=>p.id===savedId);
  if(i>=0) projects[i]={...projects[i],...proj}; else projects.unshift(proj);
  selectedProject={...projects.find(p=>p.id===savedId)};
  selectedProjectName=proj.name;
  estDirty=false;
  renderProjectSidebar();
  renderInfoGenbaSections && renderInfoGenbaSections();
  showToast('案件を保存しました');
}

// ── 案件作成・編集モーダル ──
function showNewProjectModal(){
  editingProjectId=null;
  document.getElementById('project-modal-title').textContent='案件を作成';
  ['proj-name','proj-client','proj-address','proj-note'].forEach(id=>document.getElementById(id).value='');
  const sel=document.getElementById('proj-type');
  sel.innerHTML=estimateTypes.map(t=>`<option>${esc(t.name)}</option>`).join('');
  document.getElementById('proj-delete-btn').style.display='none';
  document.getElementById('project-modal').classList.add('open');
  setTimeout(()=>document.getElementById('proj-name').focus(),50);
}

function openEditProject(id){
  const p=projects.find(x=>x.id===id);
  if(!p) return;
  editingProjectId=id;
  document.getElementById('project-modal-title').textContent='案件を編集';
  document.getElementById('proj-name').value=p.name;
  document.getElementById('proj-client').value=p.clientName;
  document.getElementById('proj-address').value=p.address;
  document.getElementById('proj-note').value=p.note;
  const sel=document.getElementById('proj-type');
  sel.innerHTML=estimateTypes.map(t=>`<option${t.name===p.type?' selected':''}>${esc(t.name)}</option>`).join('');
  document.getElementById('proj-delete-btn').style.display='';
  document.getElementById('project-modal').classList.add('open');
}

function closeProjectModal(){ document.getElementById('project-modal').classList.remove('open'); }

async function saveProject(){
  const name=document.getElementById('proj-name').value.trim();
  if(!name){alert('物件名を入力してください');return;}
  const proj={
    id:editingProjectId||undefined,
    name,
    clientName:document.getElementById('proj-client').value.trim(),
    type:document.getElementById('proj-type').value,
    address:document.getElementById('proj-address').value.trim(),
    note:document.getElementById('proj-note').value.trim()
  };
  try{
    const savedId=await dbSaveProject(proj);
    proj.id=savedId; proj.updatedAt=new Date().toISOString();
    if(editingProjectId){
      const i=projects.findIndex(p=>p.id===editingProjectId);
      if(i>=0) projects[i]={...projects[i],...proj};
      if(selectedProject?.id===editingProjectId){ selectedProject={...selectedProject,...proj}; selectedProjectName=proj.name; }
    } else {
      projects.unshift(proj);
    }
    closeProjectModal();
    renderProjectSidebar();
    showToast(editingProjectId?'案件を更新しました':'案件を作成しました');
  }catch(e){}
}

async function deleteProject(){
  const p=projects.find(x=>x.id===editingProjectId);
  if(!p) return;
  if(!confirm(`「${p.name}」を削除しますか？\n（関連する見積・発注書は残ります）`)) return;
  try{
    await dbDeleteProject(editingProjectId);
    projects=projects.filter(x=>x.id!==editingProjectId);
    if(selectedProject?.id===editingProjectId){ selectedProject=null; selectedProjectName=null; }
    closeProjectModal();
    renderProjectSidebar();
    showToast('案件を削除しました');
  }catch(e){}
}

function showEstList(){
  const typeSel=document.getElementById('est-list-type-filter');
  typeSel.innerHTML='<option value="">区分：全て</option>'+estimateTypes.map(t=>`<option>${esc(t.name)}</option>`).join('');
  renderEstListBody();
  document.getElementById('est-list-overlay').classList.add('open');
}

function filterEstList(){ renderEstListBody(); }

function clearProjectFilterInList(){
  selectedProject=null; selectedProjectName=null;
  renderProjectSidebar();
  renderEstListBody();
}

function renderEstListBody(){
  const typeFilter=document.getElementById('est-list-type-filter')?.value||'';
  const list=estimates.filter(e=>{
    if(selectedProjectName && (e.projectName||'（物件名未設定）')!==selectedProjectName) return false;
    if(typeFilter && e.type!==typeFilter) return false;
    return true;
  });
  const chip = selectedProjectName ? `
    <div style="display:flex;align-items:center;gap:6px;padding:6px 14px;font-size:11px;color:var(--text-sub);background:var(--surface2)">
      案件で絞り込み中：<strong>${esc(selectedProjectName)}</strong>
      <button class="btn xs" onclick="clearProjectFilterInList()" style="margin-left:auto">✕ 解除</button>
    </div>` : '';
  const el=document.getElementById('est-list-body');
  el.innerHTML=chip+(list.length?list.map(e=>`
    <div class="list-item" onclick="confirmEstDiscard(()=>{loadEstimate(estimates.find(x=>x.id===${e.id}));closeEstList();})">
      <div class="li-info">
        <div class="li-name">${e.title||e.projectName||e.siteName||e.no||'無題の見積'}</div>
        <div class="li-meta">${e.no} · ${e.type} · ${e.date||'日付未設定'} <span class="badge ${e.status}" style="margin-left:4px">${estStatusLabel(e.status)}</span></div>
      </div>
      <div class="li-amt">¥${fmt(calcEstTotal(e))}</div>
      <button class="btn danger xs" onclick="event.stopPropagation();deleteEstimateFromList(${e.id})" style="margin-left:8px">削除</button>
    </div>`).join(''):'<div class="empty">該当する見積はありません</div>');
}

async function deleteEstimateFromList(id){
  const e=estimates.find(x=>x.id===id);
  if(!e) return;
  if(!confirm(`「${e.title||e.projectName||e.no||'無題の見積'}」を削除しますか？`)) return;
  try{
    await dbDeleteEstimate(id);
  }catch(err){return;}
  estimates=estimates.filter(x=>x.id!==id);
  if(editingEstId===id) editingEstId=null;
  renderEstListBody();
  renderProjectSidebar();
  showToast('見積を削除しました');
}
function closeEstList(){document.getElementById('est-list-overlay').classList.remove('open');}

// ── 案件情報タブから、選択中の案件を削除する（一覧には削除ボタンを置かない） ──
function updateProjDeleteBtn(){
  const wrap=document.getElementById('proj-delete-wrap');
  if(!wrap) return;
  // 案件を選んでいて、管理者のときだけ出す
  const show = !!selectedProject && currentUserRole==='staff';
  wrap.style.display = show ? 'flex' : 'none';
}
async function deleteCurrentProject(){
  const p=selectedProject;
  if(!p){ showToast('案件が選択されていません'); return; }
  if(!confirm(`「${p.name}」を削除しますか？\n（この案件の見積・発注書は残ります）\nこの操作は元に戻せません。`)) return;
  try{
    await dbDeleteProject(p.id);
    projects=projects.filter(x=>x.id!==p.id);
    selectedProject=null; selectedProjectName=null;
    newEstimate();
    renderProjectSidebar();
    updateProjDeleteBtn();
    estSubTab('list');
    showToast('案件を削除しました');
  }catch(e){}
}

// ── 着工予定日／完工予定日の見出し ──
// 実績（着工日・引渡日）を入れると、見出しが「着工日」「引渡日」に変わる
function updateProjDateLabels(){
  const sl=document.getElementById('est-start-label');
  const el=document.getElementById('est-end-label');
  const as=document.getElementById('est-actual-start')?.value||'';
  const hd=document.getElementById('est-handover')?.value||'';
  if(sl) sl.textContent = as ? '着工日' : '着工予定日';
  if(el) el.textContent = hd ? '引渡日' : '完工予定日';
}

// ── 契約情報・入金予定・実績の合計 ──
// 入力しながら合計が分かるように、打つたびに書き換える。
// 契約情報の合計（請負契約＋追加契約①②③）は、案件一覧のカードに出る請負金額と同じ数字。
const EST_CONTRACT_AMOUNT_IDS = ['est-contract-amount','est-extra1-amount','est-extra2-amount','est-extra3-amount'];

function estContractTotalFromForm(){
  return EST_CONTRACT_AMOUNT_IDS.reduce((s,id)=>s+payAmtVal(id),0);
}
function estUpdateInfoTotals(){
  const set=(id,v)=>{const el=document.getElementById(id); if(el) el.textContent='¥'+fmt(v);};
  set('est-contract-total', estContractTotalFromForm());
  set('est-pay-plan-total',   EST_PAY_ROWS.reduce((s,r)=>s+payAmtVal(r.id+'-amount'),0));
  set('est-pay-actual-total', EST_PAY_ROWS.reduce((s,r)=>s+payAmtVal(r.id+'-actual-amount'),0));
}

// 金額欄を打っている間も合計を追いかける
document.addEventListener('DOMContentLoaded', ()=>{
  const ids = EST_CONTRACT_AMOUNT_IDS
    .concat(EST_PAY_ROWS.map(r=>r.id+'-amount'))
    .concat(EST_PAY_ROWS.map(r=>r.id+'-actual-amount'));
  ids.forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.addEventListener('input', estUpdateInfoTotals);
  });
  estUpdateInfoTotals();
});
