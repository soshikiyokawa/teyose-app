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
    sections:sections.map(s=>({...s,items:[...s.items]})),miscRate:parseFloat(v('misc-rate'))||5,taxRate:parseFloat(v('tax-rate'))||10};
}

function saveEstimate(){
  const data=collectEstData();
  if(editingEstId){const i=estimates.findIndex(e=>e.id===editingEstId);if(i>=0)estimates[i]=data;}
  else{editingEstId=data.id;estimates.unshift(data);}
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
  document.getElementById('misc-rate').value='5';
  document.getElementById('tax-rate').value='10';
  document.getElementById('est-no').value='E'+new Date().getFullYear()+'-'+String(estSeq++).padStart(3,'0');
  document.getElementById('est-date').value=new Date().toISOString().slice(0,10);
  sections=[];updateEstBadge();renderSections();estSubTab('info');
}

function loadEstimate(est){
  editingEstId=est.id;
  const sv=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||'';};
  sv('est-no',est.no);sv('est-date',est.date);sv('est-expire',est.expire);sv('est-status',est.status);sv('est-type',est.type);
  sv('est-start-date',est.startDate);sv('est-end-date',est.endDate);
  sv('est-client',est.clientName);sv('est-project',est.projectName);sv('est-site',est.siteName);sv('est-note',est.note);
  sv('misc-rate',est.miscRate);sv('tax-rate',est.taxRate);
  const pays=est.payments||[];
  sv('est-pay1-date',pays[0]?.date);sv('est-pay1-amount',pays[0]?.amount);
  sv('est-pay2-date',pays[1]?.date);sv('est-pay2-amount',pays[1]?.amount);
  sv('est-pay3-date',pays[2]?.date);sv('est-pay3-amount',pays[2]?.amount);
  sections=est.sections.map(s=>({...s,items:[...s.items]}));
  updateEstBadge();renderSections();estSubTab('info');
}

function calcEstTotal(e){
  const w=(e.sections||[]).reduce((t,s)=>t+s.items.reduce((s2,i)=>s2+i.qty*i.price,0),0);
  const misc=Math.round(w*(e.miscRate||5)/100);
  const sub=w+misc;
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
