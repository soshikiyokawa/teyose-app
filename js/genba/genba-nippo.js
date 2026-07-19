// ════ 日報（作業内容・実働・残業時間の記録と月次集計） ════
// 実働 ＝ 終了 − 開始 − 休憩。残業 ＝ 実働のうち8時間（480分）を超えた分
// 残業が発生した日報は「申請中」となり、承認者の承認が必要（未承認の間は1時間ごとにリマインド通知）

const NIPPO_STANDARD_MINUTES = 480;

// 残業の承認者（変更する場合は supabase/migration-genba3.sql の app_is_ot_approver と
// supabase/functions/ot-remind の APPROVERS も合わせて変更すること）
const OT_APPROVERS = ['清川創史','清川太視','清川説志','清川伸二','原口晴郎'];
function isOtApprover(){ return OT_APPROVERS.includes(currentUserDisplayName); }

// 21時〜翌7時は通知を送らない（リマインドはSupabase側のcronが7時以降に再開する）
function isQuietHoursJST(){
  const h = new Date().getHours();
  return h>=21 || h<7;
}

const OT_STATUS = {
  pending:  {label:'残業 申請中', cls:'pending'},
  approved: {label:'残業 承認済', cls:'approved'},
  rejected: {label:'残業 却下', cls:'rejected'}
};

// 作業種別（工事区分が「新築」の案件のみ）：木工事／上棟／墨付け刻み
function nippoIsShinchiku(projectId){
  const p = projects.find(x=>x.id===projectId);
  return (p?.type||'')==='新築';
}
function nippoWorkKindToggle(){
  const wrap = document.getElementById('nippo-work-kind-wrap');
  if(!wrap) return;
  const projectId = Number(document.getElementById('nippo-project').value)||null;
  wrap.style.display = nippoIsShinchiku(projectId) ? '' : 'none';
}

function nippoParseHM(s){
  const m = String(s||'').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1])*60+Number(m[2]) : null;
}

// フォームの現在値から実働・残業（分）を計算
function nippoCalc(){
  const start = nippoParseHM(document.getElementById('nippo-start').value);
  const end = nippoParseHM(document.getElementById('nippo-end').value);
  const brk = Number(document.getElementById('nippo-break').value)||0;
  if(start==null || end==null || end<=start) return {work:0, overtime:0};
  const work = Math.max(0, end-start-brk);
  return {work, overtime: Math.max(0, work-NIPPO_STANDARD_MINUTES)};
}

function nippoRecalc(){
  const {work, overtime} = nippoCalc();
  document.getElementById('nippo-worktime').textContent = gbMinLabel(work);
  const otEl = document.getElementById('nippo-overtime');
  otEl.textContent = overtime>0 ? gbMinLabel(overtime) : 'なし';
  otEl.style.color = overtime>0 ? 'var(--danger)' : 'var(--text)';
  // 残業が発生する場合のみ承認者の選択欄を表示
  document.getElementById('nippo-ot-approver-wrap').style.display = overtime>0 ? '' : 'none';
}

function resetNippoForm(){
  editingNippoId = null;
  document.getElementById('nippo-date').value = gbToday();
  document.getElementById('nippo-project').value = '';
  document.getElementById('nippo-work-kind').value = '';
  nippoWorkKindToggle();
  document.getElementById('nippo-content').value = '';
  document.getElementById('nippo-start').value = '08:00';
  document.getElementById('nippo-end').value = '18:00';
  document.getElementById('nippo-break').value = '120';
  document.getElementById('nippo-ot-approver').value = '';
  document.getElementById('nippo-form-title').textContent = '日報を書く';
  document.getElementById('nippo-cancel-btn').style.display = 'none';
  document.getElementById('nippo-delete-btn').style.display = 'none';
  nippoRecalc();
}

async function saveNippo(){
  const workDate = document.getElementById('nippo-date').value;
  const projectId = Number(document.getElementById('nippo-project').value)||null;
  const content = document.getElementById('nippo-content').value.trim();
  const startTime = document.getElementById('nippo-start').value;
  const endTime = document.getElementById('nippo-end').value;
  const breakMinutes = Number(document.getElementById('nippo-break').value)||0;
  if(!workDate){ showToast('日付を入力してください'); return; }
  if(!projectId){ showToast('工事を選択してください'); return; }
  // 新築案件は作業種別（木工事／上棟／墨付け刻み）が必須
  const isShinchiku = nippoIsShinchiku(projectId);
  const workKind = isShinchiku ? document.getElementById('nippo-work-kind').value : '';
  if(isShinchiku && !workKind){ showToast('作業種別を選択してください'); return; }
  if(!content){ showToast('作業内容を入力してください'); return; }
  if(nippoParseHM(startTime)==null || nippoParseHM(endTime)==null){ showToast('開始・終了時刻を入力してください'); return; }
  if(nippoParseHM(endTime) <= nippoParseHM(startTime)){ showToast('終了時刻は開始時刻より後にしてください'); return; }
  const {work, overtime} = nippoCalc();
  const project = projects.find(p=>p.id===projectId);

  // 残業がある場合は承認者を1人選んでもらう（その人だけに通知される）
  let otApproverName = '';
  if(overtime>0){
    otApproverName = document.getElementById('nippo-ot-approver').value;
    if(!otApproverName){ showToast('残業の承認者を選択してください'); return; }
  }

  // 残業の承認ステータスを決める：残業なし＝none／残業あり＝申請中
  // （承認・却下済みで残業時間も承認者も変わっていなければステータスを維持する）
  const prev = editingNippoId ? dailyReports.find(x=>x.id===editingNippoId) : null;
  let otStatus = 'none';
  if(overtime>0){
    otStatus = (prev && prev.overtimeMinutes===overtime && prev.otApproverName===otApproverName
                && (prev.otStatus==='approved'||prev.otStatus==='rejected'))
      ? prev.otStatus : 'pending';
  }
  const notifyApprover = otStatus==='pending' &&
    !(prev && prev.otStatus==='pending' && prev.overtimeMinutes===overtime && prev.otApproverName===otApproverName);

  const reportUserName = prev ? prev.userName : (currentUserDisplayName||'');
  await dbSaveNippo({
    id: editingNippoId, workDate, projectId, projectName: project?.name||'', workKind,
    content, startTime, endTime, breakMinutes, workMinutes: work, overtimeMinutes: overtime,
    otStatus, otApproverName
  });

  if(otStatus==='pending'){
    showToast(`日報を保存し、${otApproverName}さんに残業を申請しました（承認待ち）`);
    if(notifyApprover){
      dbSendPushToNames([otApproverName], '残業承認のお願い',
        `${reportUserName}さん ${workDate.replace(/-/g,'/')} 残業${gbMinLabel(overtime)}（${project?.name||''}）`, 'genba/nippo').catch(()=>{});
      // 社内チャットにも記録を残す（通知は承認者宛のみ。チャット転記は通知なし）
      dbAddChatMessage(INTERNAL_THREAD, {role:'me', type:'text', silent:true,
        text:`【残業申請】${workDate.replace(/-/g,'/')}　残業${gbMinLabel(overtime)}（${project?.name||''}）\n承認者：${otApproverName}`}).catch(()=>{});
    }
  } else {
    showToast(editingNippoId ? '日報を更新しました' : '日報を登録しました');
  }
  resetNippoForm();
  nippoMonth = workDate.slice(0,7); // 保存した月を表示
  await refreshGenba();
}

// ── 残業の承認・却下（承認者のみ） ──
async function approveOtNippo(id){
  const n = dailyReports.find(x=>x.id===id);
  if(!n) return;
  if(!confirm(`${n.userName}さんの ${gbDateLabel(n.workDate)} の残業${gbMinLabel(n.overtimeMinutes)}を承認しますか？`)) return;
  await dbReviewOtNippo(id, 'approved', '');
  showToast('承認しました（本人に通知されます）');
  await refreshGenba();
}
async function rejectOtNippo(id){
  const n = dailyReports.find(x=>x.id===id);
  if(!n) return;
  const note = prompt(`${n.userName}さんの ${gbDateLabel(n.workDate)} の残業を却下します。\n理由（本人に表示されます）：`);
  if(note===null) return;
  await dbReviewOtNippo(id, 'rejected', note.trim());
  showToast('却下しました（本人に通知されます）');
  await refreshGenba();
}

function editNippo(id){
  const n = dailyReports.find(x=>x.id===id);
  if(!n) return;
  // 自分の日報以外はstaffのみ編集可
  if(currentUserRole!=='staff' && n.userId!==currentUserId) return;
  editingNippoId = id;
  document.getElementById('nippo-date').value = n.workDate;
  renderGenbaProjectSelects();
  document.getElementById('nippo-project').value = n.projectId ? String(n.projectId) : '';
  document.getElementById('nippo-work-kind').value = n.workKind||'';
  nippoWorkKindToggle();
  document.getElementById('nippo-content').value = n.content;
  document.getElementById('nippo-start').value = n.startTime;
  document.getElementById('nippo-end').value = n.endTime;
  document.getElementById('nippo-break').value = String(n.breakMinutes);
  document.getElementById('nippo-ot-approver').value = n.otApproverName||'';
  document.getElementById('nippo-form-title').textContent =
    (currentUserRole==='staff' && n.userId!==currentUserId ? `日報を編集（${n.userName}）` : '日報を編集');
  document.getElementById('nippo-cancel-btn').style.display = '';
  document.getElementById('nippo-delete-btn').style.display = '';
  nippoRecalc();
  document.getElementById('nippo-form-card').scrollIntoView({behavior:'smooth',block:'start'});
}

async function deleteNippo(){
  if(!editingNippoId) return;
  if(!confirm('この日報を削除しますか？')) return;
  await dbDeleteNippo(editingNippoId);
  showToast('日報を削除しました');
  resetNippoForm();
  await refreshGenba();
}

function nippoMonthShift(delta){
  const [y,m] = (nippoMonth||gbThisMonth()).split('-').map(Number);
  const d = new Date(y, m-1+delta, 1);
  nippoMonth = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  renderNippo();
}

function renderNippo(){
  if(!nippoMonth) nippoMonth = gbThisMonth();
  if(!document.getElementById('nippo-date').value) resetNippoForm();

  const [y,m] = nippoMonth.split('-').map(Number);
  document.getElementById('nippo-month-lbl').textContent = y+'年'+m+'月';

  // ── 承認者のみ：自分宛の残業承認待ち一覧（月をまたいで全件表示） ──
  // 承認者が未指定の古い申請は5人全員に表示する
  const otWrap = document.getElementById('ot-approve-wrap');
  if(isOtApprover()){
    const pendings = dailyReports.filter(n=>n.otStatus==='pending' && n.userId!==currentUserId
      && (!n.otApproverName || n.otApproverName===currentUserDisplayName));
    otWrap.style.display = pendings.length ? '' : 'none';
    document.getElementById('ot-approve-list').innerHTML = pendings.map(n=>`
      <div class="nippo-row" style="cursor:default">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700">${esc(n.userName)}　${gbDateLabel(n.workDate)}</div>
          <div style="font-size:11px;color:var(--text-sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.projectName)}　${n.startTime}〜${n.endTime}（休憩${n.breakMinutes}分）</div>
          <div style="font-size:11px;color:var(--danger);font-weight:700">残業 ${gbMinLabel(n.overtimeMinutes)}</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn xs" onclick="rejectOtNippo(${n.id})">却下</button>
          <button class="btn xs primary" onclick="approveOtNippo(${n.id})">承認</button>
        </div>
      </div>`).join('');
  } else {
    otWrap.style.display = 'none';
  }

  let list = dailyReports.filter(n=>n.workDate.slice(0,7)===nippoMonth);
  // 承認者でも一般社員（staff以外）の月次一覧は自分の日報のみ
  if(currentUserRole!=='staff') list = list.filter(n=>n.userId===currentUserId);

  // ── staff：月次集計（社員別）と絞り込み ──
  const sumWrap = document.getElementById('nippo-summary-wrap');
  if(currentUserRole==='staff'){
    sumWrap.style.display = '';
    const byUser = {};
    list.forEach(n=>{
      const u = byUser[n.userId] = byUser[n.userId]||{name:n.userName||'（名前未設定）',dates:new Set(),work:0,overtime:0};
      u.dates.add(n.workDate); u.work += n.workMinutes; u.overtime += n.overtimeMinutes;
    });
    const userIds = Object.keys(byUser);
    document.getElementById('nippo-summary').innerHTML = userIds.length
      ? `<table class="nippo-sum-table">
          <tr><th>社員</th><th style="text-align:right">出勤</th><th style="text-align:right">実働</th><th style="text-align:right">残業</th></tr>
          ${userIds.map(uid=>{
            const u = byUser[uid];
            return `<tr>
              <td>${esc(u.name)}</td>
              <td style="text-align:right">${u.dates.size}日</td>
              <td style="text-align:right">${gbMinLabel(u.work)}</td>
              <td style="text-align:right;${u.overtime>0?'color:var(--danger);font-weight:700':''}">${u.overtime>0?gbMinLabel(u.overtime):'—'}</td>
            </tr>`;
          }).join('')}
        </table>`
      : '<div class="empty" style="padding:14px">この月の日報はありません</div>';

    // 社員絞り込みプルダウン
    const sel = document.getElementById('nippo-user-filter');
    const prev = nippoFilterUser;
    sel.innerHTML = '<option value="">全員</option>' + userIds.map(uid=>`<option value="${uid}">${esc(byUser[uid].name)}</option>`).join('');
    sel.value = prev && userIds.includes(prev) ? prev : '';
    nippoFilterUser = sel.value;
    if(nippoFilterUser) list = list.filter(n=>n.userId===nippoFilterUser);
  } else {
    sumWrap.style.display = 'none';
    // carpenter：自分の月間合計
    const work = list.reduce((s,n)=>s+n.workMinutes,0);
    const overtime = list.reduce((s,n)=>s+n.overtimeMinutes,0);
    const days = new Set(list.map(n=>n.workDate)).size;
    document.getElementById('nippo-my-total').innerHTML =
      `出勤 <b>${days}日</b>　実働 <b>${gbMinLabel(work)}</b>　残業 <b style="${overtime>0?'color:var(--danger)':''}">${overtime>0?gbMinLabel(overtime):'なし'}</b>`;
  }

  // ── 日報一覧 ──
  const wrap = document.getElementById('nippo-list');
  if(!list.length){
    wrap.innerHTML = '<div class="empty">この月の日報はありません</div>';
    return;
  }
  wrap.innerHTML = list.map(n=>`
    <div class="nippo-row" onclick="editNippo(${n.id})">
      <div style="flex-shrink:0;width:64px">
        <div style="font-size:12px;font-weight:700">${gbDateLabel(n.workDate)}</div>
        ${currentUserRole==='staff'?`<div style="font-size:10px;color:var(--text-muted)">${esc(n.userName)}</div>`:''}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.projectName||'（工事未設定）')}${n.workKind?`<span style="font-weight:400;color:var(--accent-t)">｜${esc(n.workKind)}</span>`:''}</div>
        <div style="font-size:11px;color:var(--text-sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.content)||'　'}</div>
      </div>
      <div style="flex-shrink:0;text-align:right">
        <div style="font-size:11px">${n.startTime}〜${n.endTime}</div>
        <div style="font-size:10px;${n.overtimeMinutes>0?'color:var(--danger);font-weight:700':'color:var(--text-muted)'}">${n.overtimeMinutes>0?'残業 '+gbMinLabel(n.overtimeMinutes):gbMinLabel(n.workMinutes)}</div>
        ${n.overtimeMinutes>0 && OT_STATUS[n.otStatus] ? `<span class="status-badge ${OT_STATUS[n.otStatus].cls}" style="margin-top:2px">${OT_STATUS[n.otStatus].label}：${esc(n.otStatus==='pending' ? (n.otApproverName||'承認者未設定') : n.otReviewerName)}</span>` : ''}
      </div>
    </div>`).join('');
}

function nippoSetUserFilter(v){
  nippoFilterUser = v;
  renderNippo();
}

// ════ 出面表（給与計算用：前月21日〜当月20日の勤怠一覧） ════
// 表示中の月を「締め月」として出力する（例：7月度 ＝ 6/21〜7/20）

function dzDateStr(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function printDezura(){
  const [y,m] = (nippoMonth||gbThisMonth()).split('-').map(Number);
  const start = new Date(y, m-2, 21); // 前月21日
  const end = new Date(y, m-1, 20);   // 当月20日
  const dates = [];
  for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)) dates.push(new Date(d));
  const inPeriod = s => s && s>=dzDateStr(start) && s<=dzDateStr(end);

  // 社員ごとに日別マークと集計を組み立てる
  // 日別セル：現場番号（同日複数現場は「1·2」、＊＝残業あり）／休＝休日出勤／有＝有給／半＝半休／振＝振替休日
  const users = {}; // userId -> {name, marks:{date:mark}, siteByDate:{date:{nos:Set,ot:bool}}, work, overtime, days, ...}
  const getU = (id,name)=>users[id] = users[id]||{name:name||'（名前未設定）',marks:{},siteByDate:{},work:0,overtime:0,days:new Set(),holidayDays:0,leaveDays:0,subDays:0};

  // 現場（工事）ごとに番号を振り、人工（実働8時間＝1.0人工）を集計する
  const sites = {}; // siteName -> {no, total, byUser:{userName:ninku}}
  const getSite = name=>{
    const key = name||'（工事未設定）';
    if(!sites[key]) sites[key] = {no:Object.keys(sites).length+1, total:0, byUser:{}};
    return sites[key];
  };

  dailyReports.filter(n=>inPeriod(n.workDate)).forEach(n=>{
    const u = getU(n.userId, n.userName);
    u.work += n.workMinutes; u.overtime += n.overtimeMinutes; u.days.add(n.workDate);
    const site = getSite(n.projectName);
    const ninku = n.workMinutes/480;
    site.total += ninku;
    site.byUser[u.name] = (site.byUser[u.name]||0) + ninku;
    const cell = u.siteByDate[n.workDate] = u.siteByDate[n.workDate]||{nos:new Set(),ot:false};
    cell.nos.add(site.no);
    if(n.overtimeMinutes>0) cell.ot = true;
  });
  holidayRequests.filter(hr=>hr.status==='approved').forEach(hr=>{
    const u = getU(hr.userId, hr.userName);
    if(inPeriod(hr.workDate)){ u.marks[hr.workDate]='休'; u.holidayDays++; u.days.add(hr.workDate); }
    if(inPeriod(hr.substituteDate)){ u.marks[hr.substituteDate]=u.marks[hr.substituteDate]||'振'; u.subDays++; }
  });
  leaveRequests.filter(lr=>lr.status==='approved').forEach(lr=>{
    const u = getU(lr.userId, lr.userName);
    const half = lr.leaveType!=='全日';
    for(let d=new Date(lr.startDate+'T00:00:00'); dzDateStr(d)<=lr.endDate; d.setDate(d.getDate()+1)){
      const s = dzDateStr(d);
      if(!inPeriod(s)) continue;
      u.marks[s] = u.marks[s]||(half?'半':'有');
      u.leaveDays += half ? 0.5 : 1;
    }
  });

  const userIds = Object.keys(users).sort((a,b)=>users[a].name.localeCompare(users[b].name,'ja'));
  if(!userIds.length){ showToast('この期間の勤怠データがありません'); return; }

  const yobi = ['日','月','火','水','木','金','土'];
  const fmtH = min => (Math.round(min/60*10)/10).toFixed(1); // 時間（小数1桁）
  const periodLabel = `${start.getMonth()+1}/21〜${end.getMonth()+1}/20`;

  const head = dates.map(d=>{
    const wd = d.getDay();
    const bg = wd===0?'#fde8e8':wd===6?'#e8f0fd':'#f3efe6';
    return `<th style="background:${bg}"><div>${d.getMonth()+1===start.getMonth()+1&&d.getDate()===21||d.getDate()===1?`${d.getMonth()+1}/`:''}${d.getDate()}</div><div style="font-weight:400">${yobi[wd]}</div></th>`;
  }).join('');

  const rows = userIds.map(uid=>{
    const u = users[uid];
    const cells = dates.map(d=>{
      const s = dzDateStr(d);
      const special = u.marks[s]||'';           // 休・有・半・振
      const siteCell = u.siteByDate[s];         // 日報から：現場番号＋残業
      const siteTxt = siteCell ? [...siteCell.nos].sort((a,b)=>a-b).join('·') + (siteCell.ot?'＊':'') : '';
      const mk = special + siteTxt;             // 例：「1」「1·2＊」「休1」「有」
      const wd = d.getDay();
      const bg = mk?'' : (wd===0?'background:#fdf3f3':wd===6?'background:#f3f7fd':'');
      const color = special==='休'?'color:#b5302a;font-weight:700':special==='有'||special==='半'?'color:#2e7d52;font-weight:700':special==='振'?'color:#8a6000;font-weight:700':(siteCell?.ot?'font-weight:700':'');
      return `<td style="text-align:center;${bg};${color}">${mk}</td>`;
    }).join('');
    return `<tr>
      <td style="white-space:nowrap;font-weight:700">${esc(u.name)}</td>
      ${cells}
      <td style="text-align:right">${u.days.size}</td>
      <td style="text-align:right">${fmtH(u.work)}</td>
      <td style="text-align:right;${u.overtime>0?'font-weight:700':''}">${u.overtime>0?fmtH(u.overtime):''}</td>
      <td style="text-align:right">${u.holidayDays||''}</td>
      <td style="text-align:right">${u.leaveDays||''}</td>
      <td style="text-align:right">${u.subDays||''}</td>
    </tr>`;
  }).join('');

  // ── 現場別人工集計（番号順） ──
  const fmtNinku = v=>{
    const r = Math.round(v*100)/100;
    return Number.isInteger(r) ? r.toFixed(1) : String(r);
  };
  const siteNames = Object.keys(sites).sort((a,b)=>sites[a].no-sites[b].no);
  const siteTotal = siteNames.reduce((s,n)=>s+sites[n].total,0);
  const siteRows = siteNames.map(name=>{
    const st = sites[name];
    const breakdown = Object.keys(st.byUser).sort((a,b)=>st.byUser[b]-st.byUser[a])
      .map(un=>`${esc(un)} ${fmtNinku(st.byUser[un])}`).join('、');
    return `<tr>
      <td style="text-align:center;font-weight:700">${st.no}</td>
      <td>${esc(name)}</td>
      <td style="text-align:right;font-weight:700">${fmtNinku(st.total)}</td>
      <td>${breakdown}</td>
    </tr>`;
  }).join('');

  const html = `
  <style>
    @page{size:A3 landscape;margin:8mm}
    body{max-width:none !important;padding:12px !important}
    table.dz{border-collapse:collapse;width:100%;font-size:9px;table-layout:fixed}
    table.dz th,table.dz td{border:0.4pt solid #999;padding:2px 1px;overflow:hidden}
    table.dz th{font-weight:700;text-align:center;font-size:8px}
    table.dz td:first-child,table.dz th:first-child{width:64px}
    table.dz th.sum,table.dz td.sum{width:34px}
    table.st{border-collapse:collapse;font-size:10px;margin-top:10px}
    table.st th,table.st td{border:0.4pt solid #999;padding:3px 6px}
    table.st th{background:#f3efe6;font-weight:700}
  </style>
  <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:8px;flex-wrap:wrap">
    <h2 style="font-size:16px;margin:0">出面表　${y}年${m}月度</h2>
    <span style="font-size:11px">対象期間：${start.getFullYear()}/${periodLabel}（20日締め）</span>
    <span style="font-size:10px;color:#555">セルの数字＝出た現場の番号（下表参照）　＊＝残業あり　休=休日出勤　有=有給　半=半休　振=振替休日　※休日出勤・有給・振替は承認済みのみ</span>
  </div>
  <table class="dz">
    <tr><th>氏名</th>${head}<th class="sum">出勤<br>日数</th><th class="sum">実働<br>(h)</th><th class="sum">残業<br>(h)</th><th class="sum">休出<br>日数</th><th class="sum">有給<br>日数</th><th class="sum">振休<br>日数</th></tr>
    ${rows}
  </table>
  <div style="font-size:11px;font-weight:700;margin-top:12px">現場別人工集計（実働8時間＝1.0人工。日報の実働から算出）</div>
  <table class="st">
    <tr><th style="width:30px">No</th><th style="min-width:180px">現場（工事）</th><th style="width:60px">人工計</th><th>内訳（社員別）</th></tr>
    ${siteRows}
    <tr><td></td><td style="font-weight:700;text-align:right">合計</td><td style="text-align:right;font-weight:700">${fmtNinku(siteTotal)}</td><td></td></tr>
  </table>
  <div style="font-size:9px;color:#555;margin-top:6px">出力日時：${new Date().toLocaleString('ja-JP')}　手寄（てよせ）</div>`;

  printHtml(`出面表 ${y}年${m}月度`, html);
}
