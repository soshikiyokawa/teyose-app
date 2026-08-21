// ════ 日報（作業内容・実働・残業時間の記録と月次集計） ════
// 実働 ＝ 終了 − 開始 − 休憩。残業 ＝ 実働のうち8時間（480分）を超えた分
// 残業が発生した日報は「申請中」となり、承認者の承認が必要（未承認の間は1時間ごとにリマインド通知）

const NIPPO_STANDARD_MINUTES = 480;

// 工事の選択肢に入れる「職業訓練校」（訓練校生の通学日。案件には紐づかない）
const NIPPO_SCHOOL = '職業訓練校';

// 役員だけが選べる「休み」。出面表では日曜日と同じ「－」で表す（実働・人工には数えない）
const NIPPO_REST = '休み';
function isNippoRestUser(){
  return typeof isLeaveExempt==='function' && isLeaveExempt(nippoOwnerName());
}

// 「欠勤」。出面表では赤い「欠」で出し、出勤日数・実働・人工には数えない。
// 選べるのは清川創史だけ（自分で自分を欠勤にすることはない）
const NIPPO_ABSENT = '欠勤';

// 工事ではなく勤怠の状態を表す選択肢（作業内容も時刻も使わない）
function isNippoStateName(name){ return name===NIPPO_REST || name===NIPPO_ABSENT; }

// ── 日報の二重登録さがし ──
// 同じ人・同じ日・同じ現場・同じ時刻の日報が2件以上あれば、まず入力の重複。
// 放っておくと実働時間が倍になり、人工・労務費・残業代まで多く出てしまうので、
// 出面表と給与まわりの画面で知らせる。
// （同じ日でも時刻が違えば午前・午後で分けた正しい入力なので拾わない）
function nippoDuplicates(start, end){
  const map = {};
  (dailyReports||[]).forEach(n=>{
    if(start && (n.workDate<start || n.workDate>end)) return;
    if(isNippoStateName(n.projectName)) return;
    const key = [n.userId, n.workDate, n.projectName, n.startTime, n.endTime].join('|');
    (map[key] = map[key] || []).push(n);
  });
  return Object.values(map).filter(v=>v.length>1).map(v=>({
    userId:v[0].userId, userName:v[0].userName, date:v[0].workDate,
    project:v[0].projectName, startTime:v[0].startTime, endTime:v[0].endTime,
    count:v.length, minutes:v.reduce((n,x)=>n+x.workMinutes,0), reports:v
  })).sort((a,b)=> a.date<b.date?-1 : a.date>b.date?1 : String(a.userName).localeCompare(String(b.userName),'ja'));
}
function nippoDupText(list){
  return list.map(d=>`${d.userName} ${d.date.slice(5).replace('-','/')} ${d.project}（${d.startTime}〜${d.endTime}）が${d.count}件・合計${Math.round(d.minutes/60*10)/10}時間`).join('／');
}
// 画面に出す注意書き。重複が無ければ空
function nippoDupWarnHtml(start, end){
  const list = nippoDuplicates(start, end);
  if(!list.length) return '';
  return `<div class="labor-warn danger">同じ日・同じ現場・同じ時刻の日報が重なっています。`
       + `実働時間が多く出て、人工も労務費も残業代も過大になります：${esc(nippoDupText(list))}。`
       + `「出面表を手直しする」からその日を開いて、余分なほうを削除してください。</div>`;
}

// 他人の日報を編集できる人（この人だけ。他は自分の日報のみ編集可）
const NIPPO_EDITOR = '清川創史';
function canEditOthersNippo(){ return currentUserDisplayName === NIPPO_EDITOR; }

// ── 日報を「誰の分」として書くか ──
// ふだんは自分。清川創史だけ、社員を選んで代わりに書いたり直したりできる
let nippoOwnerId = '';
function nippoOwnerName(){
  if(!canEditOthersNippo()) return currentUserDisplayName||'';   // ふだんは必ず自分の分
  const p = (typeof allProfiles!=='undefined' ? allProfiles : []).find(x=>x.id===nippoOwnerId);
  return p ? p.displayName : (currentUserDisplayName||'');
}
// 出面表に出る社員（管理者・一般社員。発注先は入らない）
function nippoEmployees(){
  return (typeof allProfiles!=='undefined' ? allProfiles : [])
    .filter(p=>p.role==='staff' || p.role==='carpenter')
    .sort((a,b)=>cmpEmployee(a.displayName, b.displayName));
}
function renderNippoOwnerSelect(){
  const wrap = document.getElementById('nippo-owner-wrap');
  if(!wrap) return;
  if(!canEditOthersNippo()){ wrap.style.display = 'none'; nippoOwnerId = currentUserId; return; }
  wrap.style.display = '';
  const sel = document.getElementById('nippo-owner');
  const emps = nippoEmployees();
  if(!nippoOwnerId || !emps.some(p=>p.id===nippoOwnerId)) nippoOwnerId = currentUserId;
  sel.innerHTML = emps.map(p=>
    `<option value="${p.id}">${esc(p.displayName)}${p.id===currentUserId?'（自分）':''}</option>`).join('');
  sel.value = nippoOwnerId;
  if(!sel.value && emps.length){ sel.selectedIndex = 0; nippoOwnerId = sel.value; }
}
function setNippoOwner(v){
  nippoOwnerId = v;
  renderGenbaProjectSelects();   // 「休み」（役員のみ）の出し分けを選んだ人に合わせる
  if(!editingNippoId) applyNippoDefaultTimes();   // 書きかけの新規なら、選んだ人の初期値に合わせる
}

// ── 日報の時刻の初期値 ──
// 所定労働時間が区分で違うので、その人の勤務区分に合わせて出す。
// 訓練校生は所定7.5時間なので 8:00〜17:30（休憩120分）。
// （割増賃金の計算に使う所定労働時間は js/genba/overtime-pay.js の設定側で持っている）
const NIPPO_DEFAULT_TIMES = {
  regular: {start:'08:00', end:'18:00', brk:'120'},
  trainee: {start:'08:00', end:'17:30', brk:'120'}
};
function nippoCalOf(userId){
  const p = (typeof allProfiles!=='undefined' ? allProfiles : []).find(x=>x.id===userId);
  return (p && p.workGroup==='訓練校生') ? 'trainee' : 'regular';
}
function nippoDefaultTimes(userId){ return NIPPO_DEFAULT_TIMES[nippoCalOf(userId)]; }
function applyNippoDefaultTimes(){
  const t = nippoDefaultTimes(nippoOwnerId || currentUserId);
  const set = (id,v)=>{ const el=document.getElementById(id); if(el) el.value=v; };
  set('nippo-start', t.start);
  set('nippo-end',   t.end);
  set('nippo-break', t.brk);
  if(typeof nippoRecalc==='function') nippoRecalc();
}

// 出面表・集計での社員の並び順（この順で先頭から。ここに無い人は末尾に五十音順）
const EMPLOYEE_ORDER = ['清川創史','清川伸二','清川太視','清川説志','清川優香','原口晴郎','山口大輔','梅田昭文','石橋実咲','梶原大地'];
function empOrderIndex(name){ const i=EMPLOYEE_ORDER.indexOf(name); return i<0?999:i; }
function cmpEmployee(nameA, nameB){ return empOrderIndex(nameA)-empOrderIndex(nameB) || String(nameA).localeCompare(String(nameB),'ja'); }

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

// 工事選択の変更：「その他」なら区分入力欄を表示、作業種別の出し分けも更新
function nippoProjectChanged(){
  const val = document.getElementById('nippo-project').value;
  const otherWrap = document.getElementById('nippo-other-wrap');
  if(otherWrap) otherWrap.style.display = (val==='other') ? '' : 'none';
  // 「休み」「欠勤」は作業内容も時刻も要らないので隠す
  const rest = isNippoStateName(val);
  ['nippo-content-wrap','nippo-time-wrap','nippo-calc-wrap'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.style.display = rest ? 'none' : '';
  });
  if(rest){
    const ot = document.getElementById('nippo-ot-approver-wrap');
    if(ot) ot.style.display = 'none';
  }
  nippoWorkKindToggle();
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
  nippoOwnerId = currentUserId;   // 誰の分かは「自分」に戻す
  renderNippoOwnerSelect();
  document.getElementById('nippo-date').value = gbToday();
  document.getElementById('nippo-project').value = '';
  document.getElementById('nippo-other').value = '';
  document.getElementById('nippo-work-kind').value = '';
  nippoProjectChanged();
  document.getElementById('nippo-content').value = '';
  applyNippoDefaultTimes();      // 訓練校生なら 8:00〜17:30（所定7.5時間）
  document.getElementById('nippo-ot-approver').value = '';
  document.getElementById('nippo-form-title').textContent = '日報を書く';
  document.getElementById('nippo-cancel-btn').style.display = 'none';
  document.getElementById('nippo-delete-btn').style.display = 'none';
  nippoRecalc();
}

async function saveNippo(){
  const workDate = document.getElementById('nippo-date').value;
  const projVal = document.getElementById('nippo-project').value;
  const content = document.getElementById('nippo-content').value.trim();
  const startTime = document.getElementById('nippo-start').value;
  const endTime = document.getElementById('nippo-end').value;
  const breakMinutes = Number(document.getElementById('nippo-break').value)||0;
  if(!workDate){ showToast('日付を入力してください'); return; }

  // 誰の分として保存するか。清川創史だけ他の社員を選べる（それ以外は自分＝元の書き手）
  const editing = editingNippoId ? dailyReports.find(x=>x.id===editingNippoId) : null;
  const ownerId = canEditOthersNippo() ? (nippoOwnerId||currentUserId)
                : (editing ? editing.userId : currentUserId);
  const ownerName = (typeof allProfiles!=='undefined' ? allProfiles : []).find(p=>p.id===ownerId)?.displayName
                || (editing ? editing.userName : (currentUserDisplayName||''));

  // 工事：案件を選択、または「職業訓練校」「その他」（案件に紐づかない）
  let projectId = null, projectName = '';
  if(isNippoStateName(projVal)){
    // 休み・欠勤：作業内容も時間も要らない。実働0で登録する
    projectName = projVal;
    await dbSaveNippo({
      id: editingNippoId, workDate, projectId:null, projectName, workKind:'',
      content: projectName, startTime:'00:00', endTime:'00:00', breakMinutes:0,
      workMinutes:0, overtimeMinutes:0, otStatus:'none', otApproverName:'',
      userId: ownerId, userName: ownerName
    });
    const who = ownerId!==currentUserId ? `${ownerName}さんを` : '';
    showToast(editingNippoId ? `${who}${projectName}に変更しました` : `${who}${projectName}として登録しました`);
    resetNippoForm();
    nippoMonth = nippoMonthOf(workDate);
    await refreshGenba();
    return;
  }
  if(projVal==='school'){
    projectName = NIPPO_SCHOOL;
  } else if(projVal==='other'){
    projectName = document.getElementById('nippo-other').value.trim();
    if(!projectName){ showToast('区分を入力してください（設計・事務・空き家管理など）'); return; }
  } else {
    projectId = Number(projVal)||null;
    if(!projectId){ showToast('工事を選択してください'); return; }
    projectName = projects.find(p=>p.id===projectId)?.name||'';
  }
  // 新築案件は作業種別（木工事／上棟／墨付け刻み）が必須（「その他」は対象外）
  const isShinchiku = nippoIsShinchiku(projectId);
  const workKind = isShinchiku ? document.getElementById('nippo-work-kind').value : '';
  if(isShinchiku && !workKind){ showToast('作業種別を選択してください'); return; }
  if(!content){ showToast('作業内容を入力してください'); return; }
  if(nippoParseHM(startTime)==null || nippoParseHM(endTime)==null){ showToast('開始・終了時刻を入力してください'); return; }
  if(nippoParseHM(endTime) <= nippoParseHM(startTime)){ showToast('終了時刻は開始時刻より後にしてください'); return; }
  const {work, overtime} = nippoCalc();

  // 残業がある場合は承認者を1人選んでもらう（その人だけに通知される）
  let otApproverName = '';
  if(overtime>0){
    otApproverName = document.getElementById('nippo-ot-approver').value;
    if(!otApproverName){ showToast('残業の承認者を選択してください'); return; }
  }

  // 残業の承認ステータスを決める：残業なし＝none／残業あり＝申請中
  // （承認・却下済みで残業時間も承認者も変わっていなければステータスを維持する）
  const prev = editing;
  let otStatus = 'none';
  if(overtime>0){
    otStatus = (prev && prev.overtimeMinutes===overtime && prev.otApproverName===otApproverName
                && (prev.otStatus==='approved'||prev.otStatus==='rejected'))
      ? prev.otStatus : 'pending';
  }
  const notifyApprover = otStatus==='pending' &&
    !(prev && prev.otStatus==='pending' && prev.overtimeMinutes===overtime && prev.otApproverName===otApproverName);

  const reportUserName = ownerName;
  await dbSaveNippo({
    id: editingNippoId, workDate, projectId, projectName, workKind,
    content, startTime, endTime, breakMinutes, workMinutes: work, overtimeMinutes: overtime,
    otStatus, otApproverName, userId: ownerId, userName: ownerName
  });

  if(otStatus==='pending'){
    showToast(`日報を保存し、${otApproverName}さんに残業を申請しました（承認待ち）`);
    if(notifyApprover){
      dbSendPushToNames([otApproverName], '残業承認のお願い',
        `${reportUserName}さん ${workDate.replace(/-/g,'/')} 残業${gbMinLabel(overtime)}（${projectName}）`, 'genba/nippo').catch(()=>{});
      // 社内チャットにも記録を残す（通知は承認者宛のみ。チャット転記は通知なし）
      dbAddChatMessage(INTERNAL_THREAD, {role:'me', type:'text', silent:true,
        text:`【残業申請】${workDate.replace(/-/g,'/')}　残業${gbMinLabel(overtime)}（${projectName}）\n承認者：${otApproverName}`}).catch(()=>{});
    }
  } else {
    const who = ownerId!==currentUserId ? `${ownerName}さんの` : '';
    showToast(editingNippoId ? `${who}日報を更新しました` : `${who}日報を登録しました`);
  }
  resetNippoForm();
  nippoMonth = nippoMonthOf(workDate); // 保存した日が入る「◯月度」を表示
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
  // 自分の日報以外を編集できるのは清川創史のみ（他は閲覧のみ）
  if(n.userId!==currentUserId && !canEditOthersNippo()){
    showToast('他の人の日報は編集できません');
    return;
  }
  editingNippoId = id;
  nippoOwnerId = n.userId;          // 誰の日報かを保った状態で開く
  renderNippoOwnerSelect();
  document.getElementById('nippo-date').value = n.workDate;
  renderGenbaProjectSelects();
  // 案件に紐づかない日報（projectIdなし・projectNameあり）は「職業訓練校」「その他」として復元
  if(n.projectId){
    // 完工済みの工事は一覧から外しているので、開き直したときだけ足して選ぶ
    genbaSelectProject(document.getElementById('nippo-project'), n.projectId);
    document.getElementById('nippo-other').value = '';
  } else if(isNippoStateName(n.projectName)){
    // 「休み」「欠勤」は選べる人が限られるので、一覧に無ければ足してから選ぶ
    const sel = document.getElementById('nippo-project');
    if(![...sel.options].some(o=>o.value===n.projectName))
      sel.insertAdjacentHTML('beforeend', `<option value="${esc(n.projectName)}">${esc(n.projectName)}</option>`);
    sel.value = n.projectName;
    document.getElementById('nippo-other').value = '';
  } else if(n.projectName===NIPPO_SCHOOL){
    document.getElementById('nippo-project').value = 'school';
    document.getElementById('nippo-other').value = '';
  } else {
    document.getElementById('nippo-project').value = 'other';
    document.getElementById('nippo-other').value = n.projectName||'';
  }
  document.getElementById('nippo-work-kind').value = n.workKind||'';
  nippoProjectChanged();
  document.getElementById('nippo-content').value = n.content;
  document.getElementById('nippo-start').value = n.startTime;
  document.getElementById('nippo-end').value = n.endTime;
  document.getElementById('nippo-break').value = String(n.breakMinutes);
  document.getElementById('nippo-ot-approver').value = n.otApproverName||'';
  document.getElementById('nippo-form-title').textContent =
    (n.userId!==currentUserId ? `日報を編集（${n.userName}）` : '日報を編集');
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
  const [y,m] = (nippoMonth||nippoMonthOf(gbToday())).split('-').map(Number);
  const d = new Date(y, m-1+delta, 1);
  nippoMonth = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  renderNippo();
}

// その日が入る「◯月度」（21日以降は翌月度）
function nippoMonthOf(dateStr){
  const [y,m,d] = String(dateStr||gbToday()).split('-').map(Number);
  const p = n => String(n).padStart(2,'0');
  if(d < 21) return `${y}-${p(m)}`;
  return m===12 ? `${y+1}-01` : `${y}-${p(m+1)}`;
}

// 「◯年◯月度」の期間（前月21日〜当月20日）。給与の締めと出面表に合わせる
function nippoPeriod(month){
  const [y,m] = (month||gbThisMonth()).split('-').map(Number);
  const p = n => String(n).padStart(2,'0');
  const py = m===1 ? y-1 : y;
  const pm = m===1 ? 12 : m-1;
  return {start:`${py}-${p(pm)}-21`, end:`${y}-${p(m)}-20`};
}

function renderNippo(){
  if(!nippoMonth) nippoMonth = nippoMonthOf(gbToday());  // 今日が入る「◯月度」
  renderDezuraPicker();
  renderNippoOwnerSelect();
  if(typeof renderPayrollCard==='function') renderPayrollCard();
  if(!document.getElementById('nippo-date').value) resetNippoForm();

  // 「◯月度」は給与の締めに合わせて前月21日〜当月20日（出面表と同じ区切り）
  const {start, end} = nippoPeriod(nippoMonth);
  const [y,m] = nippoMonth.split('-').map(Number);
  const md = s => { const [, mm, dd] = s.split('-'); return `${Number(mm)}/${Number(dd)}`; };
  document.getElementById('nippo-month-lbl').innerHTML =
    `${y}年${m}月度<span style="font-size:11px;font-weight:400;color:var(--text-sub)">（${md(start)}〜${md(end)}）</span>`;

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

  let list = dailyReports.filter(n=>n.workDate>=start && n.workDate<=end);
  // 承認者でも一般社員（staff以外）の月次一覧は自分の日報のみ
  if(currentUserRole!=='staff') list = list.filter(n=>n.userId===currentUserId);

  // ── staff：月次集計（社員別）と絞り込み ──
  const sumWrap = document.getElementById('nippo-summary-wrap');
  if(currentUserRole==='staff'){
    sumWrap.style.display = '';
    const byUser = {};
    list.forEach(n=>{
      const u = byUser[n.userId] = byUser[n.userId]||{name:n.userName||'（名前未設定）',dates:new Set(),work:0,overtime:0};
      if(isNippoStateName(n.projectName)) return;   // 「休み」「欠勤」は出勤日数・実働に数えない
      u.dates.add(n.workDate); u.work += n.workMinutes; u.overtime += n.overtimeMinutes;
    });
    const userIds = Object.keys(byUser).sort((a,b)=>cmpEmployee(byUser[a].name, byUser[b].name));
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
      : '<div class="empty" style="padding:14px">この期間の日報はありません</div>';

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
    const worked = list.filter(n=>!isNippoStateName(n.projectName));   // 「休み」「欠勤」は除く
    const work = worked.reduce((s,n)=>s+n.workMinutes,0);
    const overtime = worked.reduce((s,n)=>s+n.overtimeMinutes,0);
    const days = new Set(worked.map(n=>n.workDate)).size;
    document.getElementById('nippo-my-total').innerHTML =
      `出勤 <b>${days}日</b>　実働 <b>${gbMinLabel(work)}</b>　残業 <b style="${overtime>0?'color:var(--danger)':''}">${overtime>0?gbMinLabel(overtime):'なし'}</b>`;
  }

  // ── 日報一覧 ──
  const wrap = document.getElementById('nippo-list');
  if(!list.length){
    wrap.innerHTML = '<div class="empty">この期間の日報はありません</div>';
    return;
  }
  wrap.innerHTML = list.map(n=>{
    const rest = isNippoStateName(n.projectName);   // 休み・欠勤：作業内容も時刻も出さない
    const absent = n.projectName===NIPPO_ABSENT;
    return `
    <div class="nippo-row" onclick="editNippo(${n.id})" style="${(n.userId===currentUserId||canEditOthersNippo())?'':'cursor:default'}">
      <div style="flex-shrink:0;width:64px">
        <div style="font-size:12px;font-weight:700">${gbDateLabel(n.workDate)}</div>
        ${currentUserRole==='staff'?`<div style="font-size:10px;color:var(--text-muted)">${esc(n.userName)}</div>`:''}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${absent?'color:var(--danger)':rest?'color:var(--text-muted)':''}">${esc(n.projectName||'（工事未設定）')}${n.workKind?`<span style="font-weight:400;color:var(--accent-t)">｜${esc(n.workKind)}</span>`:''}</div>
        ${rest?'':`<div style="font-size:11px;color:var(--text-sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.content)||'　'}</div>`}
      </div>
      <div style="flex-shrink:0;text-align:right">
        ${rest ? '<div style="font-size:11px;color:var(--text-muted)">－</div>' : `
        <div style="font-size:11px">${n.startTime}〜${n.endTime}</div>
        <div style="font-size:10px;${n.overtimeMinutes>0?'color:var(--danger);font-weight:700':'color:var(--text-muted)'}">${n.overtimeMinutes>0?'残業 '+gbMinLabel(n.overtimeMinutes):gbMinLabel(n.workMinutes)}</div>
        ${n.overtimeMinutes>0 && OT_STATUS[n.otStatus] ? `<span class="status-badge ${OT_STATUS[n.otStatus].cls}" style="margin-top:2px">${OT_STATUS[n.otStatus].label}：${esc(n.otStatus==='pending' ? (n.otApproverName||'承認者未設定') : n.otReviewerName)}</span>` : ''}`}
      </div>
    </div>`;
  }).join('');
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

// 出面表で見ている「◯月度」（'YYYY-MM'）。締め日の年月で表す
let dezuraMonth = '';

// いま進行中の締め月（21日以降は翌月度）
function dezuraCurrentMonth(){
  return nippoMonthOf(gbToday());
}

// 選べる月の一覧（いちばん古い記録の月から、いまの月度まで）
function dezuraMonthOptions(){
  const all = [
    ...(dailyReports||[]).map(n=>n.workDate),
    ...(leaveRequests||[]).map(l=>l.startDate),
    ...(holidayRequests||[]).map(h=>h.workDate)
  ].filter(Boolean).sort();
  const now = dezuraCurrentMonth();
  let cur = all.length ? nippoMonthOf(all[0]) : now;
  const out = [];
  for(let i=0; i<120 && cur<=now; i++){
    out.push(cur);
    const [y,m] = cur.split('-').map(Number);
    cur = m===12 ? `${y+1}-01` : `${y}-${String(m+1).padStart(2,'0')}`;
  }
  return out.reverse();   // 新しい月を上に
}

// 「2026年9月度（8/21〜9/20）」
function dezuraMonthLabel(month){
  const [y,m] = month.split('-').map(Number);
  const p = nippoPeriod(month);
  const md = s => { const [,mm,dd] = s.split('-'); return `${Number(mm)}/${Number(dd)}`; };
  return `${y}年${m}月度（${md(p.start)}〜${md(p.end)}）`;
}

// 出面表のカード（月を選ぶプルダウンと開くボタン）
function renderDezuraPicker(){
  // 手直しボタンは清川創史だけに出す
  const ew = document.getElementById('dezura-edit-wrap');
  if(ew) ew.style.display = canEditOthersNippo() ? '' : 'none';
  const sel = document.getElementById('dezura-month');
  if(!sel) return;
  const opts = dezuraMonthOptions();
  if(!dezuraMonth || !opts.includes(dezuraMonth)) dezuraMonth = dezuraCurrentMonth();
  sel.innerHTML = opts.map(mo=>{
    const now = mo===dezuraCurrentMonth() ? '　※進行中' : '';
    return `<option value="${mo}">${dezuraMonthLabel(mo)}${now}</option>`;
  }).join('');
  sel.value = dezuraMonth;
}
function setDezuraMonth(v){ dezuraMonth = v; }

function printDezura(month){
  // 指定した「◯月度」（20日締め）を出す。省略時は画面で選んでいる月度
  const mo = month || dezuraMonth || dezuraCurrentMonth();
  const p = nippoPeriod(mo);
  const start = new Date(p.start + 'T00:00:00');
  const end   = new Date(p.end   + 'T00:00:00');
  const y = end.getFullYear();      // 「◯月度」は締め日（end）の年月で表す
  const m = end.getMonth() + 1;
  const dates = [];
  for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)) dates.push(new Date(d));
  const inPeriod = s => s && s>=dzDateStr(start) && s<=dzDateStr(end);

  // 社員ごとに日別マークと集計を組み立てる
  // 日別セル：現場番号（同日複数現場は「1·2」、＊＝残業あり）／休＝休日出勤／有＝有給／半＝半休／振＝振替休日
  const users = {}; // userId -> {name, marks:{date:mark}, siteByDate:{date:{nos:Set,ot:bool}}, work, overtime, days, ...}
  const getU = (id,name)=>users[id] = users[id]||{name:name||'（名前未設定）',marks:{},siteByDate:{},work:0,overtime:0,days:new Set(),
    holidayDays:0,leaveDays:0,subDays:0,absenceDays:0,
    minByDate:{},              // 日ごとの実働（分）＝日報から。休日出勤の時間数に使う
    holidayDates:new Set(),    // 承認済みの休日出勤日（全部）
    premiumDates:new Set(),    // うち休日労働（割増あり）
    furikaeDates:new Set(),    // うち事前の振替出勤（労働日の振替＝割増なし）
    restDates:new Set()};      // 役員が日報で「休み」とした日（日曜日と同じ表記にする）
                               // ※欠勤は marks に直接「欠」を入れる

  // 現場（工事）ごとに番号を振り、人工（実働8時間＝1.0人工）を集計する
  const sites = {}; // siteName -> {no, total, byUser:{userName:ninku}}
  const getSite = name=>{
    const key = name||'（工事未設定）';
    if(!sites[key]) sites[key] = {no:Object.keys(sites).length+1, total:0, byUser:{}};
    return sites[key];
  };

  dailyReports.filter(n=>inPeriod(n.workDate)).forEach(n=>{
    const u = getU(n.userId, n.userName);
    // 「休み」は働いていないので、出勤日数・実働・人工には数えない
    if(n.projectName===NIPPO_REST){ u.restDates.add(n.workDate); return; }
    // 「欠勤」も同じく数えない。表には赤い「欠」で出し、欠勤日数だけ増やす
    if(n.projectName===NIPPO_ABSENT){
      if(u.marks[n.workDate]!=='欠'){ u.marks[n.workDate]='欠'; u.absenceDays += 1; }
      return;
    }
    u.work += n.workMinutes; u.overtime += n.overtimeMinutes; u.days.add(n.workDate);
    u.minByDate[n.workDate] = (u.minByDate[n.workDate]||0) + n.workMinutes;
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
    const furikae = isFurikaeHoliday(hr);   // 事前の振替＝労働日の振替なので割増しない
    if(inPeriod(hr.workDate)){
      u.marks[hr.workDate] = furikae ? '替' : '休';
      u.holidayDays++; u.days.add(hr.workDate); u.holidayDates.add(hr.workDate);
      (furikae ? u.furikaeDates : u.premiumDates).add(hr.workDate);
    }
    if(inPeriod(hr.substituteDate)){ u.marks[hr.substituteDate]=u.marks[hr.substituteDate]||'振'; u.subDays++; }
  });
  leaveRequests.filter(lr=>lr.status==='approved').forEach(lr=>{
    const u = getU(lr.userId, lr.userName);
    const half = lr.leaveType!=='全日';
    // 有給の残日数が足りず、欠勤扱いにした日（承認のときに決まる）
    const absent = new Set(Array.isArray(lr.absenceDates) ? lr.absenceDates : []);
    for(let d=new Date(lr.startDate+'T00:00:00'); dzDateStr(d)<=lr.endDate; d.setDate(d.getDate()+1)){
      const s = dzDateStr(d);
      if(!inPeriod(s)) continue;
      if(u.marks[s]==='欠') continue;   // 日報で欠勤にした日は、そちらを優先して二重に数えない
      if(absent.has(s)){
        u.marks[s] = u.marks[s]||'欠';
        u.absenceDays += half ? 0.5 : 1;
      } else {
        u.marks[s] = u.marks[s]||(half?'半':'有');
        u.leaveDays += half ? 0.5 : 1;
      }
    }
  });

  // 休日判定（勤務カレンダー基準。未設定の区分は土日を休みとみなすフォールバック）
  const _profByUser = {}; (typeof allProfiles!=='undefined'?allProfiles:[]).forEach(p=>{ _profByUser[p.id]=p; });
  function isHolidayForUser(uid, dateStr, dow){
    const p = _profByUser[uid];
    const cal = (p && p.workGroup==='訓練校生') ? 'trainee' : 'regular';
    const set = (typeof workHolidays!=='undefined' && workHolidays) ? workHolidays[cal] : null;
    if(set && set.size) return set.has(dateStr);   // カレンダー設定済み→それに従う
    return dow===0 || dow===6;                       // 未設定→土日を休みとみなす
  }

  const userIds = Object.keys(users).sort((a,b)=>cmpEmployee(users[a].name, users[b].name));
  if(!userIds.length){ showToast('この期間の勤怠データがありません'); return; }

  const yobi = ['日','月','火','水','木','金','土'];
  const fmtH = min => (Math.round(min/60*10)/10).toFixed(1); // 時間（小数1桁）
  const periodLabel = `${start.getMonth()+1}/21〜${end.getMonth()+1}/20`;

  const head = dates.map(d=>{
    const wd = d.getDay();
    const bg = wd===0?'#fde8e8':wd===6?'#e8f0fd':'#f3efe6';
    return `<th class="${wd===0?'dz-sun':''}" style="background:${bg}"><div>${d.getMonth()+1===start.getMonth()+1&&d.getDate()===21||d.getDate()===1?`${d.getMonth()+1}/`:''}${d.getDate()}</div><div style="font-weight:400">${yobi[wd]}</div></th>`;
  }).join('');

  const rows = userIds.map(uid=>{
    const u = users[uid];
    const cells = dates.map(d=>{
      const s = dzDateStr(d);
      const special = u.marks[s]||'';           // 休・有・半・振
      const siteCell = u.siteByDate[s];         // 日報から：現場番号＋残業
      const siteTxt = siteCell ? [...siteCell.nos].sort((a,b)=>a-b).join('·') + (siteCell.ot?'＊':'') : '';
      const wd = d.getDay();
      let mk = special + siteTxt;                // 例：「1」「1·2＊」「休1」「有」
      // 日報で「休み」とした日は、日曜日と同じ「－」で表す
      if(!mk && u.restDates.has(s)) mk = '－';
      // 休日（勤務カレンダー基準）で活動が無ければ「－」。残る空欄＝出勤日なのに未入力
      if(!mk && isHolidayForUser(uid, s, wd)) mk = '－';
      const missing = !mk;                       // 出勤日で記入なし
      // 休日出勤の日は、日報の実働時間を2行目に出す（給与計算で使うため）
      const isHol = u.holidayDates.has(s);
      const holMin = isHol ? (u.minByDate[s]||0) : 0;
      const holNoNippo = isHol && !holMin;       // 休日出勤の承認はあるが日報が無い
      const sub = isHol ? `<div style="font-size:9px;font-weight:700">${holNoNippo?'日報?':fmtH(holMin)}</div>` : '';
      const bg = holNoNippo ? 'background:#ffcdd2'   // 時間が出せない＝要確認
               : mk==='－' ? 'background:#f2efe8'
               : missing   ? 'background:#ffe0b2'  // 未入力を目立たせる
               : '';
      const color = special==='欠'?'color:#b5302a;font-weight:700'      // 欠勤（有給の残が足りなかった日）
        : special==='休'?'color:#b5302a;font-weight:700'      // 休日労働（割増あり）
        : special==='替'?'color:#1f6f8b;font-weight:700'                 // 振替出勤（割増なし）
        : (special==='有'||special==='半')?'color:#2e7d52;font-weight:700'
        : special==='振'?'color:#8a6000;font-weight:700'
        : mk==='－'?'color:#bbb'
        : (siteCell?.ot?'font-weight:700':'');
      return `<td class="${wd===0?'dz-sun':''}" style="text-align:center;${bg};${color}">${mk}${sub}</td>`;
    }).join('');
    // 休日出勤の実働時間。割増対象（休日労働）と振替出勤（割増なし）を分けて集計する
    const sumMin = set => { let min=0, miss=0;
      set.forEach(s=>{ const m=u.minByDate[s]||0; min+=m; if(!m) miss++; });
      return {min, miss};
    };
    const prem = sumMin(u.premiumDates);
    const furi = sumMin(u.furikaeDates);
    const hCell = (v, warnLabel) => `<td class="sum" style="text-align:right;${v.miss?'background:#ffcdd2;':''}${v.min?'font-weight:700':''}">${v.min?fmtH(v.min):''}${v.miss?`<div style="font-size:8px;font-weight:700">日報${v.miss}件</div>`:''}</td>`;
    // 役員は休日労働割増の対象外。時間が入っていると紛らわしいので「—」にする
    const noPremium = typeof isLeaveExempt==='function' && isLeaveExempt(u.name);
    const premCell = noPremium
      ? '<td class="sum" style="text-align:right;color:#bbb">—</td>'
      : hCell(prem);
    return `<tr>
      <td style="white-space:nowrap;font-weight:700">${esc(u.name)}</td>
      ${cells}
      <td class="sum sum-first" style="text-align:right">${u.days.size}</td>
      <td class="sum" style="text-align:right">${fmtH(u.work)}</td>
      <td class="sum" style="text-align:right;${u.overtime>0?'font-weight:700':''}">${u.overtime>0?fmtH(u.overtime):''}</td>
      <td class="sum" style="text-align:right">${u.holidayDays||''}</td>
      ${premCell}
      ${hCell(furi)}
      <td class="sum" style="text-align:right">${u.leaveDays||''}</td>
      <td class="sum" style="text-align:right;${u.absenceDays>0?'color:#b5302a;font-weight:700':''}">${u.absenceDays||''}</td>
      <td class="sum" style="text-align:right">${u.subDays||''}</td>
    </tr>`;
  }).join('');

  // ── 現場別人工集計（番号順） ──
  const fmtNinku = v=>{
    const r = Math.round(v*100)/100;
    return Number.isInteger(r) ? r.toFixed(1) : String(r);
  };
  // 並び順：「工事」が付くものを人工の多い順に上へ。そのあと訓練校・研修・設計・事務
  const SITE_TAIL_ORDER = ['訓練校','研修','設計','事務'];
  const siteRank = name => {
    const s = String(name||'');
    if(s.includes('工事')) return 0;
    const i = SITE_TAIL_ORDER.findIndex(k=>s.includes(k));
    if(i>=0) return 2+i;          // 訓練校=2／研修=3／設計=4／事務=5
    return 1;                      // どちらでもないもの（工事名など）は工事の次
  };
  const siteNames = Object.keys(sites).sort((a,b)=>{
    const ra=siteRank(a), rb=siteRank(b);
    if(ra!==rb) return ra-rb;
    // 同じ区分の中は人工の多い順。同数なら番号順
    return (sites[b].total-sites[a].total) || (sites[a].no-sites[b].no);
  });
  const siteTotal = siteNames.reduce((s,n)=>s+sites[n].total,0);
  // 社員名を列に（上の表と同じ並び）。各セルはその現場でのその社員の人工数
  const empNames = userIds.map(uid=>users[uid].name);
  const empTotals = {}; empNames.forEach(e=>empTotals[e]=0);
  const empHead = empNames.map(e=>`<th style="min-width:52px;white-space:nowrap">${esc(e)}</th>`).join('');
  const siteRows = siteNames.map(name=>{
    const st = sites[name];
    const cells = empNames.map(e=>{ const v=st.byUser[e]||0; empTotals[e]+=v; return `<td style="text-align:right">${v?fmtNinku(v):''}</td>`; }).join('');
    return `<tr>
      <td style="text-align:center;font-weight:700">${st.no}</td>
      <td style="white-space:nowrap">${esc(name)}</td>
      <td style="text-align:right;font-weight:700">${fmtNinku(st.total)}</td>
      ${cells}
    </tr>`;
  }).join('');
  const empTotalCells = empNames.map(e=>`<td style="text-align:right;font-weight:700">${empTotals[e]?fmtNinku(empTotals[e]):''}</td>`).join('');

  const html = `
  <style>
    @page{size:A3 landscape;margin:8mm}
    body{max-width:none !important;padding:12px !important}
    /* 画面表示：横スクロールで各セルを読みやすいサイズに保つ。氏名列は左固定 */
    .dz-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #ddd;border-radius:6px}
    table.dz{border-collapse:collapse;font-size:12px}
    table.dz th,table.dz td{border:0.5px solid #bbb;padding:5px 3px;text-align:center;white-space:nowrap;min-width:26px}
    table.dz th{font-weight:700;background:#f3efe6;font-size:11px}
    table.dz td:first-child,table.dz th:first-child{min-width:78px;text-align:left;position:sticky;left:0;background:#fff;z-index:2}
    table.dz th:first-child{background:#f3efe6}
    table.dz .sum{min-width:46px}
    table.st{border-collapse:collapse;font-size:12px;margin-top:10px}
    table.st th,table.st td{border:0.5px solid #bbb;padding:5px 8px}
    table.st th{background:#f3efe6;font-weight:700}
    /* 印刷時：A3横1枚に収める（固定レイアウト・小さめ文字・固定列は解除） */
    @media print{
      /* 背景色（休日・未入力の色分け）を印刷にも出す */
      *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
      .dz-scroll{overflow:visible !important;border:none !important}
      table.dz{width:100% !important;table-layout:fixed;font-size:9px;border-collapse:collapse}
      /* 薄いグレーの罫線をすべてのセルに */
      table.dz th,table.dz td{border:0.3pt solid #b9b9b9 !important;padding:2px 1px;min-width:0 !important;overflow:hidden;position:static !important}
      table.dz th{font-size:8px;background:#f0ece3 !important}
      table.dz td:first-child,table.dz th:first-child{width:64px;min-width:0 !important}
      table.dz .sum{width:34px;min-width:0 !important}
      /* 氏名列の右・集計列の左と、日曜（週の区切り）だけ少し濃くして区切りを分かりやすく */
      table.dz th:first-child,table.dz td:first-child{border-right:0.7pt solid #8a8a8a !important}
      table.dz th.sum-first,table.dz td.sum-first{border-left:0.7pt solid #8a8a8a !important}
      table.dz th.dz-sun,table.dz td.dz-sun{border-left:0.7pt solid #8a8a8a !important}
      table.dz tr:last-child td{border-bottom:0.7pt solid #8a8a8a !important}
      table.st{font-size:10px;border-collapse:collapse}
      table.st th,table.st td{border:0.3pt solid #b9b9b9 !important;padding:3px 6px}
      table.st th{background:#f0ece3 !important}
    }
  </style>
  <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:8px;flex-wrap:wrap">
    <h2 style="font-size:16px;margin:0">出面表　${y}年${m}月度</h2>
    <span style="font-size:11px">対象期間：${start.getFullYear()}/${periodLabel}（20日締め）</span>
    <span style="font-size:10px;color:#555">セルの数字＝出た現場の番号（下表参照）　＊＝残業あり　<span style="color:#b5302a;font-weight:700">休</span>=休日労働（割増対象）　<span style="color:#1f6f8b;font-weight:700">替</span>=振替出勤（事前に振替休日を指定＝労働日の振替のため割増なし）　休・替の下段は日報の実働時間　有=有給　半=半休　<span style="color:#b5302a;font-weight:700">欠</span>=欠勤（有給の残日数が足りなかった日、または欠勤として登録した日）　振=振替休日　－=休日（公休）　<span style="background:#ffe0b2;padding:0 4px">■</span>＝未入力（要確認）　<span style="background:#ffcdd2;padding:0 4px">■</span>＝休日出勤の日報が未提出（時間数を計算できません）　※休日出勤・有給・振替は承認済みのみ　※役員は休日労働割増の対象外のため「休日労働(h)割増」は—</span>
  </div>
  ${(function(){
    const dup = nippoDuplicates(dzDateStr(start), dzDateStr(end));
    return dup.length ? `<div style="font-size:10px;color:#8a2018;background:#fdeaea;border-radius:4px;padding:5px 8px;margin-bottom:6px">
      同じ日・同じ現場・同じ時刻の日報が重なっています。実働時間と人工が多く出ています：${esc(nippoDupText(dup))}</div>` : '';
  })()}
  <div style="font-size:10px;color:#888;margin-bottom:4px">← 横スクロールで日付が見られます（氏名は固定）</div>
  <div class="dz-scroll">
  <table class="dz">
    <tr><th>氏名</th>${head}<th class="sum sum-first">出勤<br>日数</th><th class="sum">実働<br>(h)</th><th class="sum">残業<br>(h)</th><th class="sum">休出<br>日数</th><th class="sum" style="background:#fdeaea">休日労働<br>(h)割増</th><th class="sum" style="background:#e8f2f6">振替出勤<br>(h)</th><th class="sum">有給<br>日数</th><th class="sum">欠勤<br>日数</th><th class="sum">振休<br>日数</th></tr>
    ${rows}
  </table>
  </div>
  <div style="font-size:11px;font-weight:700;margin-top:12px">現場別人工集計（実働8時間＝1.0人工。日報の実働から算出）</div>
  <div class="dz-scroll">
  <table class="st">
    <tr><th style="width:30px">No</th><th style="min-width:160px">現場（工事）</th><th style="width:56px">人工計</th>${empHead}</tr>
    ${siteRows}
    <tr style="background:#f7f3eb"><td></td><td style="font-weight:700;text-align:right">合計</td><td style="text-align:right;font-weight:700">${fmtNinku(siteTotal)}</td>${empTotalCells}</tr>
  </table>
  </div>
  ${dezuraLaborHtml(mo)}
  <div style="font-size:9px;color:#555;margin-top:6px">出力日時：${new Date().toLocaleString('ja-JP')}　手寄（てよせ）</div>`;

  printHtml(`出面表 ${y}年${m}月度`, html);
}

// 出面表に付ける現場別労務費。
// 給与の入った表なので、清川創史さん・清川優香さんが開いたときだけ出す。
// （出面表そのものは社員なら誰でも開けるため、ここで必ず絞る）
function dezuraLaborHtml(month){
  if(typeof isPayrollAdmin!=='function' || !isPayrollAdmin()) return '';
  if(typeof laborAllocation!=='function' || typeof laborTableHtml!=='function') return '';
  let a;
  try{ a = laborAllocation(month); }catch(e){ console.warn('労務費を出せませんでした', e); return ''; }
  if(!a.siteNames.length && !Object.keys(a.unassigned).length) return '';
  return `
  <div style="font-size:11px;font-weight:700;margin-top:16px">現場別 労務費（時間外の賃金を含む）</div>
  <div style="font-size:10px;color:#555;margin-bottom:4px">
    給与ぶん＝基本給・家族手当・役付手当・技能・資格手当・固定残業代の合計を、その月度に出た現場の実働時間の割合で分けたもの。
    時間外＝残業代・休日手当・深夜割増・所定外の賃金で、起きた現場に乗せたもの。
    時間外を残業・休日出勤・深夜労働の別で見るときは「残業代・休日手当」の画面へ。
    この表は清川創史さん・清川優香さんにしか出ません。
  </div>
  <div class="dz-scroll">${laborTableHtml(a, true, 'total')}</div>
  <style>
    table.labor-tbl{border-collapse:collapse;font-size:10px;width:100%}
    table.labor-tbl th,table.labor-tbl td{border:0.4pt solid #b9b9b9;padding:3px 5px;white-space:nowrap}
    table.labor-tbl th{background:#f0ece3;font-weight:700;font-size:9px}
    table.labor-tbl td.num{text-align:right}
    table.labor-tbl td.site,table.labor-tbl th.site{text-align:left;min-width:140px}
    table.labor-tbl td.total{font-weight:700;background:#faf7f0}
    table.labor-tbl tr.sum td{font-weight:700;background:#f7f3eb;border-top:0.7pt solid #8a8a8a}
    table.labor-tbl tr.unassigned td{background:#fdf3ea}
  </style>`;
}
