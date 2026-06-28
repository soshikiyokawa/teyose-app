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
    payments:[
      {label:'着工金',date:v('est-pay1-date'),amount:parseFloat(v('est-pay1-amount'))||0},
      {label:'上棟時金',date:v('est-pay2-date'),amount:parseFloat(v('est-pay2-amount'))||0},
      {label:'最終金',date:v('est-pay3-date'),amount:parseFloat(v('est-pay3-amount'))||0}
    ],
    sections:sections.map(s=>({...s,items:[...s.items]})),discountAmount:parseFloat(v('discount-amount'))||0,taxRate:parseFloat(v('tax-rate'))||10};
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

function newEstimate(){
  editingEstId=null;
  ['est-no','est-date','est-expire','est-start-date','est-end-date','est-client','est-project','est-site','est-note',
   'est-pay1-date','est-pay1-amount','est-pay2-date','est-pay2-amount','est-pay3-date','est-pay3-amount'
  ].forEach(id=>document.getElementById(id).value='');
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
  loadDefaultSectionsForType('新築');
  renderPresetDatalists();
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
  sv('est-client',est.clientName);sv('est-project',est.projectName);sv('est-site',est.siteName);sv('est-note',est.note);
  sv('discount-amount',est.discountAmount);sv('tax-rate',est.taxRate);
  const pays=est.payments||[];
  sv('est-pay1-date',pays[0]?.date);sv('est-pay1-amount',pays[0]?.amount);
  sv('est-pay2-date',pays[1]?.date);sv('est-pay2-amount',pays[1]?.amount);
  sv('est-pay3-date',pays[2]?.date);sv('est-pay3-amount',pays[2]?.amount);
  sections=est.sections.map(s=>({...s,items:[...s.items]}));
  renderPresetDatalists();
  updateEstBadge();renderSections();estSubTab('info');
  selectedProjectName = est.projectName || null;
  renderProjectSidebar();
}

function calcEstTotal(e){
  const w=(e.sections||[]).reduce((t,s)=>t+s.items.reduce((s2,i)=>s2+i.qty*i.price,0),0);
  const sub=Math.max(0,w-(e.discountAmount||0));
  return sub+Math.round(sub*(e.taxRate||10)/100);
}

// トップバーの「物件選択」（発注書に記録する物件名）を、登録済みの案件名から動的に表示する
function renderGlobalProjectSelect(){
  const sel=document.getElementById('g-project');
  if(!sel) return;
  const cur=sel.value;
  const names=[...new Set(estimates.map(e=>e.projectName).filter(Boolean))]
    .sort((a,b)=>{
      const la=Math.max(...estimates.filter(e=>e.projectName===a).map(e=>e.updatedAt?new Date(e.updatedAt).getTime():0));
      const lb=Math.max(...estimates.filter(e=>e.projectName===b).map(e=>e.updatedAt?new Date(e.updatedAt).getTime():0));
      return lb-la;
    });
  sel.innerHTML = names.length
    ? names.map(n=>`<option>${esc(n)}</option>`).join('')
    : '<option>物件未選択</option>';
  if(names.includes(cur)) sel.value=cur;
}

// ── 左サイドバー：案件一覧（物件名でグループ化、更新の新しい順） ──
function renderProjectSidebar(){
  renderGlobalProjectSelect();
  const el=document.getElementById('est-project-sidebar-list');
  if(!el) return;
  const kw=(document.getElementById('est-sidebar-search')?.value||'').trim().toLowerCase();
  const groups={};
  estimates.forEach(e=>{
    const name=e.projectName||'（物件名未設定）';
    const t=e.updatedAt?new Date(e.updatedAt).getTime():0;
    if(!groups[name]) groups[name]={latest:t,count:0,clientNames:new Set()};
    groups[name].count++;
    if(e.clientName) groups[name].clientNames.add(e.clientName);
    if(t>groups[name].latest) groups[name].latest=t;
  });
  let list=Object.keys(groups).map(name=>({name,...groups[name]})).sort((a,b)=>b.latest-a.latest);
  if(kw){
    list=list.filter(g=>g.name.toLowerCase().includes(kw) || [...g.clientNames].some(c=>c.toLowerCase().includes(kw)));
  }
  if(!list.length){el.innerHTML='<div class="empty" style="padding:10px;font-size:12px">該当する案件がありません</div>';return;}
  el.innerHTML=list.map(g=>`
    <div onclick="selectProjectSidebar('${g.name.replace(/'/g,"\\'")}')"
      style="padding:8px 10px;font-size:12px;cursor:pointer;border-radius:6px;margin:2px 8px;${selectedProjectName===g.name?'background:var(--wood);color:#fff;font-weight:700':'color:var(--text-sub)'}">
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.name)}</div>
      <div style="font-size:10px;opacity:.75;margin-top:1px">${g.count}件</div>
    </div>`).join('');
}

function filterProjectSidebar(){ renderProjectSidebar(); }

// 案件を選択したら、その案件の最新の見積情報を案件情報タブに読み込んで表示する
function selectProjectSidebar(name){
  selectedProjectName = name;
  const matches=estimates.filter(e=>(e.projectName||'（物件名未設定）')===name);
  matches.sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0));
  if(matches.length) loadEstimate(matches[0]);
  else renderProjectSidebar();
}

function showEstList(){
  const typeSel=document.getElementById('est-list-type-filter');
  typeSel.innerHTML='<option value="">区分：全て</option>'+estimateTypes.map(t=>`<option>${esc(t.name)}</option>`).join('');
  renderEstListBody();
  document.getElementById('est-list-overlay').classList.add('open');
}

function filterEstList(){ renderEstListBody(); }

function clearProjectFilterInList(){
  selectedProjectName=null;
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
    <div class="list-item" onclick="loadEstimate(estimates.find(x=>x.id===${e.id}));closeEstList()">
      <div class="li-info">
        <div class="li-name">${e.title||e.projectName||e.siteName||e.no||'無題の見積'}</div>
        <div class="li-meta">${e.no} · ${e.type} · ${e.date||'日付未設定'} <span class="badge ${e.status}" style="margin-left:4px">${e.status==='draft'?'下書き':e.status==='sent'?'提出済み':'受注'}</span></div>
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
