// ════ 案件一覧（全案件の一覧・絞り込み・A3印刷） ════
//
// 案件（projects）を1行ずつ表示し、その案件の最新の見積から金額や入金の情報を出す。
// 見積がまだ無い案件も「案件」として並ぶ（金額欄は空）。
// 行をタップするとその案件を開き、案件タブで詳細を編集できる。

// 絞り込みの状態
let olFilterStatus = '';   // ''＝すべて / draft / sent / approved / completed
let olFilterType   = '';   // ''＝すべて / 新築 / リフォーム …
let olFilterFY     = '';   // ''＝すべて / '2026'（2026年度＝2026/3/1〜2027/2/末）
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
  const endDate = e.endDate || p.endDate || '';
  return {
    project:p, est:e,
    status: e.status || 'draft',
    type: p.type || e.type || '',
    endDate,
    fy: olFiscalYear(endDate)
  };
}

// 絞り込み後の一覧（契約日順）
function olVisibleRows(){
  return (projects||[]).map(olRowData)
    .filter(r=>{
      if(olFilterStatus && r.status!==olFilterStatus) return false;
      if(olFilterType   && r.type!==olFilterType) return false;
      if(olFilterFY     && String(r.fy)!==olFilterFY) return false;
      return true;
    })
    .sort((a,b)=>{
      const ka=(a.est.contractDate||a.est.date||a.project.startDate||'');
      const kb=(b.est.contractDate||b.est.date||b.project.startDate||'');
      return ka<kb ? -1 : ka>kb ? 1 : 0;
    });
}

const OL_STATUS = {
  draft:    {label:'下書き', cls:'draft'},
  sent:     {label:'提出済', cls:'sent'},
  approved: {label:'受注',   cls:'approved'},
  completed:{label:'完工',   cls:'completed'}
};

// 絞り込みの選択肢を作る
function renderOlFilters(){
  const rows=(projects||[]).map(olRowData);
  // 工事区分
  const types=[...new Set(rows.map(r=>r.type).filter(Boolean))];
  const tSel=document.getElementById('ol-filter-type');
  if(tSel){
    tSel.innerHTML='<option value="">工事区分：すべて</option>'+
      types.map(t=>`<option value="${esc(t)}"${olFilterType===t?' selected':''}>${esc(t)}</option>`).join('');
  }
  // 完工年度
  const fys=[...new Set(rows.map(r=>r.fy).filter(v=>v!=null))].sort((a,b)=>b-a);
  const fSel=document.getElementById('ol-filter-fy');
  if(fSel){
    fSel.innerHTML='<option value="">完工年度：すべて</option>'+
      fys.map(y=>`<option value="${y}"${olFilterFY===String(y)?' selected':''}>${y}年度（${y}/3〜${y+1}/2）</option>`).join('');
  }
  const sSel=document.getElementById('ol-filter-status');
  if(sSel) sSel.value=olFilterStatus;
}

function olSetFilter(){
  olFilterStatus=document.getElementById('ol-filter-status').value;
  olFilterType  =document.getElementById('ol-filter-type').value;
  olFilterFY    =document.getElementById('ol-filter-fy').value;
  renderOrdersList();
}
function olClearFilter(){
  olFilterStatus=''; olFilterType=''; olFilterFY='';
  renderOrdersList();
}

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
    el.innerHTML='<tr><td colspan="27" style="padding:20px;text-align:center;color:var(--text-muted)">該当する案件がありません</td></tr>';
    renderOrdersTotals([]);
    return;
  }

  el.innerHTML = list.map((r,i)=>{
    const e=r.est, p=r.project;
    const ca   = e.contractAmount||0;
    const comp = e.completion||0;
    const dekidaka = Math.round(ca * comp / 100);
    const pays = e.payments||[];
    const a1 = pays[0]?.actualAmount||0;
    const a2 = pays[1]?.actualAmount||0;
    const a3 = pays[2]?.actualAmount||0;
    const kaishuu = a1+a2+a3;
    const mishuu  = ca - kaishuu;
    const secs = e.sections||[];
    const sectTotal = secs.reduce((t,s)=>t+s.items.reduce((s2,i)=>s2+i.qty*i.price,0),0);
    const sectCost  = secs.reduce((t,s)=>t+s.items.reduce((s2,i)=>s2+i.qty*i.cost,0),0);
    const epAmt= sectTotal - sectCost;
    const epr  = sectTotal > 0 ? epAmt/sectTotal*100 : 0;
    const apAmt= e.actualProfit||0;
    const apRate = ca ? (apAmt/ca*100) : 0;
    const extras = e.extras||[];
    const totalCa = ca + (extras[0]?.amount||0) + (extras[1]?.amount||0) + (extras[2]?.amount||0);

    const st=OL_STATUS[r.status]||OL_STATUS.draft;
    const badge=`<span class="badge ${st.cls}" style="font-size:9px;padding:1px 5px">${st.label}</span>`;
    // 見積の無い案件は、編集欄を出さずに空欄にする
    const hasEst=!!e.id;

    return `<tr class="ol-row status-${r.status}">
      <td class="ol-no">${i+1}</td>
      <td class="ol-c">${e.contractDate||''}</td>
      <td class="ol-c" style="white-space:nowrap">${esc(e.clientName||p.clientName||'')}</td>
      <td class="ol-c ol-name" onclick="olOpenProject(${p.id})" title="タップして案件を開く"
          style="cursor:pointer;color:var(--accent-t);font-weight:600">${esc(p.name)} ${badge}</td>
      <td class="ol-c" style="text-align:center">${esc(r.type||'')}</td>
      <td class="ol-r">${hasEst?'¥'+fmt(totalCa):''}</td>
      <td class="ol-c">${e.startDate||p.startDate||''}</td>
      <td class="ol-c" style="text-align:center;padding:2px 0;color:var(--text-muted)">〜</td>
      <td class="ol-c">${r.endDate||''}</td>
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
      <td class="ol-c" style="font-size:10px">${pays[0]?.actualDate||''}</td>
      <td class="ol-r">${hasEst?'¥'+fmt(a1):''}</td>
      <td class="ol-c" style="font-size:10px">${pays[1]?.actualDate||''}</td>
      <td class="ol-r">${hasEst?'¥'+fmt(a2):''}</td>
      <td class="ol-c" style="font-size:10px">${pays[2]?.actualDate||''}</td>
      <td class="ol-r">${hasEst?'¥'+fmt(a3):''}</td>
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
      <td class="ol-c ol-op" style="text-align:center;white-space:nowrap">
        <button class="btn xs" onclick="olOpenProject(${p.id})">開く</button>
        <button class="btn xs danger" onclick="olDeleteProject(${p.id},event)">削除</button>
      </td>
    </tr>`;
  }).join('');

  renderOrdersTotals(list.map(r=>r.est).filter(e=>e && e.id));
}


function renderOrdersTotals(list){
  const el = document.getElementById('orders-list-totals');
  if(!el) return;
  const totCa     = list.reduce((s,e)=>{
    const ex=e.extras||[];
    return s+(e.contractAmount||0)+(ex[0]?.amount||0)+(ex[1]?.amount||0)+(ex[2]?.amount||0);
  },0);
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
    <td colspan="6" style="padding:4px 6px"></td>
    <td class="ol-r">¥${fmt(totEpAmt)}</td>
    <td class="ol-r">${totEpRate}%</td>
    <td class="ol-r">¥${fmt(totApAmt)}</td>
    <td class="ol-r">${totApRate}%</td>
    <td class="ol-memo"></td>
    <td class="ol-op"></td>
  </tr>`;
}

function printOrdersList(){
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

  // colgroup: 22列分の幅を明示（合計 ≈ 1048pt、A3横1147ptに収まる）
  const colWidths = [14,44,65,100,38,65,42,8,42,28,60,60,60,40,52,40,52,40,52,60,32,60,32];
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
  if(olFilterStatus) parts.push(OL_STATUS[olFilterStatus]?.label||olFilterStatus);
  if(olFilterType)   parts.push(olFilterType);
  if(olFilterFY)     parts.push(`${olFilterFY}年度完工`);
  return parts.length ? `　［${parts.join('／')}］` : '';
}

// ════ カード表示（案件名・ステータス・工事区分・写真が一目で分かる） ════

// 案件の表紙写真（現場写真の最新の1枚）。無ければ null
function olCoverPhoto(projectId){
  const list=(typeof sitePhotos!=='undefined'?sitePhotos:[]).filter(p=>p.projectId===projectId);
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
  const start=(e.startDate||p.startDate||'').replace(/-/g,'/');
  const end=(r.endDate||'').replace(/-/g,'/');
  const period = start||end ? `${start||'—'}　〜　${end||''}` : '';
  return `<div class="ol-card" onclick="olOpenProject(${p.id})" title="タップして案件を開く">
    <div class="ol-card-img">
      ${photo
        ? `<img src="${photo.url}" alt="${esc(p.name)}" loading="lazy">`
        : `<div class="ol-card-ph">${olTypeIcon(r.type)}<div class="ol-card-phtxt">${esc(r.type||'工事区分なし')}</div></div>`}
      <span class="ol-card-status badge ${st.cls}">${st.label}</span>
      ${r.type?`<span class="ol-card-type">${esc(r.type)}</span>`:''}
    </div>
    <div class="ol-card-body">
      <div class="ol-card-name">${esc(p.name)}</div>
      ${p.clientName?`<div class="ol-card-sub">${esc(p.clientName)}</div>`:''}
      ${period?`<div class="ol-card-date">${period}</div>`:''}
      <div class="ol-card-foot">
        ${e.contractAmount?`<span class="ol-card-amt">¥${fmt(e.contractAmount)}</span>`:'<span></span>'}
        <button class="btn xs danger" onclick="olDeleteProject(${p.id},event)">削除</button>
      </div>
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
  olView=v;
  try{ localStorage.setItem('teyose-ol-view', v); }catch(_){}
  renderOrdersList();
}
