// ════ 給与の登録と、現場への労務費の振り分け（清川創史・清川優香のみ） ════
//
// 社員ごとに月々の給与を登録しておくと、その月度の日報から
// 「どの現場にいくら人件費がかかったか」を出せる。
//
//  労務費に入れる5項目 … 基本給・家族手当・役付手当・技能・資格手当・固定残業代
//  労務費に入れない2項目… 非課税通勤手当・非課税車両借上料
//
// 振り分け方
//   その月度にその人が働いた実働時間を現場ごとに集計し、その割合で労務費を分ける。
//   （例：労務費30万円で、A邸に16人工・B邸に4人工なら A邸24万円／B邸6万円）
//   有給・欠勤・休みの日は実働が無いので、その分の給与も働いた現場に乗る。
//   その月度にひとつも現場に出ていない人は「未配賦」としてまとめて出す。
//
// 給与は変わるので「いつから適用するか（月度）」で履歴を残し、
// ある月度の給与は「その月度以前でいちばん新しい登録」を使う。
//
// 権限：清川創史と清川優香だけ。画面もデータも他の社員には出ない
//      （SQL側 supabase/migration-genba52.sql の app_is_payroll_admin が本当の鍵）

const PAYROLL_ADMINS = ['清川創史','清川優香'];
function isPayrollAdmin(){ return PAYROLL_ADMINS.includes(currentUserDisplayName); }

// 給与の項目。labor=true が労務費に入る5項目
const SALARY_ITEMS = [
  {key:'basePay',           label:'基本給',           labor:true},
  {key:'familyAllowance',   label:'家族手当',         labor:true},
  {key:'positionAllowance', label:'役付手当',         labor:true},
  {key:'skillAllowance',    label:'技能・資格手当',   labor:true},
  {key:'fixedOvertime',     label:'固定残業代',       labor:true},
  {key:'commuteAllowance',  label:'非課税通勤手当',   labor:false},
  {key:'vehicleAllowance',  label:'非課税車両借上料', labor:false}
];

function salaryLaborCost(s){
  if(!s) return 0;
  return SALARY_ITEMS.filter(i=>i.labor).reduce((n,i)=>n+(Number(s[i.key])||0), 0);
}
function salaryTotal(s){
  if(!s) return 0;
  return SALARY_ITEMS.reduce((n,i)=>n+(Number(s[i.key])||0), 0);
}

// その月度に適用される給与（適用開始月がその月度以前で、いちばん新しいもの）
function salaryFor(userId, month){
  return (employeeSalaries||[])
    .filter(s=>s.userId===userId && s.effectiveMonth<=month)
    .sort((a,b)=> a.effectiveMonth<b.effectiveMonth ? 1 : -1)[0] || null;
}
// その社員・その月度に「ちょうどその月度から」の登録があるか（編集の判定用）
function salaryRowAt(userId, month){
  return (employeeSalaries||[]).find(s=>s.userId===userId && s.effectiveMonth===month) || null;
}

// 給与を登録できる月度：出面表と同じ並びに、翌月・翌々月を足す（昇給を先に入れられるように）
function payMonthOptions(){
  const opts = dezuraMonthOptions();          // 新しい順
  const next = m => { const [y,mm]=m.split('-').map(Number); return mm===12?`${y+1}-01`:`${y}-${String(mm+1).padStart(2,'0')}`; };
  const n1 = next(dezuraCurrentMonth()), n2 = next(n1);
  return [n2, n1, ...opts];
}

// ════ 給与の一覧 ════
let payMonth = '';

function openPayroll(){
  if(!isPayrollAdmin()){ showToast('給与を見られるのは'+PAYROLL_ADMINS.join('さんと')+'さんだけです'); return; }
  if(!payMonth) payMonth = dezuraCurrentMonth();
  document.getElementById('pay-modal').classList.add('open');
  renderPayroll();
}
function closePayroll(){ document.getElementById('pay-modal').classList.remove('open'); }
function setPayMonth(v){ payMonth = v; renderPayroll(); }

function renderPayroll(){
  const wrap = document.getElementById('pay-list');
  if(!wrap) return;
  const mo = payMonth || dezuraCurrentMonth();

  const sel = document.getElementById('pay-month');
  if(sel){
    sel.innerHTML = payMonthOptions().map(m=>`<option value="${m}">${dezuraMonthLabel(m)}</option>`).join('');
    sel.value = mo;
  }
  if(!salaryTableReady){
    wrap.innerHTML = '<div class="empty" style="padding:14px">給与の準備ができていません（データベースの設定が未適用です）</div>';
    return;
  }

  const emps = nippoEmployees();
  let labor = 0, total = 0, unset = 0;
  wrap.innerHTML = emps.map(p=>{
    const s = salaryFor(p.id, mo);
    const here = salaryRowAt(p.id, mo);
    if(s){ labor += salaryLaborCost(s); total += salaryTotal(s); } else { unset++; }
    const since = s
      ? (here ? '<span class="pay-since now">この月度から登録</span>'
              : `<span class="pay-since">${esc(dezuraMonthLabel(s.effectiveMonth).replace(/（.*/,''))}から</span>`)
      : '<span class="pay-since none">未登録</span>';
    return `
      <div class="pay-row" onclick="openSalaryEdit('${p.id}')">
        <div class="pay-name">${esc(p.displayName)}${since}</div>
        <div class="pay-amt">
          <div class="labor">${s?fmt(salaryLaborCost(s)):'—'}</div>
          <div class="sub">総支給 ${s?fmt(salaryTotal(s)):'—'}</div>
        </div>
      </div>`;
  }).join('');

  const foot = document.getElementById('pay-total');
  if(foot){
    foot.innerHTML = `労務費の合計 <b>${fmt(labor)}円</b>　総支給 <b>${fmt(total)}円</b>`
      + (unset ? `　<span style="color:var(--danger)">未登録 ${unset}人</span>` : '');
  }
}

// ════ 給与の入力 ════
let editingSalaryUserId = '';

function openSalaryEdit(userId){
  if(!isPayrollAdmin()) return;
  editingSalaryUserId = userId;
  const mo = payMonth || dezuraCurrentMonth();
  const name = (allProfiles.find(p=>p.id===userId)||{}).displayName || '';
  const here = salaryRowAt(userId, mo);
  const base = here || salaryFor(userId, mo);   // 前の月度の内容を引き継いで初期表示する

  document.getElementById('pay-edit-title').textContent = `${name}さんの給与`;
  document.getElementById('pay-edit-month').textContent = dezuraMonthLabel(mo) + ' から適用';
  document.getElementById('pay-edit-note-lbl').innerHTML = here
    ? 'この月度の登録を編集します。'
    : (base ? `${esc(dezuraMonthLabel(base.effectiveMonth).replace(/（.*/,''))}の内容を引き継いで表示しています。保存すると<b>この月度からの登録</b>になります。`
            : 'まだ登録がありません。保存するとこの月度からの登録になります。');
  SALARY_ITEMS.forEach(i=>payAmtLoad('sal-'+i.key, base ? base[i.key] : 0));
  document.getElementById('sal-note').value = here ? (here.note||'') : '';
  document.getElementById('sal-delete-btn').style.display = here ? '' : 'none';
  salaryRecalc();
  document.getElementById('pay-edit-modal').classList.add('open');
}
function closeSalaryEdit(){ document.getElementById('pay-edit-modal').classList.remove('open'); }

function salaryRecalc(){
  const vals = {};
  SALARY_ITEMS.forEach(i=>vals[i.key] = payAmtVal('sal-'+i.key));
  document.getElementById('sal-labor').textContent = fmt(salaryLaborCost(vals))+'円';
  document.getElementById('sal-total').textContent = fmt(salaryTotal(vals))+'円';
}

async function saveSalary(){
  const userId = editingSalaryUserId;
  if(!userId) return;
  const mo = payMonth || dezuraCurrentMonth();
  const name = (allProfiles.find(p=>p.id===userId)||{}).displayName || '';
  const s = {userId, userName:name, effectiveMonth:mo, note:document.getElementById('sal-note').value.trim()};
  SALARY_ITEMS.forEach(i=>s[i.key] = payAmtVal('sal-'+i.key));
  await dbSaveSalary(s);
  closeSalaryEdit();
  showToast(`${name}さんの給与を保存しました（${dezuraMonthLabel(mo).replace(/（.*/,'')}から）`);
  renderPayroll();
}

async function deleteSalary(){
  const mo = payMonth || dezuraCurrentMonth();
  const here = salaryRowAt(editingSalaryUserId, mo);
  if(!here) return;
  if(!confirm(`${here.userName}さんの「${dezuraMonthLabel(mo).replace(/（.*/,'')}から」の登録を削除しますか？\n削除するとひとつ前の登録が引き続き使われます。`)) return;
  await dbDeleteSalary(here.id);
  closeSalaryEdit();
  showToast('削除しました');
  renderPayroll();
}

// ════ 労務費の振り分け ════
//
// 合計がぴったり合うように、端数はいちばん惜しい現場から1円ずつ足していく
function splitYen(total, weights){
  const sum = weights.reduce((a,b)=>a+b, 0);
  if(!sum) return weights.map(()=>0);
  const raw = weights.map(w=>total*w/sum);
  const out = raw.map(v=>Math.floor(v));
  let rest = total - out.reduce((a,b)=>a+b, 0);
  const order = raw.map((v,i)=>[v-Math.floor(v), i]).sort((a,b)=>b[0]-a[0]);
  for(let k=0; k<order.length && rest>0; k++, rest--) out[order[k][1]]++;
  return out;
}

// 現場の並び順（出面表の現場別人工集計と同じ考え方）
const LABOR_TAIL_ORDER = ['訓練校','研修','設計','事務'];
function laborSiteRank(name){
  const s = String(name||'');
  if(s.includes('工事')) return 0;
  const i = LABOR_TAIL_ORDER.findIndex(k=>s.includes(k));
  return i>=0 ? 2+i : 1;
}

// その月度の「現場 × 社員」の労務費
function laborAllocation(month){
  const {start, end} = nippoPeriod(month);
  const sites = {};   // 現場名 -> {minutes, byUser:{uid:分}}
  const users = {};   // uid -> {name, minutes, labor, salary}

  nippoEmployees().forEach(p=>{
    users[p.id] = {id:p.id, name:p.displayName, minutes:0, labor:0, salary:salaryFor(p.id, month)};
    users[p.id].labor = salaryLaborCost(users[p.id].salary);
  });

  (dailyReports||[]).filter(n=>n.workDate>=start && n.workDate<=end).forEach(n=>{
    if(isNippoStateName(n.projectName)) return;      // 休み・欠勤は現場ではない
    const u = users[n.userId];
    if(!u) return;                                   // 退職などで社員一覧に無い人は数えない
    const key = n.projectName || '（工事未設定）';
    const site = sites[key] = sites[key] || {name:key, minutes:0, byUser:{}};
    site.minutes += n.workMinutes;
    site.byUser[n.userId] = (site.byUser[n.userId]||0) + n.workMinutes;
    u.minutes += n.workMinutes;
  });

  const siteNames = Object.keys(sites).sort((a,b)=>{
    const ra=laborSiteRank(a), rb=laborSiteRank(b);
    return ra!==rb ? ra-rb : (sites[b].minutes-sites[a].minutes) || a.localeCompare(b,'ja');
  });
  const userIds = Object.keys(users)
    .filter(id=>users[id].labor>0 || users[id].minutes>0)
    .sort((a,b)=>cmpEmployee(users[a].name, users[b].name));

  // 社員ごとに、その人の労務費を出た現場の実働時間で分ける
  const cell = {};       // 現場名 -> {uid: 円}
  siteNames.forEach(n=>cell[n] = {});
  const unassigned = {}; // 現場に出ていない人の労務費
  userIds.forEach(uid=>{
    const u = users[uid];
    if(!u.labor) return;
    if(!u.minutes){ unassigned[uid] = u.labor; return; }
    const yen = splitYen(u.labor, siteNames.map(n=>sites[n].byUser[uid]||0));
    siteNames.forEach((n,i)=>{ if(yen[i]) cell[n][uid] = yen[i]; });
  });

  return {month, start, end, sites, siteNames, users, userIds, cell, unassigned};
}

let laborMonth = '';
function openLabor(){
  if(!isPayrollAdmin()){ showToast('労務費を見られるのは'+PAYROLL_ADMINS.join('さんと')+'さんだけです'); return; }
  if(!laborMonth) laborMonth = dezuraCurrentMonth();
  document.getElementById('labor-modal').classList.add('open');
  renderLabor();
}
function closeLabor(){ document.getElementById('labor-modal').classList.remove('open'); }
function setLaborMonth(v){ laborMonth = v; renderLabor(); }

// 表のHTML（画面にも印刷にも同じものを使う）
function laborTableHtml(a, forPrint){
  const ninku = min => (Math.round(min/480*100)/100).toFixed(2).replace(/\.?0+$/,'') || '0';
  const head = a.userIds.map(uid=>`<th>${esc(a.users[uid].name)}</th>`).join('');
  const colTotal = {}; a.userIds.forEach(uid=>colTotal[uid]=0);
  let grand = 0;

  const rows = a.siteNames.map(name=>{
    let sum = 0;
    const cells = a.userIds.map(uid=>{
      const v = a.cell[name][uid]||0;
      sum += v; colTotal[uid] += v;
      return `<td class="num">${v?fmt(v):''}</td>`;
    }).join('');
    grand += sum;
    return `<tr>
      <td class="site">${esc(name)}</td>
      <td class="num ninku">${ninku(a.sites[name].minutes)}</td>
      <td class="num total">${fmt(sum)}</td>
      ${cells}
    </tr>`;
  }).join('');

  const unIds = Object.keys(a.unassigned);
  let unSum = 0; unIds.forEach(uid=>unSum += a.unassigned[uid]);
  const unRow = unSum ? `<tr class="unassigned">
      <td class="site">未配賦（この月度に現場の日報がない人）</td>
      <td class="num ninku">0</td>
      <td class="num total">${fmt(unSum)}</td>
      ${a.userIds.map(uid=>{ const v=a.unassigned[uid]||0; colTotal[uid]+=v; return `<td class="num">${v?fmt(v):''}</td>`; }).join('')}
    </tr>` : '';
  grand += unSum;

  return `<table class="labor-tbl${forPrint?' print':''}">
    <tr><th class="site">現場（工事）</th><th class="ninku">人工</th><th class="total">労務費</th>${head}</tr>
    ${rows}${unRow}
    <tr class="sum">
      <td class="site">合計</td>
      <td class="num ninku">${ninku(a.siteNames.reduce((n,s)=>n+a.sites[s].minutes,0))}</td>
      <td class="num total">${fmt(grand)}</td>
      ${a.userIds.map(uid=>`<td class="num">${colTotal[uid]?fmt(colTotal[uid]):''}</td>`).join('')}
    </tr>
  </table>`;
}

function renderLabor(){
  const wrap = document.getElementById('labor-body');
  if(!wrap) return;
  const mo = laborMonth || dezuraCurrentMonth();
  const sel = document.getElementById('labor-month');
  if(sel){
    sel.innerHTML = dezuraMonthOptions().map(m=>`<option value="${m}">${dezuraMonthLabel(m)}</option>`).join('');
    sel.value = mo;
  }

  const a = laborAllocation(mo);
  const noSalary = a.userIds.filter(uid=>!a.users[uid].labor && a.users[uid].minutes>0)
    .map(uid=>a.users[uid].name);

  if(!a.siteNames.length && !Object.keys(a.unassigned).length){
    wrap.innerHTML = '<div class="empty" style="padding:14px">この月度は日報も給与の登録もありません</div>';
    return;
  }
  wrap.innerHTML =
    (noSalary.length ? `<div class="labor-warn">給与が未登録のため労務費に入っていない人：${esc(noSalary.join('、'))}</div>` : '')
    + `<div class="labor-scroll">${laborTableHtml(a, false)}</div>`;
}

function printLabor(){
  const mo = laborMonth || dezuraCurrentMonth();
  const a = laborAllocation(mo);
  if(!a.siteNames.length && !Object.keys(a.unassigned).length){ showToast('この月度は振り分けるものがありません'); return; }
  const md = s => { const [,m,d] = s.split('-'); return `${Number(m)}/${Number(d)}`; };
  const label = dezuraMonthLabel(mo);
  const html = `
  <style>
    @page{size:A3 landscape;margin:10mm}
    body{max-width:none !important}
    table.labor-tbl{border-collapse:collapse;font-size:11px;width:100%}
    table.labor-tbl th,table.labor-tbl td{border:0.4pt solid #b9b9b9;padding:4px 6px;white-space:nowrap}
    table.labor-tbl th{background:#f0ece3;font-weight:700;font-size:10px}
    table.labor-tbl td.num{text-align:right}
    table.labor-tbl td.site,table.labor-tbl th.site{text-align:left;min-width:150px}
    table.labor-tbl td.total{font-weight:700;background:#faf7f0}
    table.labor-tbl tr.sum td{font-weight:700;background:#f7f3eb;border-top:0.8pt solid #8a8a8a}
    table.labor-tbl tr.unassigned td{background:#fdf3ea}
  </style>
  <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:8px;flex-wrap:wrap">
    <h2 style="font-size:16px;margin:0">現場別 労務費　${label}</h2>
    <span style="font-size:11px">対象期間：${md(a.start)}〜${md(a.end)}（20日締め）</span>
  </div>
  <div style="font-size:10px;color:#555;margin-bottom:8px">
    労務費＝基本給・家族手当・役付手当・技能・資格手当・固定残業代の合計（非課税通勤手当と非課税車両借上料は含みません）。
    社員ごとの労務費を、その月度に出た現場の実働時間の割合で分けています（人工＝実働8時間で1.0）。
    有給・欠勤・休みの日も給与は発生するため、その分は出た現場に含まれます。
  </div>
  ${laborTableHtml(a, true)}
  <div style="font-size:9px;color:#555;margin-top:8px">出力日時：${new Date().toLocaleString('ja-JP')}　手寄（てよせ）</div>`;
  printHtml(`現場別労務費 ${label}`, html);
}

// 勤怠日報の画面に「給与・労務費」の枠を出す（清川創史・清川優香のみ）
function renderPayrollCard(){
  const card = document.getElementById('payroll-card');
  if(!card) return;
  card.style.display = isPayrollAdmin() ? '' : 'none';
}
