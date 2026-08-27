// ════ 案件ごとの予実（見積の原価＝予算 と 実際にかかった原価の比較） ════
//
// 予算　… その案件の見積の原価合計（数量×原価）
// 実績　… 発注した原価（cost_entries）＋ 労務費（日報の人工 × 1人工あたりの労務費）
//
// 1人工あたりの労務費は会社共通の設定（app_settings.labor_cost_per_ninku）。
// 未設定のうちは労務費を0として扱い、設定を促す。

// 1人工あたりの労務費（円）。未設定は0
function laborCostPerNinku(){
  return Number(appSettings?.labor_cost_per_ninku?.amount) || 0;
}

// その案件の見積（案件一覧と同じ「いちばん新しく更新した見積」）
function budgetEstimateOf(projectName){
  const list=(estimates||[]).filter(e=>e.projectName===projectName);
  if(!list.length) return null;
  return [...list].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0))[0];
}

// 見積の原価合計（＝予算）
function budgetOfEstimate(est){
  return (est?.sections||[]).reduce((t,s)=>t+(s.items||[]).reduce((t2,i)=>t2+(i.qty*i.cost||0),0),0);
}

// 予実の数字をまとめる
function costBudgetData(projectName){
  const est=budgetEstimateOf(projectName);
  const budget=budgetOfEstimate(est);
  const ordered=(costEntries||[]).filter(e=>(e.project||'')===projectName)
    .reduce((s,e)=>s+e.amount,0);
  const ninku=(dailyReports||[]).filter(n=>n.projectName===projectName)
    .reduce((s,n)=>s+nippoNinku(n),0);
  const rate=laborCostPerNinku();
  const labor=Math.round(ninku*rate);
  const actual=ordered+labor;
  return {est, budget, ordered, ninku, rate, labor, actual,
    left: budget-actual,
    pct: budget>0 ? actual/budget*100 : null};
}

function renderCostBudget(){
  const el=document.getElementById('cost-budget');
  if(!el) return;
  // 在庫分の表示中や案件未選択のときは出さない
  const target = (typeof costViewStock!=='undefined' && costViewStock) ? null : (selectedProject?.name||null);
  if(!target){ el.style.display='none'; return; }
  el.style.display='';

  const d=costBudgetData(target);
  const rateBox = currentUserRole==='staff' ? `
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:0.5px solid var(--border)">
      <span style="font-size:11px;color:var(--text-sub)">1人工あたりの労務費</span>
      <input type="number" id="cb-rate" value="${d.rate||''}" placeholder="0"
             style="width:100px;font-size:12px;padding:3px 6px;text-align:right">
      <span style="font-size:11px;color:var(--text-sub)">円</span>
      <button class="btn xs primary" onclick="saveLaborRate()">保存</button>
      <span style="font-size:11px;color:var(--text-muted)">全案件の計算に使います${(appSettings?.labor_cost_per_ninku?.source) ? `（${esc(appSettings.labor_cost_per_ninku.source.replace('-','年'))}月度の実績から）` : ''}</span>
    </div>` : '';

  if(!d.est){
    el.innerHTML=`<div class="card" style="padding:12px">
      <div style="font-size:12px;color:var(--text-sub);line-height:1.7">
        この案件には見積がないため、予算と比べられません。<br>
        見積の明細を入れると、その原価合計を予算として比べられます。
      </div>${rateBox}</div>`;
    return;
  }
  if(!d.budget){
    el.innerHTML=`<div class="card" style="padding:12px">
      <div style="font-size:12px;color:var(--text-sub);line-height:1.7">
        見積に原価が入っていないため、予算を出せません。<br>
        明細入力タブで各行の原価を入れてください。
      </div>${rateBox}</div>`;
    return;
  }

  const over=d.left<0;
  const near=!over && d.pct>=80;
  const color=over?'var(--danger)':near?'var(--warn-t)':'var(--ok-t)';
  const barPct=Math.min(100, Math.max(0, d.pct||0));
  const rateNote = d.rate
    ? `${fmtNinku(d.ninku)}人工 × ¥${fmt(d.rate)}`
    : `<span style="color:var(--warn-t)">1人工あたりの労務費が未設定（${fmtNinku(d.ninku)}人工）</span>`;

  el.innerHTML=`<div class="card" style="padding:12px">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
      <span style="font-size:12px;font-weight:700">予算と実績</span>
      <span style="font-size:11px;color:var(--text-muted)">予算＝見積の原価合計</span>
      <span style="margin-left:auto;font-size:12px;font-weight:800;color:${color}">
        ${over?`予算超過 ¥${fmt(-d.left)}`:`残り ¥${fmt(d.left)}`}
      </span>
    </div>
    <div style="height:8px;border-radius:99px;background:var(--surface2);overflow:hidden;margin:8px 0 6px">
      <div style="height:100%;width:${barPct}%;background:${color}"></div>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px">
      <span>予算 <b>¥${fmt(d.budget)}</b></span>
      <span>実績 <b style="color:${color}">¥${fmt(d.actual)}</b></span>
      <span style="color:var(--text-sub)">消化 ${d.pct.toFixed(0)}%</span>
    </div>
    <div style="font-size:11px;color:var(--text-sub);margin-top:4px;line-height:1.7">
      内訳：発注 ¥${fmt(d.ordered)}　＋　労務費 ¥${fmt(d.labor)}（${rateNote}）
    </div>
    ${over?`<div style="font-size:11px;color:var(--danger);font-weight:700;margin-top:4px">予算を超えています。追加工事の請求もれがないか確認してください。</div>`:''}
    ${rateBox}
  </div>`;
}

// ════ 見積と実績を、発注先ごとに突き合わせる ════
//
// 見積の工種に「頼む先」を割り当てておくと、その発注先への発注合計と比べられる。
// 「左官工事は◯◯さんに ¥800,000 で見ていたが、実際は ¥920,000」が分かる。
//
// 自社（労務）に割り当てた工種は、日報の人工×1人工あたりの労務費と比べる。
// 割り当てていない工種は「未割り当て」にまとめ、設定を促す。

function estVsOrderRows(projectName){
  const est=budgetEstimateOf(projectName);
  const byName=new Map();   // 発注先名 → {est, actual}
  const pick=n=>{ if(!byName.has(n)) byName.set(n,{name:n, est:0, actual:0}); return byName.get(n); };

  // 見積の側：工種ごとの原価合計を、割り当てた先へ足す
  let unassigned=0;
  for(const sec of (est?.sections||[])){
    const cost=(sec.items||[]).reduce((t,i)=>t+(i.qty*i.cost||0),0);
    if(!cost) continue;
    if(!sec.supplier){ unassigned+=cost; continue; }
    pick(sec.supplier).est+=cost;
  }

  // 実績の側：その現場の原価を発注先ごとに足す
  for(const e of (costEntries||[])){
    if((e.project||'')!==projectName) continue;
    pick(e.supplier||'（発注先なし）').actual+=Number(e.amount)||0;
  }

  // 自社（労務）は日報から
  const d=costBudgetData(projectName);
  if(byName.has(EST_SELF_LABOR) || d.labor){
    pick(EST_SELF_LABOR).actual+=d.labor;
  }

  const rows=[...byName.values()]
    .map(r=>({...r, diff:r.actual-r.est}))
    .sort((a,b)=> Math.abs(b.diff)-Math.abs(a.diff));
  return {est, rows, unassigned, labor:d.labor, ninku:d.ninku, rate:d.rate};
}

function estVsOrderLabel(name){
  return name===EST_SELF_LABOR ? '自社（労務）' : name;
}

function renderEstVsOrder(){
  const el=document.getElementById('est-vs-order');
  if(!el) return;
  const target=(typeof costViewStock!=='undefined' && costViewStock) ? null : (selectedProject?.name||null);
  if(!target){ el.style.display='none'; return; }
  el.style.display='';

  const d=estVsOrderRows(target);
  if(!d.est){ el.innerHTML=''; return; }   // 見積が無い場合は「予算と実績」側の案内に任せる

  const assigned=d.rows.some(r=>r.est>0);
  const rows=d.rows.map(r=>{
    const cls=r.est===0 ? 'evo-new' : r.diff>0 ? 'evo-over' : r.diff<0 ? 'evo-under' : '';
    return `<tr class="${cls}">
      <td>${esc(estVsOrderLabel(r.name))}${r.est===0?'<span class="evo-tag">見積に無し</span>':''}</td>
      <td class="r">${r.est?'¥'+fmt(r.est):'—'}</td>
      <td class="r">${r.actual?'¥'+fmt(r.actual):'—'}</td>
      <td class="r">${r.est===0?'—':r.diff===0?'一致':(r.diff>0?'＋':'−')+'¥'+fmt(Math.abs(r.diff))}</td>
    </tr>`;
  }).join('');
  const tEst=d.rows.reduce((s,r)=>s+r.est,0)+d.unassigned;
  const tAct=d.rows.reduce((s,r)=>s+r.actual,0);

  el.innerHTML=`
    <div class="section-lbl">見積と実績（発注先ごと）</div>
    <div class="card" style="padding:0;overflow-x:auto">
      ${assigned ? `<table class="cost-type-table evo-table">
        <thead><tr><th>頼む先</th><th class="r">見積の原価</th><th class="r">実績</th><th class="r">差額</th></tr></thead>
        <tbody>${rows}
          ${d.unassigned?`<tr class="evo-un"><td>（工種に頼む先が未割り当て）</td><td class="r">¥${fmt(d.unassigned)}</td><td class="r">—</td><td class="r">—</td></tr>`:''}
          <tr class="total"><td>合計</td><td class="r">¥${fmt(tEst)}</td><td class="r">¥${fmt(tAct)}</td>
            <td class="r">${tAct-tEst===0?'一致':(tAct-tEst>0?'＋':'−')+'¥'+fmt(Math.abs(tAct-tEst))}</td></tr>
        </tbody>
      </table>`
      : `<div style="padding:12px;font-size:12px;color:var(--text-sub);line-height:1.8">
          見積の工種に「頼む先」がまだ割り当てられていません。<br>
          見積の明細入力で、工種ごとに頼む先（発注先／自社）を選ぶと、ここで見積と実績を並べて比べられます。
        </div>`}
    </div>
    ${assigned?`<div style="font-size:11px;color:var(--text-muted);margin-top:4px;line-height:1.7">
      実績＝その発注先へのこの現場の発注（原価）。自社（労務）は日報の${fmtNinku(d.ninku)}人工${
        d.rate?` × ¥${fmt(d.rate)}`:'（1人工あたりの労務費が未設定）'}。
    </div>`:''}`;
}

async function saveLaborRate(){
  const v=Math.max(0, parseInt(document.getElementById('cb-rate').value)||0);
  try{
    await dbSaveAppSetting('labor_cost_per_ninku', {amount:v});
  }catch(_){ return; }
  renderCost();
  showToast(v ? `1人工あたり ¥${fmt(v)} で計算します` : '労務費の設定を外しました');
}
