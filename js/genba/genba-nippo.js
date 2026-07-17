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
    id: editingNippoId, workDate, projectId, projectName: project?.name||'',
    content, startTime, endTime, breakMinutes, workMinutes: work, overtimeMinutes: overtime,
    otStatus, otApproverName
  });

  if(otStatus==='pending'){
    showToast(`日報を保存し、${otApproverName}さんに残業を申請しました（承認待ち）`);
    if(notifyApprover){
      dbSendPushToNames([otApproverName], '残業承認のお願い',
        `${reportUserName}さん ${workDate.replace(/-/g,'/')} 残業${gbMinLabel(overtime)}（${project?.name||''}）`).catch(()=>{});
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
        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.projectName||'（工事未設定）')}</div>
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
