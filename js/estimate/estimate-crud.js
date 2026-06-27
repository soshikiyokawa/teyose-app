// ════ 見積：保存・新規作成・読み込み・一覧 ════

function collectEstData(){
  const v=id=>document.getElementById(id).value;
  return {id:editingEstId||Date.now(),no:v('est-no'),date:v('est-date'),expire:v('est-expire'),status:v('est-status'),type:v('est-type'),
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
  if(editingEstId){const i=estimates.findIndex(e=>e.id===editingEstId);if(i>=0)estimates[i]=data;}
  else{estimates.unshift(data);}
  editingEstId = savedId;
  updateEstBadge();
  alert('保存しました：'+(data.projectName||data.siteName||data.no||'無題'));
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
  document.getElementById('est-no').value='E'+new Date().getFullYear()+'-'+String(estSeq++).padStart(3,'0');
  document.getElementById('est-date').value=new Date().toISOString().slice(0,10);
  loadDefaultSectionsForType('新築');
  updateEstBadge();renderSections();estSubTab('info');
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
  sv('est-no',est.no);sv('est-date',est.date);sv('est-expire',est.expire);sv('est-status',est.status);sv('est-type',est.type);
  sv('est-start-date',est.startDate);sv('est-end-date',est.endDate);
  sv('est-client',est.clientName);sv('est-project',est.projectName);sv('est-site',est.siteName);sv('est-note',est.note);
  sv('discount-amount',est.discountAmount);sv('tax-rate',est.taxRate);
  const pays=est.payments||[];
  sv('est-pay1-date',pays[0]?.date);sv('est-pay1-amount',pays[0]?.amount);
  sv('est-pay2-date',pays[1]?.date);sv('est-pay2-amount',pays[1]?.amount);
  sv('est-pay3-date',pays[2]?.date);sv('est-pay3-amount',pays[2]?.amount);
  sections=est.sections.map(s=>({...s,items:[...s.items]}));
  updateEstBadge();renderSections();estSubTab('info');
}

function calcEstTotal(e){
  const w=(e.sections||[]).reduce((t,s)=>t+s.items.reduce((s2,i)=>s2+i.qty*i.price,0),0);
  const sub=Math.max(0,w-(e.discountAmount||0));
  return sub+Math.round(sub*(e.taxRate||10)/100);
}

function showEstList(){
  const el=document.getElementById('est-list-body');
  el.innerHTML=estimates.length?estimates.map(e=>`
    <div class="list-item" onclick="loadEstimate(estimates.find(x=>x.id===${e.id}));closeEstList()">
      <div class="li-info">
        <div class="li-name">${e.projectName||e.siteName||e.no||'無題の見積'}</div>
        <div class="li-meta">${e.no} · ${e.type} · ${e.date||'日付未設定'} <span class="badge ${e.status}" style="margin-left:4px">${e.status==='draft'?'下書き':e.status==='sent'?'提出済み':'受注'}</span></div>
      </div>
      <div class="li-amt">¥${fmt(calcEstTotal(e))}</div>
    </div>`).join(''):'<div class="empty">保存された見積はありません</div>';
  document.getElementById('est-list-overlay').classList.add('open');
}
function closeEstList(){document.getElementById('est-list-overlay').classList.remove('open');}
