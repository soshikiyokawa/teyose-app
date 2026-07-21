// ════ 有給申請（申請・取り下げ・承認／却下） ════
// 承認者は清川創史（固定）。申請の通知は承認者へ、申請内容は社内チャットにも自動転記される

const LEAVE_APPROVER = '清川創史';
let reviewingLeaveId = null;

function leaveTypeChanged(){
  const type = document.getElementById('leave-type').value;
  const endWrap = document.getElementById('leave-end-wrap');
  // 半休は1日単位なので終了日は使わない
  endWrap.style.display = type==='全日' ? '' : 'none';
  leaveDaysRecalc();
}

function leaveDaysRecalc(){
  const type = document.getElementById('leave-type').value;
  const start = document.getElementById('leave-start').value;
  let end = document.getElementById('leave-end').value;
  let days = 0;
  if(type!=='全日'){
    days = start ? 0.5 : 0;
  } else if(start){
    if(!end || end<start) end = start;
    days = Math.round((new Date(end)-new Date(start))/86400000)+1;
  }
  document.getElementById('leave-days-lbl').textContent = days>0 ? days+'日' : '—';
  return days;
}

async function applyLeave(){
  const type = document.getElementById('leave-type').value;
  const start = document.getElementById('leave-start').value;
  let end = document.getElementById('leave-end').value;
  const reason = document.getElementById('leave-reason').value.trim();
  if(!start){ showToast('取得日を入力してください'); return; }
  if(!reason){ showToast('理由を入力してください'); return; }
  if(type!=='全日' || !end || end<start) end = start;
  const days = leaveDaysRecalc();
  if(days<=0){ showToast('日付を確認してください'); return; }
  await dbAddLeaveRequest({startDate:start, endDate:end, leaveType:type, days, reason});
  document.getElementById('leave-start').value = '';
  document.getElementById('leave-end').value = '';
  document.getElementById('leave-reason').value = '';
  leaveDaysRecalc();
  showToast('有給を申請しました');
  await refreshGenba();
}

async function cancelLeave(id){
  if(!confirm('この申請を取り下げますか？')) return;
  await dbDeleteLeaveRequest(id);
  showToast('申請を取り下げました');
  await refreshGenba();
}

function leavePeriodLabel(lr){
  let s = gbDateLabel(lr.startDate);
  if(lr.endDate && lr.endDate!==lr.startDate) s += '〜'+gbDateLabel(lr.endDate);
  if(lr.leaveType!=='全日') s += '（'+lr.leaveType+'）';
  return s;
}

const LEAVE_STATUS = {
  pending:  {label:'申請中', cls:'pending'},
  approved: {label:'承認',   cls:'approved'},
  rejected: {label:'却下',   cls:'rejected'}
};

function leaveRowHtml(lr, forReview){
  const st = LEAVE_STATUS[lr.status]||LEAVE_STATUS.pending;
  const isMine = lr.userId===currentUserId;
  return `<div class="leave-row">
    <div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${leavePeriodLabel(lr)}<span style="font-weight:400;color:var(--text-muted)">　${lr.days}日</span></div>
        ${currentUserRole==='staff' && !isMine ? `<div style="font-size:11px;color:var(--text-sub)">${esc(lr.userName)}</div>` : ''}
        ${lr.reason ? `<div style="font-size:11px;color:var(--text-sub)">${esc(lr.reason)}</div>` : ''}
        ${lr.status!=='pending' && lr.reviewNote ? `<div style="font-size:11px;color:var(--text-muted)">↳ ${esc(lr.reviewNote)}</div>` : ''}
      </div>
      <span class="status-badge ${st.cls}">${st.label}</span>
      ${forReview
        ? `<button class="btn xs primary" onclick="openLeaveReview(${lr.id})">確認</button>`
        : (lr.status==='pending' && isMine ? `<button class="btn xs" onclick="cancelLeave(${lr.id})">取り下げ</button>` : '')}
      ${currentUserRole==='staff' && !(lr.status==='pending' && isMine && !forReview) ? `<button class="btn xs danger" onclick="adminDeleteLeave(${lr.id})" title="申請を削除（管理者）">削除</button>` : ''}
    </div>
  </div>`;
}

// 管理者：間違って提出された有給申請を削除（本人への通知はしない）
async function adminDeleteLeave(id){
  const lr = leaveRequests.find(x=>x.id===id);
  if(!lr) return;
  if(!confirm(`${lr.userName}さんの有給申請（${leavePeriodLabel(lr)}　${lr.days}日）を削除しますか？\nこの操作は元に戻せません。`)) return;
  await dbDeleteLeaveRequest(id);
  showToast('有給申請を削除しました');
  await refreshGenba();
}

function renderLeave(){
  if(!document.getElementById('leave-type').value) document.getElementById('leave-type').value = '全日';

  // ── 承認者（清川創史）のみ：承認待ち一覧 ──
  const reviewWrap = document.getElementById('leave-review-wrap');
  if(currentUserDisplayName===LEAVE_APPROVER){
    reviewWrap.style.display = '';
    const pendings = leaveRequests.filter(lr=>lr.status==='pending' && lr.userId!==currentUserId);
    document.getElementById('leave-review-list').innerHTML = pendings.length
      ? pendings.map(lr=>leaveRowHtml(lr,true)).join('')
      : '<div class="empty" style="padding:14px">承認待ちの申請はありません</div>';
  } else {
    reviewWrap.style.display = 'none';
  }

  // ── 自分の申請履歴 ──
  const mine = leaveRequests.filter(lr=>lr.userId===currentUserId);
  document.getElementById('leave-my-list').innerHTML = mine.length
    ? mine.map(lr=>leaveRowHtml(lr,false)).join('')
    : '<div class="empty" style="padding:14px">申請履歴はありません</div>';

  // ── staff：全員の履歴（今年分。申請中も含めて表示＝間違い申請の削除用） ──
  if(currentUserRole==='staff'){
    const year = String(new Date().getFullYear());
    const others = leaveRequests.filter(lr=>lr.userId!==currentUserId && lr.startDate.startsWith(year));
    document.getElementById('leave-all-wrap').style.display = '';
    document.getElementById('leave-all-list').innerHTML = others.length
      ? others.map(lr=>leaveRowHtml(lr,false)).join('')
      : '<div class="empty" style="padding:14px">今年の履歴はありません</div>';
  } else {
    document.getElementById('leave-all-wrap').style.display = 'none';
  }
}

// ── 承認モーダル ──
function openLeaveReview(id){
  const lr = leaveRequests.find(x=>x.id===id);
  if(!lr) return;
  reviewingLeaveId = id;
  document.getElementById('leave-review-detail').innerHTML =
    `<div style="font-size:14px;font-weight:700">${esc(lr.userName)}</div>
     <div style="font-size:13px;margin-top:2px">${leavePeriodLabel(lr)}　${lr.days}日</div>
     ${lr.reason?`<div style="font-size:12px;color:var(--text-sub);margin-top:2px">理由：${esc(lr.reason)}</div>`:''}`;
  document.getElementById('leave-review-note').value = '';
  document.getElementById('leave-review-modal').classList.add('open');
}
function closeLeaveReview(){
  document.getElementById('leave-review-modal').classList.remove('open');
  reviewingLeaveId = null;
}
async function reviewLeave(status){
  if(reviewingLeaveId==null) return;
  const note = document.getElementById('leave-review-note').value.trim();
  await dbReviewLeaveRequest(reviewingLeaveId, status, note);
  closeLeaveReview();
  showToast(status==='approved' ? '承認しました（本人に通知されます）' : '却下しました（本人に通知されます）');
  await refreshGenba();
}
