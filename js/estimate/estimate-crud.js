// ════ 見積：保存・新規作成・読み込み・一覧 ════

function collectEstData(){
  const v=id=>document.getElementById(id).value;
  return {id:editingEstId||Date.now(),no:v('est-no'),date:v('est-date'),expire:v('est-expire'),status:v('est-status'),type:v('est-type'),duration:v('est-duration'),clientName:v('est-client'),siteName:v('est-site'),note:v('est-note'),sections:sections.map(s=>({...s,items:[...s.items]})),miscRate:parseFloat(v('misc-rate'))||5,taxRate:parseFloat(v('tax-rate'))||10};
}

function saveEstimate(){
  const data=collectEstData();
  if(editingEstId){const i=estimates.findIndex(e=>e.id===editingEstId);if(i>=0)estimates[i]=data;}
  else{editingEstId=data.id;estimates.unshift(data);}
  updateEstBadge();
  alert('保存しました：'+(data.siteName||data.no||'無題'));
}

function newEstimate(){
  editingEstId=null;
  ['est-no','est-date','est-expire','est-duration','est-client','est-site','est-note'].forEach(id=>document.getElementById(id).value='');
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
  sv('est-no',est.no);sv('est-date',est.date);sv('est-expire',est.expire);sv('est-status',est.status);sv('est-type',est.type);sv('est-duration',est.duration);sv('est-client',est.clientName);sv('est-site',est.siteName);sv('est-note',est.note);sv('misc-rate',est.miscRate);sv('tax-rate',est.taxRate);
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
        <div class="li-name">${e.siteName||e.no||'無題の見積'}</div>
        <div class="li-meta">${e.no} · ${e.type} · ${e.date||'日付未設定'} <span class="badge ${e.status}" style="margin-left:4px">${e.status==='draft'?'下書き':e.status==='sent'?'提出済み':'受注'}</span></div>
      </div>
      <div class="li-amt">¥${fmt(calcEstTotal(e))}</div>
    </div>`).join(''):'<div class="empty">保存された見積はありません</div>';
  document.getElementById('est-list-overlay').classList.add('open');
}
function closeEstList(){document.getElementById('est-list-overlay').classList.remove('open');}
