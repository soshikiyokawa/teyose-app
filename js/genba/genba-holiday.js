// ════ 休日出勤申請（申請・取り下げ・承認／却下） ════
// 承認プロセスは残業と同様：申請時に承認者を1人選び、その人だけに通知・リマインドされる

const HOLIDAY_STATUS = {
  pending:  {label:'申請中', cls:'pending'},
  approved: {label:'承認',   cls:'approved'},
  rejected: {label:'却下',   cls:'rejected'}
};

// 事前に振替休日を指定した休日出勤は「労働日の振替」＝休日労働ではないため割増しない。
// 出勤日より後に申請された場合は事前の振替にできないので、代休扱い（割増あり）とする。
function isFurikaeHoliday(hr){
  if(!hr || !hr.substituteDate) return false;
  const applied = hr.createdAt ? String(hr.createdAt).slice(0,10) : '';
  return !applied || applied <= hr.workDate;
}
// 画面表示用のラベル
function holidayKindLabel(hr){
  if(!hr.substituteDate) return {text:'休日労働（割増あり）', color:'var(--danger)'};
  return isFurikaeHoliday(hr)
    ? {text:'振替出勤（労働日の振替・割増なし）', color:'var(--accent-t)'}
    : {text:'代休（出勤日より後の申請のため割増あり）', color:'var(--warn-t)'};
}

// 振替休日を入れたら、割増の扱いがどうなるかをその場で示す
function holidaySubstituteChanged(){
  const el=document.getElementById('holiday-kind-note');
  if(!el) return;
  const sub=document.getElementById('holiday-substitute').value;
  const workDate=document.getElementById('holiday-date').value;
  const today=gbToday();
  if(!sub){
    el.style.color='var(--danger)';
    el.textContent='振替休日を指定しない場合は休日労働（割増あり）になります';
  } else if(workDate && workDate < today){
    el.style.color='var(--warn-t)';
    el.textContent='出勤日が過ぎているため代休の扱いになります（割増あり）。事前に指定した振替のみ割増なしです';
  } else {
    el.style.color='var(--accent-t)';
    el.textContent='労働日の振替として扱います（休日労働ではないため割増なし）';
  }
}

async function applyHoliday(){
  const workDate = document.getElementById('holiday-date').value;
  const projectId = Number(document.getElementById('holiday-project').value)||null;
  const reason = document.getElementById('holiday-reason').value.trim();
  const substituteDate = document.getElementById('holiday-substitute').value||null;
  const approverName = document.getElementById('holiday-approver').value;
  if(!workDate){ showToast('出勤日を入力してください'); return; }
  if(!projectId){ showToast('工事を選択してください'); return; }
  if(!reason){ showToast('作業内容・理由を入力してください'); return; }
  if(!approverName){ showToast('承認者を選択してください'); return; }
  const project = projects.find(p=>p.id===projectId);
  await dbAddHolidayRequest({workDate, projectId, projectName:project?.name||'', reason, substituteDate, approverName});
  document.getElementById('holiday-date').value = '';
  document.getElementById('holiday-reason').value = '';
  document.getElementById('holiday-substitute').value = '';
  document.getElementById('holiday-approver').value = '';
  await refreshGenba();
  // 休日出勤手当は時間数で計算するため、当日の日報も必要になる。その場で案内する
  openHolidayGuide(workDate, approverName, projectId);
}

// ── 申請後の案内（日報もセットで必要なことを伝える） ──
let _guideDate=null, _guideProjectId=null;
function openHolidayGuide(workDate, approverName, projectId){
  _guideDate=workDate; _guideProjectId=projectId||null;
  document.getElementById('holiday-guide-body').innerHTML =
    `<div style="font-size:13px;font-weight:700;margin-bottom:8px">${gbDateLabel(workDate)}の休日出勤を申請しました</div>
     <div style="font-size:12px;color:var(--text-sub);line-height:1.8">
       ${esc(approverName)}さんに通知しました。承認をお待ちください。<br><br>
       <b style="color:var(--danger)">休日出勤の手当は「働いた時間数」で計算します。</b>
       時間数は日報から集計するため、<b>当日の日報も必ず提出してください</b>。
       日報が無いと出面表に時間が入らず、手当を計算できません。
     </div>`;
  document.getElementById('holiday-guide-modal').classList.add('open');
}
function closeHolidayGuide(){
  document.getElementById('holiday-guide-modal').classList.remove('open');
  _guideDate=null; _guideProjectId=null;
}
// 案内から日報タブへ。日付（と工事）を入れた状態で開く
function goNippoFromGuide(){
  const date=_guideDate, pid=_guideProjectId;
  closeHolidayGuide();
  genbaTab('nippo');
  setTimeout(()=>{
    const dEl=document.getElementById('nippo-date');
    if(dEl && date) dEl.value=date;
    const pEl=document.getElementById('nippo-project');
    if(pEl && pid){ pEl.value=String(pid); if(typeof nippoProjectChanged==='function') nippoProjectChanged(); }
    document.getElementById('nippo-content')?.focus();
  },50);
}

// その日の日報を出しているか（休日出勤の時間数が出せるか）
function holidayHasNippo(hr){
  return dailyReports.some(n=>n.userId===hr.userId && n.workDate===hr.workDate);
}

// 一覧の「日報を書く」から、日付・工事を入れた状態で日報タブを開く
function goNippoFor(date, projectId){
  _guideDate=date; _guideProjectId=projectId||null;
  goNippoFromGuide();
}

async function cancelHoliday(id){
  if(!confirm('この申請を取り下げますか？')) return;
  await dbDeleteHolidayRequest(id);
  showToast('申請を取り下げました');
  await refreshGenba();
}

async function approveHoliday(id){
  const hr = holidayRequests.find(x=>x.id===id);
  if(!hr) return;
  if(!confirm(`${hr.userName}さんの ${gbDateLabel(hr.workDate)} の休日出勤を承認しますか？`)) return;
  await dbReviewHolidayRequest(id, 'approved', '');
  showToast('承認しました（本人に通知されます）');
  await refreshGenba();
}
async function rejectHoliday(id){
  const hr = holidayRequests.find(x=>x.id===id);
  if(!hr) return;
  const note = prompt(`${hr.userName}さんの ${gbDateLabel(hr.workDate)} の休日出勤を却下します。\n理由（本人に表示されます）：`);
  if(note===null) return;
  await dbReviewHolidayRequest(id, 'rejected', note.trim());
  showToast('却下しました（本人に通知されます）');
  await refreshGenba();
}

function holidayRowHtml(hr, forReview){
  const st = HOLIDAY_STATUS[hr.status]||HOLIDAY_STATUS.pending;
  const isMine = hr.userId===currentUserId;
  // 時間数は日報から集計するため、日報が無い日は目立たせる（却下分は対象外）
  const needNippo = hr.status!=='rejected' && !holidayHasNippo(hr);
  const nippoNote = needNippo
    ? `<div style="font-size:11px;color:var(--danger);font-weight:700;margin-top:2px">
         ⚠ 日報が未提出です（時間数を計算できません）
         ${isMine?`<button class="btn xs" style="margin-left:6px" onclick="event.stopPropagation();goNippoFor('${hr.workDate}',${hr.projectId||'null'})">日報を書く</button>`:''}
       </div>`
    : '';
  return `<div class="leave-row">
    <div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${gbDateLabel(hr.workDate)}${!isMine?`<span style="font-weight:400;color:var(--text-sub)">　${esc(hr.userName)}</span>`:''}</div>
        ${nippoNote}
        <div style="font-size:11px;color:var(--text-sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(hr.projectName||'（工事未設定）')}${hr.reason?'　'+esc(hr.reason):''}</div>
        ${hr.substituteDate?`<div style="font-size:11px;color:var(--accent-t)">振替休日：${gbDateLabel(hr.substituteDate)}</div>`:''}
        ${(()=>{const k=holidayKindLabel(hr);return `<div style="font-size:10px;color:${k.color};font-weight:700">${k.text}</div>`;})()}
        ${hr.status==='pending'?`<div style="font-size:10px;color:var(--text-muted)">承認者：${esc(hr.approverName||'未設定')}</div>`:''}
        ${hr.status!=='pending'?`<div style="font-size:10px;color:var(--text-muted)">${st.label}：${esc(hr.reviewerName)}${hr.reviewNote?'　'+esc(hr.reviewNote):''}</div>`:''}
      </div>
      <span class="status-badge ${st.cls}">${st.label}</span>
      ${forReview
        ? `<button class="btn xs" onclick="rejectHoliday(${hr.id})">却下</button>
           <button class="btn xs primary" onclick="approveHoliday(${hr.id})">承認</button>`
        : (hr.status==='pending' && isMine ? `<button class="btn xs" onclick="cancelHoliday(${hr.id})">取り下げ</button>` : '')}
      ${currentUserRole==='staff' && !forReview && !(hr.status==='pending' && isMine) ? `<button class="btn xs danger" onclick="adminDeleteHoliday(${hr.id})" title="申請を削除（管理者）">削除</button>` : ''}
    </div>
  </div>`;
}

// 管理者：間違って提出された休日出勤申請を削除（本人への通知はしない）
async function adminDeleteHoliday(id){
  const hr = holidayRequests.find(x=>x.id===id);
  if(!hr) return;
  if(!confirm(`${hr.userName}さんの休日出勤申請（${gbDateLabel(hr.workDate)}／${hr.projectName||'工事未設定'}）を削除しますか？\nこの操作は元に戻せません。`)) return;
  await dbDeleteHolidayRequest(id);
  showToast('休日出勤申請を削除しました');
  await refreshGenba();
}

function renderHoliday(){
  // ── 承認者のみ：自分宛の承認待ち一覧 ──
  const reviewWrap = document.getElementById('holiday-review-wrap');
  if(isOtApprover()){
    const pendings = holidayRequests.filter(hr=>hr.status==='pending' && hr.userId!==currentUserId
      && (!hr.approverName || hr.approverName===currentUserDisplayName));
    reviewWrap.style.display = pendings.length ? '' : 'none';
    document.getElementById('holiday-review-list').innerHTML = pendings.map(hr=>holidayRowHtml(hr,true)).join('');
  } else {
    reviewWrap.style.display = 'none';
  }

  // ── 自分の申請履歴 ──
  const mine = holidayRequests.filter(hr=>hr.userId===currentUserId);
  document.getElementById('holiday-my-list').innerHTML = mine.length
    ? mine.map(hr=>holidayRowHtml(hr,false)).join('')
    : '<div class="empty" style="padding:14px">申請履歴はありません</div>';

  // ── staff：全員の履歴（今年分） ──
  if(currentUserRole==='staff'){
    const year = String(new Date().getFullYear());
    const others = holidayRequests.filter(hr=>hr.userId!==currentUserId && hr.workDate.startsWith(year));
    document.getElementById('holiday-all-wrap').style.display = '';
    document.getElementById('holiday-all-list').innerHTML = others.length
      ? others.map(hr=>holidayRowHtml(hr,false)).join('')
      : '<div class="empty" style="padding:14px">今年の申請はありません</div>';
  } else {
    document.getElementById('holiday-all-wrap').style.display = 'none';
  }
}
