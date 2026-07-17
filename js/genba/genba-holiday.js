// ════ 休日出勤申請（申請・取り下げ・承認／却下） ════
// 承認プロセスは残業と同様：申請時に承認者を1人選び、その人だけに通知・リマインドされる

const HOLIDAY_STATUS = {
  pending:  {label:'申請中', cls:'pending'},
  approved: {label:'承認',   cls:'approved'},
  rejected: {label:'却下',   cls:'rejected'}
};

async function applyHoliday(){
  const workDate = document.getElementById('holiday-date').value;
  const projectId = Number(document.getElementById('holiday-project').value)||null;
  const reason = document.getElementById('holiday-reason').value.trim();
  const approverName = document.getElementById('holiday-approver').value;
  if(!workDate){ showToast('出勤日を入力してください'); return; }
  if(!projectId){ showToast('工事を選択してください'); return; }
  if(!approverName){ showToast('承認者を選択してください'); return; }
  const project = projects.find(p=>p.id===projectId);
  await dbAddHolidayRequest({workDate, projectId, projectName:project?.name||'', reason, approverName});
  document.getElementById('holiday-date').value = '';
  document.getElementById('holiday-reason').value = '';
  document.getElementById('holiday-approver').value = '';
  showToast(`${approverName}さんに休日出勤を申請しました（承認待ち）`);
  await refreshGenba();
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
  return `<div class="leave-row">
    <div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${gbDateLabel(hr.workDate)}${!isMine?`<span style="font-weight:400;color:var(--text-sub)">　${esc(hr.userName)}</span>`:''}</div>
        <div style="font-size:11px;color:var(--text-sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(hr.projectName||'（工事未設定）')}${hr.reason?'　'+esc(hr.reason):''}</div>
        ${hr.status==='pending'?`<div style="font-size:10px;color:var(--text-muted)">承認者：${esc(hr.approverName||'未設定')}</div>`:''}
        ${hr.status!=='pending'?`<div style="font-size:10px;color:var(--text-muted)">${st.label}：${esc(hr.reviewerName)}${hr.reviewNote?'　'+esc(hr.reviewNote):''}</div>`:''}
      </div>
      <span class="status-badge ${st.cls}">${st.label}</span>
      ${forReview
        ? `<button class="btn xs" onclick="rejectHoliday(${hr.id})">却下</button>
           <button class="btn xs primary" onclick="approveHoliday(${hr.id})">承認</button>`
        : (hr.status==='pending' && isMine ? `<button class="btn xs" onclick="cancelHoliday(${hr.id})">取り下げ</button>` : '')}
    </div>
  </div>`;
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
