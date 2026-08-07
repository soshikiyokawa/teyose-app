// ════ 案件一覧（全案件の一覧・絞り込み・A3印刷） ════
//
// 案件（projects）を1行ずつ表示し、その案件の最新の見積から金額や入金の情報を出す。
// 見積がまだ無い案件も「案件」として並ぶ（金額欄は空）。
// 行をタップするとその案件を開き、案件タブで詳細を編集できる。

// 絞り込みの状態。それぞれ複数えらべる（空の配列＝すべて）
// 選んだ内容は端末に覚えさせるので、アプリを開き直しても元に戻らない
let olFilterStatus = [];   // draft / sent / approved / completed
let olFilterType   = [];   // 新築 / リフォーム …
let olFilterFY     = [];   // '2026'（2026年度＝2026/3/1〜2027/2/末）
let olFilterPay   = [];   // overdue（期日超過）／unpaid（未入金あり）／done（入金済み）
const OL_FILTER_KEY = 'teyose-ol-filter';
(()=>{
  try{
    const s=JSON.parse(localStorage.getItem(OL_FILTER_KEY)||'{}');
    const arr=v=>Array.isArray(v)?v.map(String):(v?[String(v)]:[]);
    olFilterStatus=arr(s.status); olFilterType=arr(s.type); olFilterFY=arr(s.fy); olFilterPay=arr(s.pay);
  }catch(_){}
})();
function olSaveFilter(){
  try{ localStorage.setItem(OL_FILTER_KEY, JSON.stringify({status:olFilterStatus, type:olFilterType, fy:olFilterFY, pay:olFilterPay})); }catch(_){}
}
// 表示：カード（写真つき一覧）／表（金額・入金まで見る一覧。A3印刷もこちら）
let olView = (()=>{ try{ return localStorage.getItem('teyose-ol-view')||'card'; }catch(_){ return 'card'; } })();

// 完工年度（毎年3月1日が新年度）。'2026-04-10' → 2026年度
function olFiscalYear(dateStr){
  if(!dateStr) return null;
  const [y,m] = dateStr.split('-').map(Number);
  if(!y||!m) return null;
  return m >= 3 ? y : y-1;
}

// 案件に紐づく代表の見積（いちばん新しく更新したもの）
function olEstimateOf(project){
  const list = (estimates||[]).filter(e=>e.projectName===project.name);
  if(!list.length) return null;
  return [...list].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0))[0];
}

// 画面に出す1件分の情報にまとめる
function olRowData(p){
  const e = olEstimateOf(p) || {};
  // 実績（着工日・引渡日）が入っていればそちらを使う
  const startDate = p.actualStartDate || e.startDate || p.startDate || '';
  const endDate   = p.handoverDate   || e.endDate   || p.endDate   || '';
  return {
    project:p, est:e,
    status: e.status || 'draft',
    type: p.type || e.type || '',
    startDate, endDate,
    startIsActual: !!p.actualStartDate,
    endIsActual:   !!p.handoverDate,
    fy: olFiscalYear(endDate)
  };
}

// 絞り込み後の一覧（契約日順）
function olVisibleRows(){
  return (projects||[]).map(olRowData)
    .filter(r=>{
      if(olFilterStatus.length && !olFilterStatus.includes(r.status)) return false;
      if(olFilterType.length   && !olFilterType.includes(r.type)) return false;
      if(olFilterFY.length     && !olFilterFY.includes(String(r.fy))) return false;
      if(olCanSeeMoney() && olFilterPay.length && !olFilterPay.includes(olPayKind(r.est))) return false;
      return true;
    })
    .sort((a,b)=>{
      const ka=(a.est.contractDate||a.est.date||a.project.startDate||'');
      const kb=(b.est.contractDate||b.est.date||b.project.startDate||'');
      return ka<kb ? -1 : ka>kb ? 1 : 0;
    });
}

// 施主名は案件（案件情報タブ）を優先し、入っていなければ見積のものを使う。
// カードと表で違う名前が出ないよう、どちらもこれを使う
function olClientName(r){
  return r.project?.clientName || r.est?.clientName || '';
}

// 請負金額＝契約情報の合計（請負契約＋追加契約①②③）。
// 見積情報の「契約情報」に出る合計と同じ数字を、カードにも表にも出す
function olContractTotal(est){
  const ex = est?.extras||[];
  return (Number(est?.contractAmount)||0)
    + (Number(ex[0]?.amount)||0) + (Number(ex[1]?.amount)||0) + (Number(ex[2]?.amount)||0);
}

// 請負金額と入金の状況は管理者だけに見せる
function olCanSeeMoney(){ return currentUserRole==='staff'; }

// ── 入金の状況（着工金・上棟時金・最終金の予定と実際の入金から） ──
// 予定日を過ぎているのに入金が予定額に届いていないものを「期日超過」とする
function olPayState(est){
  const pays=(est?.payments||[]).filter(p=>Number(p?.amount)>0);
  const today=insToday ? insToday() : new Date().toISOString().slice(0,10);
  let planned=0, received=0, overdue=0, nextDate='';
  pays.forEach(p=>{
    const amt=Number(p.amount)||0, act=Number(p.actualAmount)||0;
    planned+=amt; received+=act;
    const left=amt-act;
    if(left<=0) return;
    if(p.date && p.date<today) overdue+=left;
    else if(p.date && (!nextDate || p.date<nextDate)) nextDate=p.date;
  });
  // 予定を入れていない案件は、契約金額と入金合計で見る
  if(!pays.length){
    const ca=Number(est?.contractAmount)||0;
    const act=(est?.payments||[]).reduce((s,p)=>s+(Number(p?.actualAmount)||0),0);
    return {planned:ca, received:act, unpaid:Math.max(0,ca-act), overdue:0, nextDate:'', hasPlan:false};
  }
  return {planned, received, unpaid:Math.max(0,planned-received), overdue, nextDate, hasPlan:true};
}
// 入金をラベル（契約時金・着工金・上棟時金・最終金）で引けるようにする。
// ラベルが入っていない古いデータは、着工金から順に並んでいるものとして扱う
function olPaymentsByLabel(est){
  const list=(est?.payments||[]);
  const out={};
  if(list.length && !list.some(p=>p?.label)){
    ['着工金','上棟時金','最終金'].forEach((lb,i)=>{ if(list[i]) out[lb]=list[i]; });
    return out;
  }
  list.forEach(p=>{ if(p?.label) out[p.label]=p; });
  return out;
}

// 絞り込み用：この案件の入金の状態をひとことで
function olPayKind(est){
  const s=olPayState(est);
  if(!s.planned) return 'none';       // 金額が入っていない（絞り込みの対象外）
  if(s.overdue>0) return 'overdue';
  if(s.unpaid>0) return 'unpaid';
  return 'done';
}
function olPayBadge(est){
  const s=olPayState(est);
  if(!s.planned) return '';
  if(s.overdue>0)
    return `<span class="ol-pay over" title="入金予定日を過ぎています">未入金 ¥${fmt(s.overdue)}</span>`;
  if(s.unpaid>0)
    return `<span class="ol-pay wait" title="${s.nextDate?'入金予定 '+s.nextDate.replace(/-/g,'/'):'入金予定日は未設定'}">残 ¥${fmt(s.unpaid)}</span>`;
  return `<span class="ol-pay done">入金済</span>`;
}

const OL_STATUS = {
  draft:    {label:'下書き', cls:'draft'},
  sent:     {label:'提出済', cls:'sent'},
  approved: {label:'受注',   cls:'approved'},
  completed:{label:'完工',   cls:'completed'}
};

// 絞り込みの選択肢を作る（チェックを入れた分だけ表示する形）
function renderOlFilters(){
  const rows=(projects||[]).map(olRowData);
  const types=[...new Set(rows.map(r=>r.type).filter(Boolean))];
  const fys=[...new Set(rows.map(r=>r.fy).filter(v=>v!=null))].sort((a,b)=>b-a);
  // ステータス・完工年度は見積の情報。発注先には出さない
  if(olCanSeeMoney()){
    olRenderFilterBox('status','ステータス',
      Object.keys(OL_STATUS).map(k=>({value:k, label:OL_STATUS[k].label})), olFilterStatus);
    olRenderFilterBox('fy','完工年度',
      fys.map(y=>({value:String(y), label:`${y}年度（${y}/3〜${y+1}/2）`, short:`${y}年度`})), olFilterFY);
  }
  olRenderFilterBox('type','工事区分',
    types.map(t=>({value:t, label:t})), olFilterType);
  if(olCanSeeMoney()) olRenderFilterBox('pay','入金', [
    {value:'overdue', label:'期日を過ぎた未入金'},
    {value:'unpaid',  label:'未入金あり'},
    {value:'done',    label:'入金済み'}
  ], olFilterPay);
  // 何も選ばれていなければ「絞り込み解除」は目立たせない
  const clr=document.getElementById('ol-clear-filter');
  if(clr) clr.style.display = (olFilterStatus.length||olFilterType.length||olFilterFY.length||olFilterPay.length) ? '' : 'none';
}

// ひとつ分の絞り込み（ボタン＋チェックの一覧）
function olRenderFilterBox(key, title, options, selected){
  const box=document.getElementById('ol-filter-'+key);
  if(!box) return;
  const open = box.classList.contains('open');
  const picked = options.filter(o=>selected.includes(o.value));
  const label = !picked.length ? `${title}：すべて`
    : picked.length<=2 ? `${title}：${picked.map(o=>o.short||o.label).join('・')}`
    : `${title}：${picked.length}件`;
  box.innerHTML =
    `<button type="button" class="btn xs ol-filter-btn${picked.length?' primary':''}" onclick="olToggleFilterBox('${key}')">
       ${esc(label)}
       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="10" height="10" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
     </button>
     <div class="ol-filter-menu"${open?' style="display:block"':''}>
       ${options.length ? options.map(o=>`
         <label class="ol-filter-opt">
           <input type="checkbox" value="${esc(o.value)}"${selected.includes(o.value)?' checked':''}
                  onchange="olToggleFilter('${key}', this.value, this.checked)">
           <span>${esc(o.label)}</span>
         </label>`).join('')
        : '<div style="padding:8px 10px;font-size:11px;color:var(--text-muted)">選べるものがありません</div>'}
       ${picked.length?`<button type="button" class="btn xs" style="margin:6px 8px 8px;width:calc(100% - 16px)" onclick="olClearFilterOne('${key}')">この絞り込みを外す</button>`:''}
     </div>`;
  if(open) olPlaceFilterMenu(box);
}

function olFilterArr(key){
  return key==='status' ? olFilterStatus : key==='type' ? olFilterType : key==='fy' ? olFilterFY : olFilterPay;
}
function olToggleFilterBox(key){
  const box=document.getElementById('ol-filter-'+key);
  const willOpen = !box.classList.contains('open');
  olCloseFilterMenus();
  if(willOpen){
    box.classList.add('open');
    olPlaceFilterMenu(box);
  }
}
// 画面の右端からはみ出すときは右寄せにする
function olPlaceFilterMenu(box){
  const menu=box?.querySelector('.ol-filter-menu');
  if(!menu) return;
  menu.style.display='block';
  menu.style.left=''; menu.style.right='';
  if(menu.getBoundingClientRect().right > window.innerWidth-8){
    menu.style.left='auto'; menu.style.right='0';
  }
}
function olToggleFilter(key, value, on){
  const arr=olFilterArr(key);
  const i=arr.indexOf(value);
  if(on && i<0) arr.push(value);
  if(!on && i>=0) arr.splice(i,1);
  olSaveFilter();
  // openクラスは残るので、描き直しても開いたまま（続けてチェックを入れられる）
  renderOrdersList();
}
function olClearFilterOne(key){
  olFilterArr(key).length=0;
  olSaveFilter();
  renderOrdersList();
}
function olClearFilter(){
  olFilterStatus.length=0; olFilterType.length=0; olFilterFY.length=0; olFilterPay.length=0;
  olSaveFilter();
  renderOrdersList();
}
// 開いているメニューをすべて閉じる
function olCloseFilterMenus(){
  ['status','type','fy','pay'].forEach(k=>{
    const b=document.getElementById('ol-filter-'+k);
    if(!b) return;
    b.classList.remove('open');
    const m=b.querySelector('.ol-filter-menu');
    if(m){ m.style.display=''; m.style.left=''; m.style.right=''; }
  });
}
// 絞り込みの外を触ったら閉じる
document.addEventListener('click', e=>{
  if(e.target.closest?.('#ol-filter-status,#ol-filter-type,#ol-filter-fy,#ol-filter-pay')) return;
  olCloseFilterMenus();
});

// 一覧から案件を開く（同じ案件タブ内で「案件情報」に切り替えて詳細を表示）
function olOpenProject(id){
  const p=projects.find(x=>x.id===id);
  if(!p) return;
  mainTab('estimate');
  // 案件を読み込んでから案件情報タブへ（未保存の見積があれば確認が入る）
  selectProjectSidebar(id);
}

// 一覧から案件を削除する
async function olDeleteProject(id, ev){
  if(ev) ev.stopPropagation();
  const p=projects.find(x=>x.id===id);
  if(!p) return;
  const est=olEstimateOf(p);
  if(!confirm(`「${p.name}」を削除しますか？\n${est?'この案件の見積・発注書は残ります。\n':''}この操作は元に戻せません。`)) return;
  try{
    await dbDeleteProject(id);
    projects=projects.filter(x=>x.id!==id);
    if(selectedProject?.id===id){ selectedProject=null; selectedProjectName=null; }
    renderOrdersList();
    renderProjectSidebar();
    showToast('案件を削除しました');
  }catch(_){}
}

function renderOrdersList(){
  renderOlFilters();
  const list = olVisibleRows();

  // 金額・入金を含む表は管理者だけ。一般社員は常にカード表示にする
  if(!olCanSeeMoney()) olView='card';
  // 表示の切り替え（表はA3印刷に使うので、カード表示中も中身は作っておく）
  const cardWrap=document.getElementById('orders-card-wrap');
  const tableWrap=document.getElementById('orders-table-wrap');
  if(cardWrap)  cardWrap.style.display  = olView==='card'  ? '' : 'none';
  if(tableWrap) tableWrap.style.display = olView==='table' ? '' : 'none';
  document.querySelectorAll('.ol-view-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===olView));
  renderOlCards(list);

  const el = document.getElementById('orders-list-body');
  if(!el) return;

  const cnt=document.getElementById('ol-count');
  if(cnt) cnt.textContent = `${list.length}件${list.length!==(projects||[]).length?`（全${(projects||[]).length}件中）`:''}`;

  if(!list.length){
    el.innerHTML='<tr><td colspan="29" style="padding:20px;text-align:center;color:var(--text-muted)">該当する案件がありません</td></tr>';
    renderOrdersTotals([]);
    return;
  }

  el.innerHTML = list.map((r,i)=>{
    const e=r.est, p=r.project;
    const ca   = e.contractAmount||0;
    const comp = e.completion||0;
    const dekidaka = Math.round(ca * comp / 100);
    const pays = e.payments||[];
    const pl = olPaymentsByLabel(e);
    const kaishuu = pays.reduce((s2,p)=>s2+(Number(p?.actualAmount)||0),0);
    const mishuu  = ca - kaishuu;
    const secs = e.sections||[];
    const sectTotal = secs.reduce((t,s)=>t+s.items.reduce((s2,i)=>s2+i.qty*i.price,0),0);
    const sectCost  = secs.reduce((t,s)=>t+s.items.reduce((s2,i)=>s2+i.qty*i.cost,0),0);
    const epAmt= sectTotal - sectCost;
    const epr  = sectTotal > 0 ? epAmt/sectTotal*100 : 0;
    const apAmt= e.actualProfit||0;
    const apRate = ca ? (apAmt/ca*100) : 0;
    const totalCa = olContractTotal(e);

    const st=OL_STATUS[r.status]||OL_STATUS.draft;
    const badge=`<span class="badge ${st.cls}" style="font-size:9px;padding:1px 5px">${st.label}</span>`;
    // 見積の無い案件は、編集欄を出さずに空欄にする
    const hasEst=!!e.id;

    return `<tr class="ol-row status-${r.status}">
      <td class="ol-no">${i+1}</td>
      <td class="ol-c">${e.contractDate||''}</td>
      <td class="ol-c" style="white-space:nowrap">${esc(olClientName(r))}</td>
      <td class="ol-c ol-name" onclick="olOpenProject(${p.id})" title="タップして案件を開く"
          style="cursor:pointer;color:var(--accent-t);font-weight:600">${esc(p.name)} ${badge}</td>
      <td class="ol-c" style="text-align:center">${esc(r.type||'')}</td>
      <td class="ol-r">${hasEst?'¥'+fmt(totalCa):''}</td>
      <td class="ol-c">${r.startDate||''}${r.startIsActual?'<span style="font-size:9px;color:var(--ok-t)">（実績）</span>':''}</td>
      <td class="ol-c" style="text-align:center;padding:2px 0;color:var(--text-muted)">〜</td>
      <td class="ol-c">${r.endDate||''}${r.endIsActual?'<span style="font-size:9px;color:var(--ok-t)">（引渡）</span>':''}</td>
      <td class="ol-c" style="padding:2px 4px">
        ${hasEst?`<div style="display:flex;align-items:center;gap:2px;justify-content:flex-end">
          <input type="text" inputmode="numeric" value="${comp||''}" placeholder="0"
            data-est-id="${e.id}" data-field="completion"
            style="width:38px;text-align:right;font-size:11px;padding:2px 3px"
            onfocus="this.value=this.value.replace(/,/g,'')"
          ><span style="font-size:10px;color:var(--text-muted)">%</span>
        </div>`:''}
      </td>
      <td class="ol-r">${hasEst?'¥'+fmt(dekidaka):''}</td>
      <td class="ol-r">${hasEst?'¥'+fmt(kaishuu):''}</td>
      <td class="ol-r" style="color:${mishuu>0?'var(--danger)':'inherit'}">${hasEst?'¥'+fmt(mishuu):''}</td>
      <td class="ol-c" style="font-size:10px">${pl['契約時金']?.actualDate||''}</td>
      <td class="ol-r">${hasEst?'¥'+fmt(pl['契約時金']?.actualAmount||0):''}</td>
      <td class="ol-c" style="font-size:10px">${pl['着工金']?.actualDate||''}</td>
      <td class="ol-r">${hasEst?'¥'+fmt(pl['着工金']?.actualAmount||0):''}</td>
      <td class="ol-c" style="font-size:10px">${pl['上棟時金']?.actualDate||''}</td>
      <td class="ol-r">${hasEst?'¥'+fmt(pl['上棟時金']?.actualAmount||0):''}</td>
      <td class="ol-c" style="font-size:10px">${pl['最終金']?.actualDate||''}</td>
      <td class="ol-r">${hasEst?'¥'+fmt(pl['最終金']?.actualAmount||0):''}</td>
      <td class="ol-r">${hasEst?'¥'+fmt(epAmt):''}</td>
      <td class="ol-r">${hasEst?epr.toFixed(1)+'%':''}</td>
      <td class="ol-c" style="padding:2px 4px">
        ${hasEst?`<div style="display:flex;align-items:center;gap:2px;justify-content:flex-end">
          <input type="text" inputmode="numeric" value="${apAmt ? apAmt.toLocaleString('ja-JP') : ''}" placeholder="0"
            data-est-id="${e.id}" data-field="actualProfit"
            style="width:80px;text-align:right;font-size:11px;padding:2px 3px"
            onfocus="this.value=this.value.replace(/,/g,'')"
            onblur="this.value=this.value?(parseFloat(this.value.replace(/,/g,''))||0).toLocaleString('ja-JP'):''"
          ><span style="font-size:10px;color:var(--text-muted)">円</span>
        </div>`:''}
      </td>
      <td class="ol-r">${hasEst?apRate.toFixed(1)+'%':''}</td>
      <td class="ol-c ol-memo" ${hasEst?`contenteditable="true" spellcheck="false" data-est-id="${e.id}" data-field="ordersMemo"`:''}
        >${esc(e.ordersMemo||'')}</td>
    </tr>`;
  }).join('');

  renderOrdersTotals(list.map(r=>r.est).filter(e=>e && e.id));
}


function renderOrdersTotals(list){
  const el = document.getElementById('orders-list-totals');
  if(!el) return;
  const totCa     = list.reduce((s,e)=>s+olContractTotal(e),0);
  const totDeki   = list.reduce((s,e)=>s+Math.round((e.contractAmount||0)*(e.completion||0)/100),0);
  const totKai    = list.reduce((s,e)=>(s+(e.payments||[]).reduce((s2,p)=>s2+(p.actualAmount||0),0)),0);
  const totMi     = totCa - totKai;
  const totEpAmt  = list.reduce((s,e)=>{
    const secs=e.sections||[];
    const t=secs.reduce((t2,sec)=>t2+sec.items.reduce((s2,i)=>s2+i.qty*i.price,0),0);
    const c=secs.reduce((t2,sec)=>t2+sec.items.reduce((s2,i)=>s2+i.qty*i.cost,0),0);
    return s+(t-c);
  },0);
  const totSectTotal = list.reduce((s,e)=>{
    const secs=e.sections||[];
    return s+secs.reduce((t,sec)=>t+sec.items.reduce((s2,i)=>s2+i.qty*i.price,0),0);
  },0);
  const totEpRate = totSectTotal ? (totEpAmt/totSectTotal*100).toFixed(1) : '—';
  const totApAmt  = list.reduce((s,e)=>s+(e.actualProfit||0),0);
  const totApRate = totCa ? (totApAmt/totCa*100).toFixed(1) : '—';

  el.innerHTML = `<tr style="font-weight:700;background:var(--surface2);border-top:2px solid var(--border)">
    <td colspan="5" style="padding:5px 8px;text-align:center">合　　　計</td>
    <td class="ol-r">¥${fmt(totCa)}</td>
    <td colspan="4" style="padding:4px 6px"></td>
    <td class="ol-r">¥${fmt(totDeki)}</td>
    <td class="ol-r">¥${fmt(totKai)}</td>
    <td class="ol-r" style="color:${totMi>0?'var(--danger)':'inherit'}">¥${fmt(totMi)}</td>
    <td colspan="8" style="padding:4px 6px"></td>
    <td class="ol-r">¥${fmt(totEpAmt)}</td>
    <td class="ol-r">${totEpRate}%</td>
    <td class="ol-r">¥${fmt(totApAmt)}</td>
    <td class="ol-r">${totApRate}%</td>
    <td class="ol-memo"></td>
  </tr>`;
}

function printOrdersList(){
  if(!olCanSeeMoney()){ showToast('金額入りの一覧は管理者のみです'); return; }
  const src = document.getElementById('orders-table');
  if(!src) return;

  const tbl = src.cloneNode(true);

  // input → 値テキストに置換
  tbl.querySelectorAll('input').forEach(inp => {
    const span = document.createElement('span');
    span.textContent = inp.value;
    inp.replaceWith(span);
  });
  tbl.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));

  // 備考列を削除（.ol-memo のtd と ヘッダーの「備考」th のみ）
  tbl.querySelectorAll('.ol-memo, .ol-op').forEach(el => el.remove());
  tbl.querySelectorAll('th').forEach(th => { const t=th.textContent.trim(); if(t==='備考'||t==='操作') th.remove(); });

  // バッジを小さいテキストに置換
  tbl.querySelectorAll('.badge').forEach(b => {
    const t = document.createTextNode('[' + b.textContent + ']');
    b.replaceWith(t);
  });

  // 日付セルを短縮（YYYY-MM-DD → M/D）
  tbl.querySelectorAll('td').forEach(td => {
    td.innerHTML = td.innerHTML.replace(/(\d{4})-(\d{1,2})-(\d{1,2})/g,
      (_,y,m,d) => parseInt(m)+'/'+parseInt(d));
  });

  // colgroup: 各列の幅を明示（合計 ≈ 1138pt、A3横1147ptに収まる）
  // 入金は契約時金・着工金・上棟時金・最終金の4回分（日付34pt＋金額48pt）
  const colWidths = [14,44,65,100,38,65,42,8,42,28,60,60,60,34,48,34,48,34,48,34,48,60,32,60,32];
  const cg = document.createElement('colgroup');
  colWidths.forEach(w => {
    const c = document.createElement('col');
    c.style.width = w + 'pt';
    cg.appendChild(c);
  });
  const oldCg = tbl.querySelector('colgroup');
  if(oldCg) oldCg.replaceWith(cg); else tbl.prepend(cg);

  const date = new Date().toLocaleDateString('ja-JP');
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>案件一覧</title>
<style>
@page { size: A3 landscape; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Meiryo", "Yu Gothic", sans-serif; font-size: 6.5pt; }
h2 { font-size: 10pt; margin: 0 0 2mm; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { border: 0.4pt solid #888; padding: 1pt 2pt; overflow: hidden; word-break: break-all; vertical-align: middle; }
th { background: #dae3f3 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-weight: 700; text-align: center; font-size: 6pt; }
.ol-r { text-align: right; white-space: nowrap; }
.ol-c { text-align: left; }
.ol-no { text-align: center; color: #666; font-size: 5.5pt; }
tr:nth-child(even) td { background: #f5f5f5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
tfoot td { font-weight: 700; background: #e8e8e8 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style>
</head><body>
<h2>案件一覧　${date}${olFilterLabel()}</h2>
${tbl.outerHTML}
<script>window.onload=function(){ window.print(); setTimeout(()=>window.close(),800); }<\/script>
</body></html>`;

  const w = window.open('', '_blank', 'width=1200,height=800');
  if(!w){ showToast('ポップアップをブロックされています。許可してください'); return; }
  w.document.write(html);
  w.document.close();
}

async function saveOrdersList(){
  if(!olCanSeeMoney()){ showToast('金額入りの一覧は管理者のみです'); return; }
  const table = document.getElementById('orders-table');
  if(!table) return;
  const changes = {};
  table.querySelectorAll('[data-est-id][data-field]').forEach(el=>{
    const id = parseInt(el.dataset.estId);
    const field = el.dataset.field;
    if(!changes[id]) changes[id] = {};
    if(el.tagName === 'TD'){
      changes[id][field] = el.textContent.trim();
    } else {
      const raw = el.value.replace(/,/g,'');
      changes[id][field] = field==='completion' ? (parseFloat(raw)||0) : (parseFloat(raw)||0);
    }
  });
  const ids = Object.keys(changes);
  if(!ids.length){ showToast('保存するデータがありません'); return; }
  let ok = true;
  for(const id of ids){
    const est = estimates.find(e=>e.id===parseInt(id));
    if(!est) continue;
    Object.assign(est, changes[id]);
    try{ await dbSaveEstimate(est); } catch(_){ ok=false; }
  }
  if(ok) showToast('受注一覧を保存しました');
  renderOrdersList();
}

async function saveOlField(estId, field, value){
  const est = estimates.find(e=>e.id===estId);
  if(!est) return;
  est[field] = value;
  try{ await dbSaveEstimate(est); } catch(_){}
  renderOrdersList();
}

// 印刷の見出しに出す絞り込み条件
function olFilterLabel(){
  const parts=[];
  // 選んだ順ではなく、いつもの並び（下書き→提出済→受注→完工／年度は新しい順）で書く
  if(olFilterStatus.length) parts.push(Object.keys(OL_STATUS).filter(k=>olFilterStatus.includes(k)).map(k=>OL_STATUS[k].label).join('・'));
  if(olFilterType.length)   parts.push([...olFilterType].join('・'));
  if(olFilterFY.length)     parts.push([...olFilterFY].sort((a,b)=>b-a).join('・')+'年度完工');
  return parts.length ? `　［${parts.join('／')}］` : '';
}

// ════ カード表示（案件名・ステータス・工事区分・写真が一目で分かる） ════

// 案件の表紙写真。写真ビューアで「表紙にする」を選んだ1枚を優先し、
// 未設定なら現場写真の最新の1枚を使う。無ければ null
function olCoverPhoto(projectId){
  const all=(typeof sitePhotos!=='undefined'?sitePhotos:[]);
  const proj=(projects||[]).find(p=>p.id===projectId);
  if(proj?.coverPhotoId){
    const fixed=all.find(p=>p.id===proj.coverPhotoId);
    if(fixed) return fixed;
  }
  const list=all.filter(p=>p.projectId===projectId);
  if(!list.length) return null;
  // 撮影日 → 登録順で最新のもの
  return [...list].sort((a,b)=>(b.shotDate||'').localeCompare(a.shotDate||'') || (b.id-a.id))[0];
}

// 工事区分ごとのアイコン（写真が無いときの表紙）
function olTypeIcon(type){
  const mansion = /マンション|アパート|集合/.test(type||'');
  return mansion
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" width="52" height="52">
         <rect x="4" y="3" width="16" height="18" rx="1"/><line x1="8" y1="7" x2="8" y2="7.01"/><line x1="12" y1="7" x2="12" y2="7.01"/>
         <line x1="16" y1="7" x2="16" y2="7.01"/><line x1="8" y1="11" x2="8" y2="11.01"/><line x1="12" y1="11" x2="12" y2="11.01"/>
         <line x1="16" y1="11" x2="16" y2="11.01"/><line x1="8" y1="15" x2="8" y2="15.01"/><line x1="16" y1="15" x2="16" y2="15.01"/>
         <path d="M10.5 21v-4h3v4"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" width="52" height="52">
         <path d="M3 11l9-7 9 7"/><path d="M5 10v11h14V10"/><path d="M10 21v-6h4v6"/>
         <line x1="8" y1="13" x2="8" y2="13.01"/><line x1="16" y1="13" x2="16" y2="13.01"/></svg>`;
}

function olCardHtml(r){
  const p=r.project, e=r.est;
  const st=OL_STATUS[r.status]||OL_STATUS.draft;
  const photo=olCoverPhoto(p.id);
  const start=(r.startDate||'').replace(/-/g,'/');
  const end=(r.endDate||'').replace(/-/g,'/');
  const period = start||end ? `${start||'—'}　〜　${end||''}` : '';
  return `<div class="ol-card" onclick="olOpenProject(${p.id})" title="タップして案件を開く">
    <div class="ol-card-img">
      ${photo
        ? `<img src="${photo.url}" alt="${esc(p.name)}" loading="lazy">`
        : `<div class="ol-card-ph">${olTypeIcon(r.type)}<div class="ol-card-phtxt">${esc(r.type||'工事区分なし')}</div></div>`}
      ${olCanSeeMoney()?`<span class="ol-card-status badge ${st.cls}">${st.label}</span>`:''}
      ${r.type?`<span class="ol-card-type">${esc(r.type)}</span>`:''}
    </div>
    <!-- 中身が空でも欄は残す。カードごとに項目の位置がずれないようにするため -->
    <div class="ol-card-body">
      <div class="ol-card-name">${esc(p.name)}</div>
      <div class="ol-card-sub">${esc(olClientName(r))||'&nbsp;'}</div>
      <div class="ol-card-date">${period||'&nbsp;'}</div>
      ${olCanSeeMoney()?`<div class="ol-card-foot">${olContractTotal(e)
        ? `<span class="ol-card-amt">¥${fmt(olContractTotal(e))}</span>${olPayBadge(e)}`
        : `<span class="ol-card-amt" style="color:var(--text-muted);font-weight:400">金額未入力</span>`}</div>`:''}
    </div>
  </div>`;
}

function renderOlCards(list){
  const el=document.getElementById('orders-card-grid');
  if(!el) return;
  el.innerHTML = list.length
    ? list.map(olCardHtml).join('')
    : '<div class="empty" style="padding:24px;grid-column:1/-1">該当する案件がありません</div>';
}

// カード／表の切り替え
function olSetView(v){
  if(v==='table' && !olCanSeeMoney()) return;   // 表は金額・入金を含むので管理者のみ
  olView=v;
  try{ localStorage.setItem('teyose-ol-view', v); }catch(_){}
  renderOrdersList();
}
