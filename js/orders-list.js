// ════ 受注一覧 ════

function renderOrdersList(){
  const list = (estimates||[])
    .filter(e => e.status==='approved' || e.status==='sent')
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
    const epr  = e.estProfitRate||0;
    const epAmt= Math.round(ca * epr / 100);
    const apAmt= e.actualProfit||0;
    const apRate = ca ? (apAmt/ca*100) : 0;
    const extras = e.extras||[];
    const totalCa = ca
      + (extras[0]?.amount||0)
      + (extras[1]?.amount||0)
      + (extras[2]?.amount||0);

    const badge = e.status==='approved'
      ? '<span class="badge approved" style="font-size:9px;padding:1px 5px">受注</span>'
      : '<span class="badge sent" style="font-size:9px;padding:1px 5px">提出済</span>';

    return `<tr class="ol-row">
      <td class="ol-no">${i+1}</td>
      <td class="ol-c">${e.contractDate||''}</td>
      <td class="ol-c" style="white-space:nowrap">${esc(e.clientName||'')}</td>
      <td class="ol-c">${esc(e.projectName||'')} ${badge}</td>
      <td class="ol-r">¥${fmt(totalCa)}</td>
      <td class="ol-c" style="white-space:nowrap;font-size:10px">${e.startDate||''}〜${e.endDate||''}</td>
      <td class="ol-c" style="padding:2px 4px">
        <div style="display:flex;align-items:center;gap:2px;justify-content:flex-end">
          <input type="text" inputmode="numeric" value="${comp||''}" placeholder="0"
            style="width:38px;text-align:right;font-size:11px;padding:2px 3px"
            onfocus="this.value=this.value.replace(/,/g,'')"
            onblur="saveOlField(${e.id},'completion',parseFloat(this.value)||0);this.value=parseFloat(this.value)||0"
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
      <td class="ol-r" style="color:${zankin>0?'var(--danger)':'var(--success,#4a9)'}">¥${fmt(zankin)}</td>
      <td class="ol-c" style="padding:2px 4px">
        <div style="display:flex;align-items:center;gap:2px;justify-content:flex-end">
          <input type="text" inputmode="numeric" value="${epr||''}" placeholder="0"
            style="width:38px;text-align:right;font-size:11px;padding:2px 3px"
            onfocus="this.value=this.value.replace(/,/g,'')"
            onblur="saveOlField(${e.id},'estProfitRate',parseFloat(this.value)||0);this.value=parseFloat(this.value)||0"
          ><span style="font-size:10px;color:var(--text-muted)">%</span>
        </div>
      </td>
      <td class="ol-r">¥${fmt(epAmt)}</td>
      <td class="ol-c" style="padding:2px 4px">
        <div style="display:flex;align-items:center;gap:2px;justify-content:flex-end">
          <input type="text" inputmode="numeric" value="${apAmt||''}" placeholder="0"
            style="width:80px;text-align:right;font-size:11px;padding:2px 3px"
            onfocus="this.value=this.value.replace(/,/g,'')"
            onblur="saveOlField(${e.id},'actualProfit',parseFloat(this.value)||0);this.value=(parseFloat(this.value)||0).toLocaleString('ja-JP')"
          ><span style="font-size:10px;color:var(--text-muted)">円</span>
        </div>
      </td>
      <td class="ol-r">${apRate.toFixed(1)}%</td>
      <td class="ol-c ol-memo" contenteditable="true" spellcheck="false"
        onblur="saveOlField(${e.id},'ordersMemo',this.textContent.trim())"
        >${esc(e.ordersMemo||'')}</td>
    </tr>`;
  }).join('');

  renderOrdersTotals(list);
}

function renderOrdersTotals(list){
  const el = document.getElementById('orders-list-totals');
  if(!el) return;
  const totCa    = list.reduce((s,e)=>{
    const ex=e.extras||[];
    return s+(e.contractAmount||0)+(ex[0]?.amount||0)+(ex[1]?.amount||0)+(ex[2]?.amount||0);
  },0);
  const totKai   = list.reduce((s,e)=>(s+(e.payments||[]).reduce((s2,p)=>s2+(p.actualAmount||0),0)),0);
  const totMi    = totCa - totKai;
  const totEpAmt = list.reduce((s,e)=>s+Math.round((e.contractAmount||0)*(e.estProfitRate||0)/100),0);
  const totApAmt = list.reduce((s,e)=>s+(e.actualProfit||0),0);

  el.innerHTML = `<tr style="font-weight:700;background:var(--surface2)">
    <td colspan="4" style="padding:5px 8px;text-align:center">合　　　計</td>
    <td class="ol-r">¥${fmt(totCa)}</td>
    <td colspan="4"></td>
    <td class="ol-r" style="color:${totMi>0?'var(--danger)':'inherit'}">¥${fmt(totMi)}</td>
    <td colspan="6"></td>
    <td class="ol-r" style="color:${totMi>0?'var(--danger)':'inherit'}">¥${fmt(totMi)}</td>
    <td colspan="2"></td>
    <td class="ol-r">¥${fmt(totEpAmt)}</td>
    <td colspan="1"></td>
    <td class="ol-r">¥${fmt(totApAmt)}</td>
    <td class="ol-r"></td>
    <td></td>
  </tr>`;
}

async function saveOlField(estId, field, value){
  const est = estimates.find(e=>e.id===estId);
  if(!est) return;
  est[field] = value;
  try{ await dbSaveEstimate(est); } catch(_){}
  renderOrdersTotals(
    (estimates||[]).filter(e=>e.status==='approved'||e.status==='sent')
  );
}
