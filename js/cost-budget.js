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

async function saveLaborRate(){
  const v=Math.max(0, parseInt(document.getElementById('cb-rate').value)||0);
  try{
    await dbSaveAppSetting('labor_cost_per_ninku', {amount:v});
  }catch(_){ return; }
  renderCost();
  showToast(v ? `1人工あたり ¥${fmt(v)} で計算します` : '労務費の設定を外しました');
}
