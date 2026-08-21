// ════ 出面表の手直し（清川創史のみ・全社員分） ════
//
// 出面表は日報・有給・休日出勤から自動で組み立てているので、
// ふつうは元の記録を直せば表も直る。ただし
//   ・本人が日報を出していない日を欠勤にしたい
//   ・承認した有給を、あとから欠勤に変えたい（または欠勤を有給に戻したい）
// といったことは、これまでアプリからできなかった。
//
// この画面では、社員と月度を選ぶと1日ずつ今の内容が並び、
// その場で「欠勤にする」「日報を書く・直す」ができる。
//
// 欠勤の入れ物は2つあり、どちらも出面表では赤い「欠」になる
//   ① 日報の工事を「欠勤」にしたもの        … 有給の申請が無い日
//   ② 有給申請の absence_dates に入れた日   … 残日数が足りず欠勤に振り替えた日

let dzeUserId = '';

function dzeUserName(uid){
  const p = (typeof allProfiles!=='undefined' ? allProfiles : []).find(x=>x.id===uid);
  return p ? p.displayName : '';
}

// 勤務カレンダー基準の休日判定（出面表と同じ考え方。未設定なら土日）
function dzeIsHoliday(uid, dateStr){
  const p = (typeof allProfiles!=='undefined' ? allProfiles : []).find(x=>x.id===uid);
  const cal = (p && p.workGroup==='訓練校生') ? 'trainee' : 'regular';
  const set = (typeof workHolidays!=='undefined' && workHolidays) ? workHolidays[cal] : null;
  if(set && set.size) return set.has(dateStr);
  const dow = new Date(dateStr+'T00:00:00').getDay();
  return dow===0 || dow===6;
}

// その人のその日に付いている記録を集める
function dzeDayState(uid, s){
  const reports = (typeof dailyReports!=='undefined' ? dailyReports : [])
    .filter(n=>n.userId===uid && n.workDate===s);
  const leave = (typeof leaveRequests!=='undefined' ? leaveRequests : [])
    .find(lr=>lr.userId===uid && lr.status==='approved' && lr.startDate<=s && s<=lr.endDate);
  const hols = (typeof holidayRequests!=='undefined' ? holidayRequests : []).filter(hr=>hr.status==='approved' && hr.userId===uid);
  return {
    date: s,
    reports,
    workReports:   reports.filter(n=>!isNippoStateName(n.projectName)),
    absentReport:  reports.find(n=>n.projectName===NIPPO_ABSENT),
    restReport:    reports.find(n=>n.projectName===NIPPO_REST),
    leave,
    leaveAbsent:   !!(leave && (leave.absenceDates||[]).includes(s)),
    holiday:       hols.find(hr=>hr.workDate===s),
    substitute:    hols.find(hr=>hr.substituteDate===s),
    publicHoliday: dzeIsHoliday(uid, s)
  };
}

// その日の見え方（出面表と同じ並び）
function dzeLabel(st){
  const parts = [];
  let cls = '';
  if(st.absentReport || st.leaveAbsent){ parts.push('欠勤'); cls = 'bad'; }
  if(st.holiday) parts.push(isFurikaeHoliday(st.holiday) ? '振替出勤' : '休日出勤');
  st.workReports.forEach(n=>parts.push(
    (n.projectName||'（工事未設定）') + '　' + gbMinLabel(n.workMinutes)
    + (n.overtimeMinutes>0 ? '（残業'+gbMinLabel(n.overtimeMinutes)+'）' : '')));
  if(st.leave && !st.leaveAbsent) parts.push(st.leave.leaveType==='全日' ? '有給' : '半休（'+st.leave.leaveType+'）');
  if(st.substitute) parts.push('振替休日');
  if(st.restReport) parts.push('休み');
  if(!parts.length){
    return st.publicHoliday ? {txt:'休日', cls:'muted'} : {txt:'未入力', cls:'miss'};
  }
  return {txt:parts.join('／'), cls};
}

// ── 画面 ──
function openDezuraEdit(){
  if(!canEditOthersNippo()){ showToast(`出面表を直せるのは${NIPPO_EDITOR}さんだけです`); return; }
  const emps = nippoEmployees();
  if(!dzeUserId || !emps.some(p=>p.id===dzeUserId)) dzeUserId = currentUserId;
  document.getElementById('dze-modal').classList.add('open');
  renderDezuraEdit();
}
function closeDezuraEdit(){ document.getElementById('dze-modal').classList.remove('open'); }
function setDzeUser(v){ dzeUserId = v; renderDezuraEdit(); }
function setDzeMonth(v){ dezuraMonth = v; renderDezuraEdit(); if(typeof renderDezuraPicker==='function') renderDezuraPicker(); }

function renderDezuraEdit(){
  const wrap = document.getElementById('dze-list');
  if(!wrap) return;
  const mo = dezuraMonth || dezuraCurrentMonth();

  const msel = document.getElementById('dze-month');
  if(msel){
    msel.innerHTML = dezuraMonthOptions().map(m=>`<option value="${m}">${dezuraMonthLabel(m)}</option>`).join('');
    msel.value = mo;
  }
  const usel = document.getElementById('dze-user');
  if(usel){
    usel.innerHTML = nippoEmployees().map(p=>`<option value="${p.id}">${esc(p.displayName)}</option>`).join('');
    usel.value = dzeUserId;
  }

  const {start, end} = nippoPeriod(mo);
  const yobi = ['日','月','火','水','木','金','土'];
  const rows = [];
  for(let d=new Date(start+'T00:00:00'); dzDateStr(d)<=end; d.setDate(d.getDate()+1)){
    const s = dzDateStr(d), wd = d.getDay();
    const st = dzeDayState(dzeUserId, s);
    const L = dzeLabel(st);
    const a = `'${s}'`;   // 日付は 'YYYY-MM-DD' 固定なのでそのまま埋めてよい

    // 欠勤のボタン：いまの状態によって役割が変わる
    let absentBtn = '';
    if(st.absentReport)      absentBtn = `<button class="btn xs" onclick="dzeUnabsent(${a})">欠勤をやめる</button>`;
    else if(st.leaveAbsent)  absentBtn = `<button class="btn xs" onclick="dzeLeaveBack(${a})">有給に戻す</button>`;
    else if(st.leave)        absentBtn = `<button class="btn xs danger" onclick="dzeLeaveToAbsent(${a})">欠勤に変える</button>`;
    else if(st.holiday || st.substitute) absentBtn = '';   // 休日出勤・振替休日は申請から直す
    else                     absentBtn = `<button class="btn xs danger" onclick="dzeMakeAbsent(${a})">欠勤にする</button>`;

    rows.push(`
      <div class="dze-row${wd===0?' sun':wd===6?' sat':''}">
        <div class="dze-date">${d.getMonth()+1}/${d.getDate()}<span>${yobi[wd]}</span></div>
        <div class="dze-txt ${L.cls}">${esc(L.txt)}</div>
        <div class="dze-btns">
          ${absentBtn}
          <button class="btn xs" onclick="dzeOpenNippo(${a})">日報</button>
        </div>
      </div>`);
  }
  wrap.innerHTML = rows.join('');
}

// ── 手直しの操作 ──
async function dzeAfterChange(msg){
  showToast(msg);
  await refreshGenba();
  renderDezuraEdit();
}

// 欠勤にする（その日の日報は消してから「欠勤」の日報を1件入れる）
async function dzeMakeAbsent(s){
  const uid = dzeUserId, name = dzeUserName(uid);
  const st = dzeDayState(uid, s);
  if(st.workReports.length){
    const what = st.workReports.map(n=>n.projectName||'（工事未設定）').join('・');
    if(!confirm(`${name}さんの ${gbDateLabel(s)} の日報（${what}）を削除して、欠勤にします。\nこの操作は元に戻せません。よろしいですか？`)) return;
  } else if(!confirm(`${name}さんの ${gbDateLabel(s)} を欠勤にしますか？`)) return;
  for(const n of st.workReports) await dbDeleteNippo(n.id);
  if(st.restReport) await dbDeleteNippo(st.restReport.id);
  if(!st.absentReport){
    await dbSaveNippo({
      workDate:s, projectId:null, projectName:NIPPO_ABSENT, workKind:'',
      content:NIPPO_ABSENT, startTime:'00:00', endTime:'00:00', breakMinutes:0,
      workMinutes:0, overtimeMinutes:0, otStatus:'none', otApproverName:'',
      userId:uid, userName:name
    });
  }
  await dzeAfterChange(`${gbDateLabel(s)} を欠勤にしました`);
}

// 欠勤をやめる（「欠勤」の日報を消す。その日は未入力に戻る）
async function dzeUnabsent(s){
  const st = dzeDayState(dzeUserId, s);
  if(!st.absentReport) return;
  if(!confirm(`${gbDateLabel(s)} の欠勤を取り消しますか？（その日は未入力に戻ります）`)) return;
  await dbDeleteNippo(st.absentReport.id);
  await dzeAfterChange(`${gbDateLabel(s)} の欠勤を取り消しました`);
}

// 承認済みの有給を、この日だけ欠勤に振り替える（有給の残日数は戻る）
async function dzeLeaveToAbsent(s){
  const st = dzeDayState(dzeUserId, s);
  if(!st.leave) return;
  if(!confirm(`${dzeUserName(dzeUserId)}さんの ${gbDateLabel(s)} の有給を欠勤に変えますか？\n有給の残日数はその分だけ戻ります。`)) return;
  await dbSetLeaveAbsence(st.leave.id, [...(st.leave.absenceDates||[]), s]);
  await dzeAfterChange(`${gbDateLabel(s)} を欠勤に変えました`);
}

// 欠勤に振り替えていた日を、有給に戻す
async function dzeLeaveBack(s){
  const st = dzeDayState(dzeUserId, s);
  if(!st.leave) return;
  if(!confirm(`${gbDateLabel(s)} を有給に戻しますか？（有給の残日数から差し引かれます）`)) return;
  await dbSetLeaveAbsence(st.leave.id, (st.leave.absenceDates||[]).filter(x=>x!==s));
  await dzeAfterChange(`${gbDateLabel(s)} を有給に戻しました`);
}

// その日の日報を開く（無ければ、その人・その日で新しく書き始める）
function dzeOpenNippo(s){
  const uid = dzeUserId;
  const st = dzeDayState(uid, s);
  const target = st.workReports[0] || st.absentReport || st.restReport;
  closeDezuraEdit();
  if(target){ editNippo(target.id); return; }
  resetNippoForm();
  nippoOwnerId = uid;
  renderNippoOwnerSelect();
  renderGenbaProjectSelects();
  document.getElementById('nippo-date').value = s;
  document.getElementById('nippo-form-title').textContent = `日報を書く（${dzeUserName(uid)}）`;
  document.getElementById('nippo-cancel-btn').style.display = '';
  document.getElementById('nippo-form-card').scrollIntoView({behavior:'smooth',block:'start'});
}
