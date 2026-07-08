// ════ 受注一覧 ════

function renderOrdersList(){
  const list = (estimates||[])
    .filter(e => e.status==='approved' || e.status==='sent' || e.status==='completed')
    .sort((a,b)=>((a.contractDate||a.date||'') < (b.contractDate||b.date||'') ? -1 : 1));

  const el = document.getElementById('orders-list-body');
  if(!el) return;

  if(!list.length){
    el.innerHTML='<tr><td colspan="26" style="padding:20px;text-align:center;color:var(--text-muted)">受注・提出済みの見積がありません</td></tr>';
    renderOrdersTotals([]);
    return;
  }

  el.innerHTML = list.map((e,i)=>{
    const ca   = e.contractAmount||0;
    const comp = e.completion||0;
    const dekidaka = Math.round(ca * comp / 100);
    const pays = e.payments||[];
    const a1 = pays[0]?.actualAmount||0;
    const a2 = pays[1]?.actualAmount||0;
    const a3 = pays[2]?.actualAmount||0;
    const kaishuu = a1+a2+a3;
    const mishuu  = ca - kaishuu;
    const zankin  = ca - a1 - a2 - a3;
    const secs = e.sections||[];
    const sectTotal = secs.reduce((t,s)=>t+s.items.reduce((s2,i)=>s2+i.qty*i.price,0),0);
    const sectCost  = secs.reduce((t,s)=>t+s.items.reduce((s2,i)=>s2+i.qty*i.cost,0),0);
    const epAmt= sectTotal - sectCost;
    const epr  = sectTotal > 0 ? epAmt/sectTotal*100 : 0;
    const apAmt= e.actualProfit||0;
    const apRate = ca ? (apAmt/ca*100) : 0;
    const extras = e.extras||[];
    const totalCa = ca
      + (extras[0]?.amount||0)
      + (extras[1]?.amount||0)
      + (extras[2]?.amount||0);

    const badge = e.status==='approved'
      ? '<span class="badge approved" style="font-size:9px;padding:1px 5px">受注</span>'
      : e.status==='completed'
        ? '<span class="badge completed" style="font-size:9px;padding:1px 5px">完工</span>'
        : '<span class="badge sent" style="font-size:9px;padding:1px 5px">提出済</span>';

    return `<tr class="ol-row status-${e.status}">
      <td class="ol-no">${i+1}</td>
      <td class="ol-c">${e.contractDate||''}</td>
      <td class="ol-c" style="white-space:nowrap">${esc(e.clientName||'')}</td>
      <td class="ol-c">${esc(e.projectName||'')} ${badge}</td>
      <td class="ol-r">¥${fmt(totalCa)}</td>
      <td class="ol-c">${e.startDate||''}</td>
      <td class="ol-c" style="text-align:center;padding:2px 0;color:var(--text-muted)">〜</td>
      <td class="ol-c">${e.endDate||''}</td>
      <td class="ol-c" style="padding:2px 4px">
        <div style="display:flex;align-items:center;gap:2px;justify-content:flex-end">
          <input type="text" inputmode="numeric" value="${comp||''}" placeholder="0"
            data-est-id="${e.id}" data-field="completion"
            style="width:38px;text-align:right;font-size:11px;padding:2px 3px"
            onfocus="this.value=this.value.replace(/,/g,'')"
          ><span style="font-size:10px;color:var(--text-muted)">%</span>
        </div>
      </td>
      <td class="ol-r">¥${fmt(dekidaka)}</td>
      <td class="ol-r">¥${fmt(kaishuu)}</td>
      <td class="ol-r" style="color:${mishuu>0?'var(--danger)':'inherit'}">¥${fmt(mishuu)}</td>
      <td class="ol-c" style="font-size:10px">${pays[0]?.actualDate||''}</td>
      <td class="ol-r">¥${fmt(a1)}</td>
      <td class="ol-c" style="font-size:10px">${pays[1]?.actualDate||''}</td>
      <td class="ol-r">¥${fmt(a2)}</td>
      <td class="ol-c" style="font-size:10px">${pays[2]?.actualDate||''}</td>
      <td class="ol-r">¥${fmt(a3)}</td>
      <td class="ol-r">${epr.toFixed(1)}%</td>
      <td class="ol-r">¥${fmt(epAmt)}</td>
      <td class="ol-c" style="padding:2px 4px">
        <div style="display:flex;align-items:center;gap:2px;justify-content:flex-end">
          <input type="text" inputmode="numeric" value="${apAmt ? apAmt.toLocaleString('ja-JP') : ''}" placeholder="0"
            data-est-id="${e.id}" data-field="actualProfit"
            style="width:80px;text-align:right;font-size:11px;padding:2px 3px"
            onfocus="this.value=this.value.replace(/,/g,'')"
            onblur="this.value=this.value?(parseFloat(this.value.replace(/,/g,''))||0).toLocaleString('ja-JP'):''"
          ><span style="font-size:10px;color:var(--text-muted)">円</span>
        </div>
      </td>
      <td class="ol-r">${apRate.toFixed(1)}%</td>
      <td class="ol-c ol-memo" contenteditable="true" spellcheck="false"
        data-est-id="${e.id}" data-field="ordersMemo"
        >${esc(e.ordersMemo||'')}</td>
    </tr>`;
  }).join('');

  renderOrdersTotals(list);
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
    <td colspan="4" style="padding:5px 8px;text-align:center">合　　　計</td>
    <td class="ol-r">¥${fmt(totCa)}</td>
    <td colspan="4" style="padding:4px 6px"></td>
    <td class="ol-r">¥${fmt(totDeki)}</td>
    <td class="ol-r">¥${fmt(totKai)}</td>
    <td class="ol-r" style="color:${totMi>0?'var(--danger)':'inherit'}">¥${fmt(totMi)}</td>
    <td colspan="6" style="padding:4px 6px"></td>
    <td class="ol-r">${totEpRate}%</td>
    <td class="ol-r">¥${fmt(totEpAmt)}</td>
    <td class="ol-r">¥${fmt(totApAmt)}</td>
    <td class="ol-r">${totApRate}%</td>
    <td></td>
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

  // 備考列（最終列）を削除
  tbl.querySelectorAll('tr').forEach(tr => {
    const cells = tr.querySelectorAll('th, td');
    if(cells.length) cells[cells.length - 1].remove();
  });

  // バッジを小さいテキストに置換
  tbl.querySelectorAll('.badge').forEach(b => {
    const t = document.createTextNode('[' + b.textContent + ']');
    b.replaceWith(t);
  });

  // colgroup: 22列分の幅を明示（合計 ≈ 1050pt、A3横1147ptに収まる）
  const colWidths = [14,44,56,88,56,42,8,42,28,54,54,54,40,50,40,50,40,50,28,54,54,28];
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
<title>受注一覧表</title>
<style>
@page { size: A3 landscape; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Meiryo", "Yu Gothic", sans-serif; font-size: 6.5pt; }
h2 { font-size: 10pt; margin: 0 0 2mm; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { border: 0.4pt solid #888; padding: 1pt 2pt; overflow: hidden; word-break: break-all; vertical-align: middle; }
th { background: #dae3f3 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-weight: 700; text-align: center; font-size: 6pt; }
.ol-r { text-align: right; }
.ol-c { text-align: left; }
.ol-no { text-align: center; color: #666; font-size: 5.5pt; }
tr:nth-child(even) td { background: #f5f5f5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
tfoot td { font-weight: 700; background: #e8e8e8 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style>
</head><body>
<h2>受注一覧表　${date}</h2>
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
