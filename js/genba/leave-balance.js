// ════ 有給残日数の計算・表示（就業規則 第54条にもとづく） ════
//
//  第1項　毎年10月1日に付与。雇用契約開始日の翌日以降に10月1日を迎えた回数に応じて
//         1回目10日／2回目11日／3回目12日／4回目14日／5回目16日／6回目18日／7回目以降20日
//  第4項　雇用契約開始日から6か月が経過した日が10月1日より前の場合は、その翌日を
//         1回目とみなして10日付与し、初めて迎えた10月1日を2回目とみなして11日付与する
//  第5項　未消化分は翌年度に限り繰り越せる（付与から2年で時効により消滅）
//  第9項　半日単位で取得できる（0.5日）
//  第10項 10日以上付与された社員は、付与日から1年以内に5日を取得する
//
//  ※ 出勤率80％以上（第2項・第3項）は満たしている前提で計算します。
//     満たさない年があった場合は「調整」で日数を差し引いてください。

// 役員は年次有給休暇の対象外（残日数の表示・管理を行わない）
const LEAVE_EXEMPT_NAMES = ['清川創史','清川伸二','清川太視','清川説志','清川優香'];
function isLeaveExempt(profOrName){
  const p = typeof profOrName==='string'
    ? (typeof allProfiles!=='undefined'?allProfiles:[]).find(x=>x.displayName===profOrName)
    : profOrName;
  const name = typeof profOrName==='string' ? profOrName : (p?.displayName||'');
  return LEAVE_EXEMPT_NAMES.includes(name) || p?.workGroup==='役員';
}

const LEAVE_GRANT_DAYS = [10,11,12,14,16,18,20];   // 1回目〜7回目以降
const LEAVE_DUTY_DAYS  = 5;                        // 第10項：年5日の取得義務
const LEAVE_EXPIRE_YEARS = 2;                      // 第5項：付与から2年で時効

// ── 日付ユーティリティ（'YYYY-MM-DD' の文字列で計算。時差でずれないようUTCで扱う） ──
function lvParse(s){ const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(s||'')); return m?{y:+m[1],m:+m[2],d:+m[3]}:null; }
function lvStr(y,m,d){ return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'); }
function lvAddDays(s,n){
  const p=lvParse(s); if(!p) return s;
  const dt=new Date(Date.UTC(p.y,p.m-1,p.d));
  dt.setUTCDate(dt.getUTCDate()+n);
  return dt.toISOString().slice(0,10);
}
function lvAddMonths(s,n){
  const p=lvParse(s); if(!p) return s;
  let y=p.y, m=p.m+n;
  y += Math.floor((m-1)/12); m = ((m-1)%12+12)%12+1;
  const last=new Date(Date.UTC(y,m,0)).getUTCDate();   // その月の末日
  return lvStr(y,m,Math.min(p.d,last));
}
function lvAddYears(s,n){ return lvAddMonths(s,n*12); }
function lvToday(){ const d=new Date(); return lvStr(d.getFullYear(),d.getMonth()+1,d.getDate()); }
function lvLabel(s){ const p=lvParse(s); return p ? `${p.y}/${p.m}/${p.d}` : '—'; }
function lvNum(n){ return Number.isInteger(n) ? String(n) : n.toFixed(1); }

// ── 付与予定（雇用契約開始日 → 付与日・付与日数・有効期限） ──
function leaveGrantSchedule(hireDate, asOf){
  const p=lvParse(hireDate);
  if(!p) return [];
  asOf = asOf || lvToday();
  // 「雇用契約開始日の翌日以降に迎える最初の10月1日」
  const octThisYear = lvStr(p.y,10,1);
  const firstOct = hireDate < octThisYear ? octThisYear : lvStr(p.y+1,10,1);
  const sixMonth = lvAddMonths(hireDate,6);

  const list=[];
  let no=1;
  // 第4項：6か月経過日が最初の10月1日より前なら、その翌日が1回目（10日）
  if(sixMonth < firstOct){ list.push({no:1, date:lvAddDays(sixMonth,1)}); no=2; }
  for(let d=firstOct; d<=asOf; d=lvAddYears(d,1)){ list.push({no, date:d}); no++; }

  return list
    .filter(g=>g.date<=asOf)
    .map(g=>({
      ...g,
      days: LEAVE_GRANT_DAYS[Math.min(g.no,LEAVE_GRANT_DAYS.length)-1],
      expire: lvAddDays(lvAddYears(g.date,LEAVE_EXPIRE_YEARS),-1)   // 期限日当日まで有効
    }));
}

// ── 残日数の計算（古い付与から順に消化。時効切れは繰り越さない） ──
function leaveLedger(userId, opt){
  opt = opt || {};
  const prof = (typeof allProfiles!=='undefined' ? allProfiles : []).find(p=>p.id===userId) || {};
  const hireDate = opt.hireDate!==undefined ? opt.hireDate : prof.hireDate;
  const adjust   = Number(opt.adjust!==undefined ? opt.adjust : (prof.leaveAdjust||0)) || 0;
  const asOf     = opt.asOf || lvToday();

  const grants = leaveGrantSchedule(hireDate, asOf).map(g=>({...g, used:0}));
  // 調整（アプリ導入前の残日数など）は一番古い持ち分として先に消化する
  const pool = adjust>0
    ? [{no:'調整', date:'0000-01-01', days:adjust, expire:'9999-12-31', used:0, isAdjust:true}, ...grants]
    : grants.slice();

  const mine = (typeof leaveRequests!=='undefined' ? leaveRequests : []).filter(lr=>lr.userId===userId);
  // 欠勤扱いにした分は有給を使っていないので、取得日数から差し引く
  const taken = mine.filter(lr=>lr.status==='approved')
    .map(lr=>({date:lr.startDate, days:Math.max(0, (Number(lr.days)||0) - leaveAbsenceDaysOf(lr))}))
    .filter(t=>t.days>0)
    .sort((a,b)=> a.date<b.date?-1:a.date>b.date?1:0);

  let shortage=0;   // どの付与でも賄えなかった取得（＝残日数が足りていない分）
  taken.forEach(t=>{
    let rest=t.days;
    for(const g of pool){
      if(rest<=0) break;
      if(g.date>t.date || g.expire<t.date) continue;   // 取得日に有効な付与だけを使う
      const avail=g.days-g.used;
      if(avail<=0) continue;
      const use=Math.min(avail,rest);
      g.used+=use; rest-=use;
    }
    if(rest>0) shortage+=rest;
  });

  const active = pool.filter(g=>g.expire>=asOf);                       // いま有効な付与
  const remain = active.reduce((s,g)=>s+(g.days-g.used),0) - shortage + (adjust<0?adjust:0);
  const pending = mine.filter(lr=>lr.status==='pending').reduce((s,lr)=>s+(Number(lr.days)||0),0);

  // 第10項：直近の付与（10日以上）について、付与日から1年以内に5日
  const dutyGrant = [...grants].reverse().find(g=>g.days>=10) || null;
  let duty=null;
  if(dutyGrant){
    const from=dutyGrant.date, to=lvAddDays(lvAddYears(from,1),-1);
    const t=taken.filter(x=>x.date>=from && x.date<=to).reduce((s,x)=>s+x.days,0);
    duty={from, deadline:to, taken:t, required:LEAVE_DUTY_DAYS, left:Math.max(0,LEAVE_DUTY_DAYS-t)};
  }

  return {
    hireDate, adjust, asOf, grants:pool, active, remain, pending, shortage, duty,
    granted: active.reduce((s,g)=>s+g.days,0),
    used: pool.reduce((s,g)=>s+g.used,0),
    thisTerm: active.length ? active[active.length-1] : null,   // 今年度の付与
    carried: active.slice(0,-1).reduce((s,g)=>s+(g.days-g.used),0)  // 繰越（期限内の古い分の残り）
  };
}

// ── 出勤日だけを数える（勤務カレンダーの休日は有給を消化しない） ──
function leaveCalOf(userId){
  const p=(typeof allProfiles!=='undefined'?allProfiles:[]).find(x=>x.id===userId);
  return (p && p.workGroup==='訓練校生') ? 'trainee' : 'regular';
}
function leaveWorkdaysBetween(start, end, userId){
  const set = (typeof workHolidays!=='undefined' && workHolidays) ? workHolidays[leaveCalOf(userId)] : null;
  let n=0, d=start;
  for(let i=0; i<400 && d<=end; i++){
    if(!set || !set.has(d)) n++;
    d=lvAddDays(d,1);
  }
  return n;
}

// ════ 表示 ════

function renderLeaveBalance(){
  const el=document.getElementById('leave-balance');
  if(!el) return;
  const lbl=document.getElementById('leave-balance-lbl');
  const applyLbl=document.getElementById('leave-apply-lbl');
  // 役員は対象外：残日数の欄そのものを表示しない
  const exempt=isLeaveExempt(currentUserDisplayName);
  el.style.display = exempt ? 'none' : '';
  if(lbl) lbl.style.display = exempt ? 'none' : '';
  if(applyLbl) applyLbl.style.marginTop = exempt ? '0' : '';
  if(exempt) return;
  if(typeof leaveColumnsReady!=='undefined' && !leaveColumnsReady){
    el.innerHTML=`<div style="padding:12px;font-size:12px;color:var(--text-sub);line-height:1.7">
      残日数の管理を使うには、データベースの準備が必要です。<br>
      ${currentUserRole==='staff' ? 'supabase/migration-genba20.sql を実行してください。' : '管理者に連絡してください。'}
    </div>`;
    return;
  }
  const prof=(typeof allProfiles!=='undefined'?allProfiles:[]).find(p=>p.id===currentUserId);
  if(!prof || !prof.hireDate){
    el.innerHTML=`<div style="padding:12px;font-size:12px;color:var(--text-sub);line-height:1.7">
      雇用契約開始日が未登録のため、残日数を計算できません。<br>
      ${currentUserRole==='staff'
        ? '下の「社員の有給管理」から登録してください。'
        : '管理者（清川創史）に登録を依頼してください。'}
    </div>`;
    return;
  }
  const L=leaveLedger(currentUserId);
  el.innerHTML=leaveBalanceCardHtml(L);
}

function leaveBalanceCardHtml(L){
  const term=L.thisTerm;
  const dutyHtml = L.duty ? (()=>{
    const pct=Math.min(100, L.duty.taken/L.duty.required*100);
    const done=L.duty.left<=0;
    return `<div style="margin-top:10px;padding-top:10px;border-top:0.5px solid var(--border)">
      <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-sub)">
        <span>年5日の取得義務</span>
        <span style="margin-left:auto;font-weight:700;color:${done?'var(--ok-t)':'var(--warn-t)'}">
          ${done?'達成':'あと'+lvNum(L.duty.left)+'日'}</span>
      </div>
      <div style="height:6px;border-radius:99px;background:var(--surface2);margin-top:5px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${done?'var(--ok-t)':'var(--warn-t)'}"></div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px">
        ${lvLabel(L.duty.from)}〜${lvLabel(L.duty.deadline)}に${L.duty.required}日　取得済み ${lvNum(L.duty.taken)}日
      </div>
    </div>`;
  })() : '';

  const rows = L.active.map(g=>`
    <div style="display:flex;align-items:baseline;gap:6px;font-size:11px;color:var(--text-sub);padding:1px 0">
      <span style="flex:1;min-width:0">${g.isAdjust?'調整（繰越など）':lvLabel(g.date)+' 付与'}</span>
      <span>${lvNum(g.days)}日中 <b style="color:var(--text)">${lvNum(g.days-g.used)}日</b>残</span>
      <span style="color:var(--text-muted);white-space:nowrap">${g.isAdjust?'':'期限 '+lvLabel(g.expire)}</span>
    </div>`).join('');

  return `<div style="padding:12px">
    <div style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap">
      <div>
        <div style="font-size:11px;color:var(--text-sub)">残日数</div>
        <div style="font-size:30px;font-weight:800;line-height:1.1;color:${L.remain<=0?'var(--danger)':'var(--accent-t)'}">
          ${lvNum(L.remain)}<span style="font-size:14px;font-weight:700">日</span></div>
      </div>
      <div style="margin-left:auto;text-align:right;font-size:11px;color:var(--text-sub);line-height:1.8">
        ${term&&!term.isAdjust?`<div>今年度付与　${lvNum(term.days)}日（${lvLabel(term.date)}）</div>`:''}
        <div>繰越　${lvNum(L.carried)}日</div>
        <div>取得済み　${lvNum(L.used)}日</div>
        ${L.pending>0?`<div style="color:var(--warn-t)">申請中　${lvNum(L.pending)}日</div>`:''}
      </div>
    </div>
    ${L.shortage>0?`<div style="margin-top:8px;font-size:11px;color:var(--danger);line-height:1.6">
      ※ 残日数を${lvNum(L.shortage)}日超えて取得しています。管理者に確認してください。</div>`:''}
    <div style="margin-top:10px;padding-top:8px;border-top:0.5px solid var(--border)">${rows}</div>
    ${dutyHtml}
  </div>`;
}

// ── 管理者：社員全員の残日数と設定 ──
function renderLeaveAdmin(){
  const wrap=document.getElementById('leave-admin-wrap');
  if(!wrap) return;
  if(currentUserRole!=='staff' || (typeof leaveColumnsReady!=='undefined' && !leaveColumnsReady)){ wrap.style.display='none'; return; }
  wrap.style.display='';
  const list=(typeof allProfiles!=='undefined'?allProfiles:[])
    .filter(p=>(p.role==='staff'||p.role==='carpenter') && !isLeaveExempt(p))   // 役員は対象外
    .sort((a,b)=>cmpEmployee(a.displayName,b.displayName));
  document.getElementById('leave-admin-list').innerHTML = list.map(p=>{
    if(!p.hireDate){
      return `<div class="leave-row"><div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700">${esc(p.displayName)}</div>
          <div style="font-size:11px;color:var(--text-muted)">雇用契約開始日が未登録</div></div>
        <button class="btn xs primary" onclick="openLeaveSetting('${p.id}')">設定</button>
      </div></div>`;
    }
    const L=leaveLedger(p.id);
    const duty=L.duty && L.duty.left>0
      ? `<span style="color:var(--warn-t)">5日義務あと${lvNum(L.duty.left)}日</span>`
      : (L.duty?'<span style="color:var(--ok-t)">5日義務達成</span>':'');
    return `<div class="leave-row"><div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${esc(p.displayName)}
          <span style="font-weight:400;color:var(--text-muted);font-size:11px">　入社 ${lvLabel(p.hireDate)}</span></div>
        <div style="font-size:11px;color:var(--text-sub)">
          付与 ${lvNum(L.granted)}日　取得 ${lvNum(L.used)}日　${duty}
          ${L.adjust?`　調整 ${L.adjust>0?'+':''}${lvNum(L.adjust)}日`:''}
        </div>
      </div>
      <div style="text-align:right;white-space:nowrap">
        <div style="font-size:16px;font-weight:800;color:${L.remain<=0?'var(--danger)':'var(--accent-t)'}">${lvNum(L.remain)}<span style="font-size:11px">日</span></div>
      </div>
      <button class="btn xs" onclick="openLeaveRecord('${p.id}')">実績</button>
      <button class="btn xs" onclick="openLeaveSetting('${p.id}')">設定</button>
    </div></div>`;
  }).join('') || '<div class="empty" style="padding:14px">社員がいません</div>';
}

// ════ 取得実績の入力（アプリを使い始める前に取得した分を登録する） ════
// 登録した分は承認済みの記録として残り、残日数と年5日の取得義務にそのまま反映される。

let _leaveRecordUserId=null;

function openLeaveRecord(userId){
  const p=(typeof allProfiles!=='undefined'?allProfiles:[]).find(x=>x.id===userId);
  if(!p) return;
  _leaveRecordUserId=userId;
  document.getElementById('leave-record-name').textContent=p.displayName;
  document.getElementById('leave-record-type').value='全日';
  document.getElementById('leave-record-start').value='';
  document.getElementById('leave-record-end').value='';
  leaveRecordTypeChanged();
  renderLeaveRecord();
  document.getElementById('leave-record-modal').classList.add('open');
}
function closeLeaveRecord(){
  document.getElementById('leave-record-modal').classList.remove('open');
  _leaveRecordUserId=null;
  renderLeave();
}
function leaveRecordTypeChanged(){
  const half=document.getElementById('leave-record-type').value!=='全日';
  document.getElementById('leave-record-end-wrap').style.display=half?'none':'';
  leaveRecordDaysRecalc();
}
function leaveRecordDaysRecalc(){
  const type=document.getElementById('leave-record-type').value;
  const start=document.getElementById('leave-record-start').value;
  let end=document.getElementById('leave-record-end').value;
  let days=0;
  if(type!=='全日') days = start?0.5:0;
  else if(start){
    if(!end || end<start) end=start;
    days = leaveWorkdaysBetween(start, end, _leaveRecordUserId);
  }
  document.getElementById('leave-record-days').textContent = days>0 ? lvNum(days)+'日' : '—';
  return days;
}

function renderLeaveRecord(){
  const p=(typeof allProfiles!=='undefined'?allProfiles:[]).find(x=>x.id===_leaveRecordUserId);
  if(!p) return;
  const L=p.hireDate ? leaveLedger(_leaveRecordUserId) : null;

  // 見出し：年5日の取得義務の期間と消化状況
  const head=document.getElementById('leave-record-duty');
  if(L && L.duty){
    const done=L.duty.left<=0;
    head.innerHTML=`<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span>年5日の取得義務</span>
        <span style="color:var(--text-muted)">${lvLabel(L.duty.from)}〜${lvLabel(L.duty.deadline)}</span>
        <span style="margin-left:auto;font-weight:800;color:${done?'var(--ok-t)':'var(--warn-t)'}">
          ${lvNum(L.duty.taken)}／${L.duty.required}日${done?'　達成':'　あと'+lvNum(L.duty.left)+'日'}</span>
      </div>
      <div style="margin-top:3px;color:var(--text-muted)">残日数 ${lvNum(L.remain)}日</div>`;
  } else {
    head.innerHTML='<span style="color:var(--text-muted)">雇用契約開始日を「設定」から登録すると、義務日数と残日数を表示します</span>';
  }

  // 一覧：この義務期間（未設定なら今年）の取得記録
  const from = L&&L.duty ? L.duty.from : lvStr(new Date().getFullYear(),1,1);
  const to   = L&&L.duty ? L.duty.deadline : lvStr(new Date().getFullYear(),12,31);
  const list=(typeof leaveRequests!=='undefined'?leaveRequests:[])
    .filter(lr=>lr.userId===_leaveRecordUserId && lr.status==='approved' && lr.startDate>=from && lr.startDate<=to)
    .sort((a,b)=> a.startDate<b.startDate?-1:a.startDate>b.startDate?1:0);
  document.getElementById('leave-record-list').innerHTML = list.length
    ? list.map(lr=>`<div style="display:flex;align-items:center;gap:8px;padding:6px 2px;border-bottom:0.5px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700">${leavePeriodLabel(lr)}<span style="font-weight:400;color:var(--text-muted)">　${lvNum(Number(lr.days))}日</span></div>
          ${lr.reason?`<div style="font-size:10px;color:var(--text-muted)">${esc(lr.reason)}</div>`:''}
        </div>
        <button class="btn xs danger" onclick="deleteLeaveRecord(${lr.id})">削除</button>
      </div>`).join('')
    : '<div style="padding:8px 2px;font-size:11px;color:var(--text-muted)">この期間の取得記録はありません</div>';
}

async function addLeaveRecord(){
  if(!_leaveRecordUserId) return;
  const p=(typeof allProfiles!=='undefined'?allProfiles:[]).find(x=>x.id===_leaveRecordUserId);
  const type=document.getElementById('leave-record-type').value;
  const start=document.getElementById('leave-record-start').value;
  let end=document.getElementById('leave-record-end').value;
  if(!start){ showToast('取得日を入力してください'); return; }
  if(type!=='全日' || !end || end<start) end=start;
  const days=leaveRecordDaysRecalc();
  if(days<=0){ showToast('選んだ期間に出勤日がありません（勤務カレンダーの休日は有給になりません）'); return; }
  const note=document.getElementById('leave-record-note').value.trim();
  await dbAddLeaveRecord({userId:_leaveRecordUserId, userName:p?.displayName||'',
    startDate:start, endDate:end, leaveType:type, days, reason:note||'（実績入力）'});
  document.getElementById('leave-record-start').value='';
  document.getElementById('leave-record-end').value='';
  await refreshGenba();
  renderLeaveRecord();
  leaveRecordDaysRecalc();
  showToast('取得実績を登録しました');
}

async function deleteLeaveRecord(id){
  const lr=(typeof leaveRequests!=='undefined'?leaveRequests:[]).find(x=>x.id===id);
  if(!lr) return;
  if(!confirm(`${lr.userName}さんの記録（${leavePeriodLabel(lr)}　${lvNum(Number(lr.days))}日）を削除しますか？`)) return;
  await dbDeleteLeaveRequest(id);
  await refreshGenba();
  renderLeaveRecord();
  showToast('削除しました');
}

let _leaveSettingUserId=null;
function openLeaveSetting(userId){
  const p=(typeof allProfiles!=='undefined'?allProfiles:[]).find(x=>x.id===userId);
  if(!p) return;
  _leaveSettingUserId=userId;
  document.getElementById('leave-setting-name').textContent=p.displayName;
  document.getElementById('leave-setting-hire').value=p.hireDate||'';
  document.getElementById('leave-setting-adjust').value=p.leaveAdjust||0;
  document.getElementById('leave-setting-note').value=p.leaveAdjustNote||'';
  renderLeaveSettingPreview();
  document.getElementById('leave-setting-modal').classList.add('open');
}
function closeLeaveSetting(){
  document.getElementById('leave-setting-modal').classList.remove('open');
  _leaveSettingUserId=null;
}
// 入社日を入れると、付与日と付与日数の予定をその場で表示する
function renderLeaveSettingPreview(){
  const el=document.getElementById('leave-setting-preview');
  if(!el) return;
  const hire=document.getElementById('leave-setting-hire').value;
  const adjust=parseFloat(document.getElementById('leave-setting-adjust').value)||0;
  if(!lvParse(hire)){ el.innerHTML='<span style="color:var(--text-muted)">雇用契約開始日を入れると付与予定を表示します</span>'; return; }
  const L=leaveLedger(_leaveSettingUserId,{hireDate:hire, adjust});
  const past=L.grants.filter(g=>!g.isAdjust);
  const future=leaveGrantSchedule(hire, lvAddYears(lvToday(),2)).filter(g=>g.date>lvToday()).slice(0,2);
  el.innerHTML=
    `<div style="font-weight:700;margin-bottom:3px">付与の記録</div>`+
    (past.length ? past.map(g=>`<div>${g.no}回目　${lvLabel(g.date)}　${lvNum(g.days)}日（期限 ${lvLabel(g.expire)}）</div>`).join('')
                 : '<div style="color:var(--text-muted)">まだ付与日を迎えていません</div>')+
    (future.length ? `<div style="font-weight:700;margin:6px 0 3px">今後の予定</div>`+
        future.map(g=>`<div>${g.no}回目　${lvLabel(g.date)}　${lvNum(g.days)}日</div>`).join('') : '')+
    `<div style="margin-top:6px;padding-top:6px;border-top:0.5px solid var(--border);font-weight:700">
       この設定での残日数　${lvNum(L.remain)}日</div>`;
}
async function saveLeaveSetting(){
  if(!_leaveSettingUserId) return;
  const hire=document.getElementById('leave-setting-hire').value || null;
  const adjust=parseFloat(document.getElementById('leave-setting-adjust').value)||0;
  const note=document.getElementById('leave-setting-note').value.trim();
  await dbSetLeaveSettings(_leaveSettingUserId, hire, adjust, note);
  closeLeaveSetting();
  showToast('保存しました');
  renderLeave();
}


// ════ 有給残が足りないときの欠勤扱い ════
//
// 承認するときに、その人の残日数で賄えない日を「欠勤」にする。
// 古い日から有給を当てて、あふれた後ろの日を欠勤にする。
// 出面表では「欠」と出し、有給日数にも残日数の計算にも入れない。

// その申請で欠勤扱いになっている日数
function leaveAbsenceDaysOf(lr){
  const list = Array.isArray(lr?.absenceDates) ? lr.absenceDates : [];
  if(!list.length) return 0;
  return list.length * (lr.leaveType!=='全日' ? 0.5 : 1);
}

// 申請に含まれる「有給を使う日」を古い順に並べる。
// 勤務カレンダーの休日は有給を消化しないので外す（leaveWorkdaysBetween と同じ考え方）
function leaveWorkDatesOf(lr){
  const set = (typeof workHolidays!=='undefined' && workHolidays)
    ? workHolidays[leaveCalOf(lr.userId)] : null;
  const out = [];
  let d = lr.startDate;
  for(let i=0; i<400 && d<=lr.endDate; i++){
    if(!set || !set.has(d)) out.push(d);
    d = lvAddDays(d,1);
  }
  return out;
}

// この申請を承認したときに、欠勤扱いになる日を返す（足りていれば空）
function leaveAbsenceDates(lr){
  if(!lr) return [];
  // 役員は有給の管理そのものをしていないので、欠勤扱いにもしない
  if(typeof isLeaveExempt==='function' && isLeaveExempt(lr.userName)) return [];
  let L;
  try{ L = leaveLedger(lr.userId); }catch(_){ return []; }
  if(!L || !isFinite(L.remain)) return [];

  const half = lr.leaveType!=='全日';
  const per = half ? 0.5 : 1;
  const dates = leaveWorkDatesOf(lr);
  if(!dates.length) return [];

  // 残っている日数で賄える日数（古い日から順に当てる）
  const canPay = Math.max(0, Math.floor((Math.max(0, L.remain) + 1e-9) / per));
  if(canPay >= dates.length) return [];
  return dates.slice(canPay);
}
