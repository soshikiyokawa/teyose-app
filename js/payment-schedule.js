// ════ 入金予定スケジュール（年間） ════
//
// 年度は3月度から2月度まで（毎年3月はじまり）。
// 月度の区切りは25日締め。◯月度 ＝ 前月26日〜当月25日。
//   例）2026年4月度 ＝ 2026/3/26 〜 2026/4/25
//
// もとになるのは見積の「入金予定・実績」（契約時金・着工金・上棟時金・最終金）。
// 受注・工事中・完工の案件だけを数える（下書き・提出済みは予定に入れない）。

const PS_MONTHS = [3,4,5,6,7,8,9,10,11,12,1,2];   // 年度の並び（3月度はじまり）

let psFiscalYear = null;   // 表示中の年度（null＝今年度）
let psOpenMonth = null;    // 内訳を開いている月度（'2026-04' の形）

const psPad = n => String(n).padStart(2,'0');
const psToday = () => { const d=new Date(); return `${d.getFullYear()}-${psPad(d.getMonth()+1)}-${psPad(d.getDate())}`; };
const psLabel = s => s ? s.replace(/-/g,'/') : '';

// ◯年◯月度の期間（前月26日〜当月25日）
function psPeriod(year, month){
  const py = month===1 ? year-1 : year;
  const pm = month===1 ? 12 : month-1;
  return { start:`${py}-${psPad(pm)}-26`, end:`${year}-${psPad(month)}-25` };
}
// その日が入る「◯年◯月度」
function psMonthOf(dateStr){
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr||''));
  if(!m) return null;
  const y=+m[1], mo=+m[2], d=+m[3];
  if(d <= 25) return `${y}-${psPad(mo)}`;
  return mo===12 ? `${y+1}-01` : `${y}-${psPad(mo+1)}`;
}
// 月度が属する年度（3月度〜翌2月度）
function psFyOfMonthKey(key){
  const [y,mo]=key.split('-').map(Number);
  return mo>=3 ? y : y-1;
}
function psThisFiscalYear(){
  const k=psMonthOf(psToday());
  return k ? psFyOfMonthKey(k) : new Date().getFullYear();
}

// 入金予定を1件ずつ取り出す（受注・工事中・完工の案件のみ）
function psAllPayments(){
  const out=[];
  (estimates||[]).forEach(e=>{
    if(!['approved','construction','completed'].includes(e.status)) return;
    // 同じ案件に見積が複数あるときは、いちばん新しく更新したものだけ
    const same=(estimates||[]).filter(x=>x.projectName===e.projectName);
    const newest=[...same].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0))[0];
    if(newest && newest.id!==e.id) return;
    (e.payments||[]).forEach(p=>{
      const amount=Number(p?.amount)||0;
      const actual=Number(p?.actualAmount)||0;
      if(!amount && !actual) return;
      out.push({
        project:e.projectName||'（案件名なし）',
        client:e.clientName||'',
        label:p.label||'入金',
        date:p.date||'',
        amount, actual,
        left:Math.max(0, amount-actual),
        actualDate:p.actualDate||'',
        monthKey:psMonthOf(p.date)
      });
    });
  });
  return out;
}

function renderPaymentSchedule(){
  const wrap=document.getElementById('ps-body');
  if(!wrap) return;
  if(!olCanSeeMoney()){
    wrap.innerHTML='<div class="card"><div class="empty" style="padding:18px">入金予定は管理者のみ表示できます</div></div>';
    return;
  }
  if(psFiscalYear===null) psFiscalYear=psThisFiscalYear();

  const all=psAllPayments();
  // 年度の選択肢（予定のある年度＋今年度）
  const now=psThisFiscalYear();
  const years=[...new Set([...all.map(p=>p.monthKey).filter(Boolean).map(psFyOfMonthKey), now])];
  const future=years.filter(y=>y>now).sort((a,b)=>a-b);
  const past=years.filter(y=>y<now).sort((a,b)=>b-a);
  const sel=document.getElementById('ps-fy');
  if(sel){
    sel.innerHTML=[now,...future,...past]
      .map(y=>`<option value="${y}"${y===psFiscalYear?' selected':''}>${y}年度（${y}/3〜${y+1}/2）${y===now?'　今年度':''}</option>`).join('');
  }

  const today=psToday();
  // 月度ごとに集計
  const rows=PS_MONTHS.map(mo=>{
    const y = mo>=3 ? psFiscalYear : psFiscalYear+1;
    const key=`${y}-${psPad(mo)}`;
    const list=all.filter(p=>p.monthKey===key);
    const {start,end}=psPeriod(y,mo);
    const plan=list.reduce((s,p)=>s+p.amount,0);
    const got =list.reduce((s,p)=>s+p.actual,0);
    const left=list.reduce((s,p)=>s+p.left,0);
    const overdue=list.filter(p=>p.left>0 && p.date && p.date<today).reduce((s,p)=>s+p.left,0);
    return {key,y,mo,start,end,list,plan,got,left,overdue};
  });
  // 予定日が入っていないもの
  const noDate=all.filter(p=>!p.monthKey);

  const tot={plan:rows.reduce((s,r)=>s+r.plan,0), got:rows.reduce((s,r)=>s+r.got,0),
             left:rows.reduce((s,r)=>s+r.left,0), overdue:rows.reduce((s,r)=>s+r.overdue,0)};

  wrap.innerHTML=`
    <div class="card" style="padding:0;overflow:hidden">
      <table class="ps-table">
        <thead>
          <tr><th>月度</th><th>期間</th><th class="r">入金予定</th><th class="r">入金済み</th><th class="r">未入金</th><th class="c">件数</th></tr>
        </thead>
        <tbody>
          ${rows.map(psRowHtml).join('')}
          ${noDate.length?`<tr class="ps-row"><td colspan="2" style="color:var(--warn-t)">日付未定</td>
            <td class="r">¥${fmt(noDate.reduce((s,p)=>s+p.amount,0))}</td>
            <td class="r">¥${fmt(noDate.reduce((s,p)=>s+p.actual,0))}</td>
            <td class="r">¥${fmt(noDate.reduce((s,p)=>s+p.left,0))}</td>
            <td class="c">${noDate.length}</td></tr>`:''}
        </tbody>
        <tfoot>
          <tr><td colspan="2">${noDate.length?'年度合計<span style="font-weight:400;font-size:10px;color:var(--text-muted)">（日付未定を除く）</span>':'年度合計'}</td>
            <td class="r">¥${fmt(tot.plan)}</td>
            <td class="r">¥${fmt(tot.got)}</td>
            <td class="r"${tot.left?' style="color:var(--danger)"':''}>¥${fmt(tot.left)}</td>
            <td class="c">${rows.reduce((s,r)=>s+r.list.length,0)}</td></tr>
        </tfoot>
      </table>
    </div>
    <div style="font-size:11px;color:var(--text-muted);line-height:1.8;margin-top:8px">
      月度は25日締めです（◯月度 ＝ 前月26日〜当月25日）。年度は3月度から翌年2月度まで。<br>
      受注・工事中・完工の案件の入金予定だけを数えます。行をタップすると内訳が出ます。
      ${tot.overdue?`<br><span style="color:var(--danger);font-weight:700">予定日を過ぎた未入金が ¥${fmt(tot.overdue)} あります</span>`:''}
    </div>`;
}

function psRowHtml(r){
  const open = psOpenMonth===r.key;
  const isNow = psMonthOf(psToday())===r.key;
  return `<tr class="ps-row${open?' open':''}${isNow?' now':''}" onclick="psToggleMonth('${r.key}')">
      <td style="font-weight:700;white-space:nowrap">${r.mo}月度${isNow?'<span style="font-size:9px;color:var(--accent-t)">　今月</span>':''}</td>
      <td style="font-size:11px;color:var(--text-muted);white-space:nowrap">${psLabel(r.start).slice(5)}〜${psLabel(r.end).slice(5)}</td>
      <td class="r">${r.plan?'¥'+fmt(r.plan):'—'}</td>
      <td class="r" style="color:${r.got?'var(--ok-t)':'inherit'}">${r.got?'¥'+fmt(r.got):'—'}</td>
      <td class="r" style="${r.overdue?'color:var(--danger);font-weight:700':r.left?'color:var(--warn-t)':''}">${r.left?'¥'+fmt(r.left):'—'}</td>
      <td class="c">${r.list.length||''}</td>
    </tr>
    ${open&&r.list.length?`<tr class="ps-detail"><td colspan="6">${r.list.map(psItemHtml).join('')}</td></tr>`:''}`;
}

function psItemHtml(p){
  const today=psToday();
  const over=p.left>0 && p.date && p.date<today;
  const state = p.left<=0 ? `<span style="color:var(--ok-t);font-weight:700">入金済 ${psLabel(p.actualDate)}</span>`
    : over ? `<span style="color:var(--danger);font-weight:700">未入金 ¥${fmt(p.left)}（期日超過）</span>`
    : `<span style="color:var(--warn-t)">未入金 ¥${fmt(p.left)}</span>`;
  return `<div style="display:flex;align-items:center;gap:8px;padding:5px 2px;border-top:0.5px solid var(--border);flex-wrap:wrap">
      <span style="font-size:11px;color:var(--text-muted);width:52px;flex:none">${psLabel(p.date).slice(5)}</span>
      <span style="font-size:12px;font-weight:600;flex:1;min-width:0">${esc(p.project)}
        <span style="font-weight:400;color:var(--text-muted)">　${esc(p.label)}</span></span>
      <span style="font-size:12px;font-weight:700;white-space:nowrap">¥${fmt(p.amount)}</span>
      <span style="font-size:11px;white-space:nowrap">${state}</span>
    </div>`;
}

function psToggleMonth(key){
  psOpenMonth = psOpenMonth===key ? null : key;
  renderPaymentSchedule();
}
function psFyChanged(){
  psFiscalYear=Number(document.getElementById('ps-fy').value);
  psOpenMonth=null;
  renderPaymentSchedule();
}
