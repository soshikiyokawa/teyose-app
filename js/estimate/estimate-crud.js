// ════ 見積：保存・新規作成・読み込み・一覧 ════

function defaultEstTitle(){
  const d=new Date();
  return '御見積書'+d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');
}

function collectEstData(){
  const v=id=>document.getElementById(id).value;
  return {id:editingEstId||Date.now(),title:v('est-title')||defaultEstTitle(),no:v('est-no'),date:v('est-date'),expire:v('est-expire'),status:v('est-status'),type:v('est-type'),
    startDate:v('est-start-date'),endDate:v('est-end-date'),
    clientName:v('est-client'),projectName:v('est-project'),siteName:v('est-site'),note:v('est-note'),
    clientAddress:v('est-client-address'),tantou:v('est-tantou'),
    contractDate:v('est-contract-date'),contractAmount:payAmtVal('est-contract-amount'),
    completion:parseFloat(document.getElementById('est-completion')?.value)||0,
    estProfitRate:parseFloat(document.getElementById('est-profit-rate')?.value)||0,
    actualProfit:payAmtVal('est-actual-profit'),
    extras:[
      {date:v('est-extra1-date'),amount:payAmtVal('est-extra1-amount')},
      {date:v('est-extra2-date'),amount:payAmtVal('est-extra2-amount')},
      {date:v('est-extra3-date'),amount:payAmtVal('est-extra3-amount')}
    ],
    payments:[
      {label:'着工金',date:v('est-pay1-date'),amount:payAmtVal('est-pay1-amount'),actualDate:v('est-pay1-actual-date'),actualAmount:payAmtVal('est-pay1-actual-amount')},
      {label:'上棟時金',date:v('est-pay2-date'),amount:payAmtVal('est-pay2-amount'),actualDate:v('est-pay2-actual-date'),actualAmount:payAmtVal('est-pay2-actual-amount')},
      {label:'最終金',date:v('est-pay3-date'),amount:payAmtVal('est-pay3-amount'),actualDate:v('est-pay3-actual-date'),actualAmount:payAmtVal('est-pay3-actual-amount')}
    ],
    sections:sections.map(s=>({...s,items:[...s.items]})),discountAmount:parseFloat(v('discount-amount'))||0,taxRate:parseFloat(v('tax-rate'))||10};
}

async function saveEstInfo(){
  if(!editingEstId){ showToast('先に見積を選択してください'); return; }
  const existing = estimates.find(e=>e.id===editingEstId);
  if(!existing) return;
  const v=id=>document.getElementById(id)?.value||'';
  const updated = {...existing,
    title:v('est-title')||defaultEstTitle(),no:v('est-no'),date:v('est-date'),expire:v('est-expire'),
    status:v('est-status'),type:v('est-type'),
    startDate:v('est-start-date'),endDate:v('est-end-date'),
    clientName:v('est-client'),projectName:v('est-project'),siteName:v('est-site'),note:v('est-note'),
    clientAddress:v('est-client-address'),tantou:v('est-tantou'),
    contractDate:v('est-contract-date'),contractAmount:payAmtVal('est-contract-amount'),
    extras:[
      {date:v('est-extra1-date'),amount:payAmtVal('est-extra1-amount')},
      {date:v('est-extra2-date'),amount:payAmtVal('est-extra2-amount')},
      {date:v('est-extra3-date'),amount:payAmtVal('est-extra3-amount')}
    ],
    payments:[
      {label:'着工金',date:v('est-pay1-date'),amount:payAmtVal('est-pay1-amount'),actualDate:v('est-pay1-actual-date'),actualAmount:payAmtVal('est-pay1-actual-amount')},
      {label:'上棟時金',date:v('est-pay2-date'),amount:payAmtVal('est-pay2-amount'),actualDate:v('est-pay2-actual-date'),actualAmount:payAmtVal('est-pay2-actual-amount')},
      {label:'最終金',date:v('est-pay3-date'),amount:payAmtVal('est-pay3-amount'),actualDate:v('est-pay3-actual-date'),actualAmount:payAmtVal('est-pay3-actual-amount')}
    ]
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
  showToast('案件情報を保存しました');
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
  ['est-no','est-date','est-expire','est-start-date','est-end-date','est-client','est-client-address','est-tantou','est-project','est-site','est-note',
   'est-contract-date','est-extra1-date','est-extra2-date','est-extra3-date',
   'est-pay1-date','est-pay1-amount','est-pay2-date','est-pay2-amount','est-pay3-date','est-pay3-amount',
   'est-pay1-actual-date','est-pay1-actual-amount','est-pay2-actual-date','est-pay2-actual-amount','est-pay3-actual-date','est-pay3-actual-amount'
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
    document.getElementById('est-project').value=selectedProject.name;
    document.getElementById('est-client').value=selectedProject.clientName;
    document.getElementById('est-type').value=initType;
    document.getElementById('est-site').value=selectedProject.address;
  }
  loadDefaultSectionsForType(initType);
  renderPresetDatalists();
  estDirty=false;
  updateEstBadge();renderSections();estSubTab('info');
  renderProjectSidebar();
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
  sv('est-start-date',est.startDate);sv('est-end-date',est.endDate);
  sv('est-client',est.clientName);sv('est-client-address',est.clientAddress);sv('est-tantou',est.tantou);sv('est-project',est.projectName);sv('est-site',est.siteName);sv('est-note',est.note);
  sv('discount-amount',est.discountAmount);sv('tax-rate',est.taxRate);
  const pays=est.payments||[];
  sv('est-contract-date',est.contractDate);payAmtLoad('est-contract-amount',est.contractAmount);
  const ex=est.extras||[];
  sv('est-extra1-date',ex[0]?.date);payAmtLoad('est-extra1-amount',ex[0]?.amount);
  sv('est-extra2-date',ex[1]?.date);payAmtLoad('est-extra2-amount',ex[1]?.amount);
  sv('est-extra3-date',ex[2]?.date);payAmtLoad('est-extra3-amount',ex[2]?.amount);
  sv('est-pay1-date',pays[0]?.date);payAmtLoad('est-pay1-amount',pays[0]?.amount);sv('est-pay1-actual-date',pays[0]?.actualDate);payAmtLoad('est-pay1-actual-amount',pays[0]?.actualAmount);
  sv('est-pay2-date',pays[1]?.date);payAmtLoad('est-pay2-amount',pays[1]?.amount);sv('est-pay2-actual-date',pays[1]?.actualDate);payAmtLoad('est-pay2-actual-amount',pays[1]?.actualAmount);
  sv('est-pay3-date',pays[2]?.date);payAmtLoad('est-pay3-amount',pays[2]?.amount);sv('est-pay3-actual-date',pays[2]?.actualDate);payAmtLoad('est-pay3-actual-amount',pays[2]?.actualAmount);
  sections=est.sections.map(s=>({...s,items:[...s.items]}));
  secSeq=Math.max(secSeq,...sections.map(s=>s.id))+1;
  itemSeq=Math.max(itemSeq,1,...sections.flatMap(s=>s.items.map(i=>i.id)))+1;
  renderPresetDatalists();
  estDirty=false;
  updateEstBadge();renderSections();estSubTab('info');
  selectedProjectName = est.projectName || null;
  selectedProject = projects.find(p=>p.name===est.projectName)||null;
  renderProjectSidebar();
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
  const label={'':'全て','draft':'下書き','sent':'提出済み','approved':'受注','completed':'完工'}[s]||'全て';
  document.querySelectorAll('.sf-btn').forEach(b=>b.classList.toggle('active',b.textContent.trim()===label));
  renderProjectSidebar();
}

function renderProjectSidebar(){
  const kw=(document.getElementById('est-sidebar-search')?.value||'').trim().toLowerCase();

  // モバイル用セレクト（全件）
  const msel=document.getElementById('est-sidebar-mobile-select');
  if(msel){
    msel.innerHTML='<option value="">案件を選択...</option>'+
      projects.map(p=>`<option value="${p.id}"${selectedProject?.id===p.id?' selected':''}>${esc(p.name)}${p.clientName?'（'+esc(p.clientName)+'）':''}</option>`).join('');
  }

  // デスクトップ用サイドバーリスト
  const el=document.getElementById('est-project-sidebar-list');
  if(!el) return;
  let list=projects;
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
  else renderProjectSidebar();
  renderEstListBody();
  onProjectChanged && onProjectChanged();
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
        <div class="li-meta">${e.no} · ${e.type} · ${e.date||'日付未設定'} <span class="badge ${e.status}" style="margin-left:4px">${e.status==='draft'?'下書き':e.status==='sent'?'提出済み':e.status==='approved'?'受注':'完工'}</span></div>
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
