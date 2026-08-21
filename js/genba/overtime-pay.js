// ════ 残業代・休日手当・深夜割増の計算（清川創史・清川優香のみ） ════
//
// 日報の実働時間と、登録した給与から、その月度の割増賃金を出す。
//
//  時間単価 ＝ 割増賃金の基礎になる賃金 ÷ 1か月平均所定労働時間
//
//  基礎になる賃金（既定）… 基本給＋役付手当＋技能・資格手当
//    家族手当・通勤手当・車両借上料は労働基準法第37条5項と施行規則21条で
//    基礎から除くことになっている。固定残業代は割増賃金そのものなので入れない。
//    （どの項目を入れるかは「計算の設定」で変えられる）
//
//  1か月平均所定労働時間 ＝ 年間の所定労働日数 × 1日の所定労働時間 ÷ 12
//    年間の所定労働日数は勤務カレンダー（4月始まりの年度）から数える。
//    社員区分ごとにカレンダーが違うので、一般社員と訓練校生で別に出す。
//    設定で固定の数字を入れることもできる。
//
//  割増率（既定）… 残業1.25／休日労働1.35／深夜+0.25
//    振替出勤（事前に振替休日を決めた日）は労働日の振替なので割増しない。
//    ただしその日も8時間を超えれば残業として数える。
//    休日労働の日は全時間を1.35で見るので、残業には二重に数えない。
//
//  役員（管理監督者）は時間外・休日の割増の対象外。
//    ただし深夜割増だけは管理監督者にも必要なので計算する。
//
// 権限：清川創史・清川優香のみ（給与と同じ）

const OT_PAY_DEFAULT = {
  dailyHours: 8,          // 1日の所定労働時間
  monthlyHours: {},       // {regular:160, trainee:160}。空なら勤務カレンダーから計算
  rates: {overtime:1.25, holiday:1.35, night:0.25},
  baseItems: {basePay:true, familyAllowance:false, positionAllowance:true,
              skillAllowance:true, fixedOvertime:false,
              commuteAllowance:false, vehicleAllowance:false}
};

function otPaySettings(){
  const s = (typeof appSettings!=='undefined' && appSettings && appSettings.overtime_pay) || {};
  return {
    dailyHours: Number(s.dailyHours)>0 ? Number(s.dailyHours) : OT_PAY_DEFAULT.dailyHours,
    monthlyHours: Object.assign({}, s.monthlyHours||{}),
    rates: Object.assign({}, OT_PAY_DEFAULT.rates, s.rates||{}),
    baseItems: Object.assign({}, OT_PAY_DEFAULT.baseItems, s.baseItems||{})
  };
}

// 割増賃金の基礎になる賃金
function otBaseWage(salary, st){
  if(!salary) return 0;
  return SALARY_ITEMS.reduce((n,i)=> n + (st.baseItems[i.key] ? (Number(salary[i.key])||0) : 0), 0);
}

// その月度が属する年度（4月始まり）
function otFiscalRange(month){
  const [y,m] = month.split('-').map(Number);
  const fy = m>=4 ? y : y-1;
  return {from:`${fy}-04-01`, to:`${fy+1}-03-31`, fy};
}

// 勤務カレンダーから年間の所定労働日数を数える
function otWorkDaysInYear(cal, month){
  const {from, to, fy} = otFiscalRange(month);
  const set = (typeof workHolidays!=='undefined' && workHolidays) ? workHolidays[cal] : null;
  let days = 0, holidays = 0;
  for(let d=new Date(from+'T00:00:00'); dzDateStr(d)<=to; d.setDate(d.getDate()+1)){
    days++;
    if(set && set.has(dzDateStr(d))) holidays++;
  }
  return {fy, days, holidays, work:days-holidays, hasData: !!(set && set.size)};
}

// 1か月平均所定労働時間の法定上限（週40時間 × 365日÷7 ÷ 12 ＝ 173.8時間）。
// これを超える数字で割ると時間単価が低く出て、割増賃金が足りなくなってしまう
const OT_LEGAL_MAX_MONTHLY = 173.8;

// 1か月平均所定労働時間
function otMonthlyHours(cal, month, st){
  st = st || otPaySettings();
  const ov = Number(st.monthlyHours[cal]);
  if(ov>0) return {hours:ov, source:'設定', capped:false};
  const w = otWorkDaysInYear(cal, month);
  if(!w.hasData) return {hours:160, source:'既定', work:0, fy:w.fy, capped:false};
  const raw = Math.round(w.work*st.dailyHours/12*10)/10;
  // 勤務カレンダーの休日が足りていないと、ありえない大きさになる。
  // そのまま使うと賃金が不足するので、法定の上限で頭打ちにして画面で知らせる
  if(raw > OT_LEGAL_MAX_MONTHLY)
    return {hours:OT_LEGAL_MAX_MONTHLY, source:'法定上限', work:w.work, fy:w.fy, capped:true, raw};
  return {hours:raw, source:'勤務カレンダー', work:w.work, fy:w.fy, capped:false};
}

// その日報のうち深夜（22時〜翌5時）に重なる分数。
// 日をまたぐ日報は登録できないので、当日の 0:00〜5:00 と 22:00〜24:00 を見る
function otNightMinutes(startTime, endTime){
  const p = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s||'')); return m ? +m[1]*60 + +m[2] : null; };
  const a = p(startTime), b = p(endTime);
  if(a==null || b==null || b<=a) return 0;
  const ov = (x1,x2) => Math.max(0, Math.min(b,x2) - Math.max(a,x1));
  return ov(0, 5*60) + ov(22*60, 24*60);
}

// その月度の社員ごとの割増賃金
function otPayAllocation(month){
  const st = otPaySettings();
  const {start, end} = nippoPeriod(month);
  const users = {};

  nippoEmployees().forEach(p=>{
    const cal = p.workGroup==='訓練校生' ? 'trainee' : 'regular';
    const salary = salaryFor(p.id, month);
    const mh = otMonthlyHours(cal, month, st);
    const base = otBaseWage(salary, st);
    users[p.id] = {
      id:p.id, name:p.displayName, cal, salary,
      // 役員（管理監督者）は時間外・休日の割増の対象外。深夜割増だけ計算する
      exempt: typeof isLeaveExempt==='function' && isLeaveExempt(p.displayName),
      monthlyHours: mh.hours, monthlyHoursSource: mh.source,
      baseWage: base,
      rate: base ? Math.round(base / mh.hours) : 0,
      otMin:0, holMin:0, furiMin:0, nightMin:0
    };
  });

  // 承認済みの休日出勤を「休日労働（割増あり）」と「振替出勤（割増なし）」に分ける
  const prem = {}, furi = {};
  (holidayRequests||[]).filter(hr=>hr.status==='approved').forEach(hr=>{
    if(!hr.workDate || hr.workDate<start || hr.workDate>end) return;
    const m = isFurikaeHoliday(hr) ? furi : prem;
    (m[hr.userId] = m[hr.userId] || new Set()).add(hr.workDate);
  });

  (dailyReports||[]).filter(n=>n.workDate>=start && n.workDate<=end).forEach(n=>{
    const u = users[n.userId];
    if(!u || isNippoStateName(n.projectName)) return;      // 休み・欠勤は働いていない
    if(prem[n.userId] && prem[n.userId].has(n.workDate)){
      u.holMin += n.workMinutes;             // 休日労働：全時間を1.35で見る（残業には数えない）
    } else {
      u.otMin += n.overtimeMinutes;          // 8時間を超えた分
      if(furi[n.userId] && furi[n.userId].has(n.workDate)) u.furiMin += n.workMinutes;
    }
    u.nightMin += otNightMinutes(n.startTime, n.endTime);
  });

  const yen = (rate, mult, min) => Math.round(rate * mult * min / 60);
  const userIds = Object.keys(users)
    .filter(id=>users[id].otMin || users[id].holMin || users[id].nightMin)
    .sort((a,b)=>cmpEmployee(users[a].name, users[b].name));

  userIds.forEach(id=>{
    const u = users[id];
    u.otPay    = u.exempt ? 0 : yen(u.rate, st.rates.overtime, u.otMin);
    u.holPay   = u.exempt ? 0 : yen(u.rate, st.rates.holiday,  u.holMin);
    u.nightPay = yen(u.rate, st.rates.night, u.nightMin);
    u.total    = u.otPay + u.holPay + u.nightPay;
  });

  return {month, start, end, st, users, userIds};
}

// ════ 画面 ════
let otPayMonth = '';

function openOtPay(){
  if(!isPayrollAdmin()){ showToast('残業代を見られるのは'+PAYROLL_ADMINS.join('さんと')+'さんだけです'); return; }
  if(!otPayMonth) otPayMonth = dezuraCurrentMonth();
  document.getElementById('otpay-modal').classList.add('open');
  renderOtPay();
}
function closeOtPay(){ document.getElementById('otpay-modal').classList.remove('open'); }
function setOtPayMonth(v){ otPayMonth = v; renderOtPay(); }

const otH = min => (Math.round(min/60*100)/100).toFixed(2).replace(/\.?0+$/,'') || '0';

function otPayTableHtml(a, forPrint){
  const rows = a.userIds.map(id=>{
    const u = a.users[id];
    const note = [];
    if(u.exempt) note.push('役員（時間外・休日は対象外）');
    if(u.furiMin) note.push('振替出勤 '+otH(u.furiMin)+'h');
    if(!u.salary) note.push('給与が未登録');
    return `<tr${u.total?'':' class="zero"'}>
      <td class="who">${esc(u.name)}${note.length?`<div class="note">${esc(note.join('／'))}</div>`:''}</td>
      <td class="num">${u.rate?fmt(u.rate):'—'}</td>
      <td class="num">${u.otMin?otH(u.otMin):''}</td>
      <td class="num">${u.otPay?fmt(u.otPay):''}</td>
      <td class="num">${u.holMin?otH(u.holMin):''}</td>
      <td class="num">${u.holPay?fmt(u.holPay):''}</td>
      <td class="num">${u.nightMin?otH(u.nightMin):''}</td>
      <td class="num">${u.nightPay?fmt(u.nightPay):''}</td>
      <td class="num total">${u.total?fmt(u.total):''}</td>
    </tr>`;
  }).join('');
  const sum = k => a.userIds.reduce((n,id)=>n+(a.users[id][k]||0), 0);
  return `<table class="otpay-tbl${forPrint?' print':''}">
    <tr>
      <th class="who">社員</th><th class="num">時間単価</th>
      <th class="num">残業<br>(h)</th><th class="num">残業代</th>
      <th class="num">休日労働<br>(h)</th><th class="num">休日手当</th>
      <th class="num">深夜<br>(h)</th><th class="num">深夜割増</th>
      <th class="num total">合計</th>
    </tr>
    ${rows}
    <tr class="sum">
      <td class="who">合計</td><td class="num"></td>
      <td class="num">${otH(sum('otMin'))}</td><td class="num">${fmt(sum('otPay'))}</td>
      <td class="num">${otH(sum('holMin'))}</td><td class="num">${fmt(sum('holPay'))}</td>
      <td class="num">${otH(sum('nightMin'))}</td><td class="num">${fmt(sum('nightPay'))}</td>
      <td class="num total">${fmt(sum('total'))}</td>
    </tr>
  </table>`;
}

// 計算の前提を1行で説明する
function otPayBasisText(a){
  const st = a.st;
  const cals = [...new Set(a.userIds.map(id=>a.users[id].cal))];
  const parts = cals.map(c=>{
    const mh = otMonthlyHours(c, a.month, st);
    const label = c==='trainee' ? '訓練校生' : '一般社員';
    const how = mh.source==='勤務カレンダー' ? `（${mh.fy}年度の所定労働日数${mh.work}日×${st.dailyHours}時間÷12）`
              : mh.capped ? `（法定上限。勤務カレンダーからは${mh.raw}時間）`
              : `（${mh.source}）`;
    return `${label} ${mh.hours}時間${how}`;
  });
  return `時間単価＝割増の基礎になる賃金 ÷ 1か月平均所定労働時間［${parts.join('／')}］　`
       + `割増率：残業${st.rates.overtime}／休日労働${st.rates.holiday}／深夜+${st.rates.night}`;
}

function renderOtPay(){
  const wrap = document.getElementById('otpay-body');
  if(!wrap) return;
  const mo = otPayMonth || dezuraCurrentMonth();
  const sel = document.getElementById('otpay-month');
  if(sel){
    sel.innerHTML = dezuraMonthOptions().map(m=>`<option value="${m}">${dezuraMonthLabel(m)}</option>`).join('');
    sel.value = mo;
  }
  const a = otPayAllocation(mo);
  if(!a.userIds.length){
    wrap.innerHTML = '<div class="empty" style="padding:14px">この月度は残業も休日出勤もありません</div>';
    return;
  }
  const noSalary = a.userIds.filter(id=>!a.users[id].salary).map(id=>a.users[id].name);
  // 勤務カレンダーの休日が足りず、所定労働時間が法定の上限を超えてしまった区分
  const capped = [...new Set(a.userIds.map(id=>a.users[id].cal))]
    .map(c=>({cal:c, mh:otMonthlyHours(c, a.month, a.st)}))
    .filter(x=>x.mh.capped)
    .map(x=>`${x.cal==='trainee'?'訓練校生':'一般社員'}（カレンダーからは${x.mh.raw}時間）`);
  wrap.innerHTML =
    (noSalary.length ? `<div class="labor-warn">給与が未登録のため金額を出せない人：${esc(noSalary.join('、'))}</div>` : '')
    + (capped.length ? `<div class="labor-warn danger">1か月平均所定労働時間が法定の上限（週40時間＝月${OT_LEGAL_MAX_MONTHLY}時間）を超えています：${esc(capped.join('、'))}。勤務カレンダーの休日が足りていない可能性があります。いまは上限の${OT_LEGAL_MAX_MONTHLY}時間で計算していますが、カレンダーを直すか、設定で正しい時間数を入れてください。</div>` : '')
    + `<div class="labor-scroll">${otPayTableHtml(a, false)}</div>`
    + `<div class="otpay-basis">${esc(otPayBasisText(a))}</div>`;
}

function printOtPay(){
  const mo = otPayMonth || dezuraCurrentMonth();
  const a = otPayAllocation(mo);
  if(!a.userIds.length){ showToast('この月度は残業も休日出勤もありません'); return; }
  const md = s => { const [,m,d] = s.split('-'); return `${Number(m)}/${Number(d)}`; };
  const label = dezuraMonthLabel(mo);
  const html = `
  <style>
    @page{size:A4 landscape;margin:12mm}
    table.otpay-tbl{border-collapse:collapse;font-size:11px;width:100%}
    table.otpay-tbl th,table.otpay-tbl td{border:0.4pt solid #b9b9b9;padding:4px 6px;white-space:nowrap}
    table.otpay-tbl th{background:#f0ece3;font-weight:700;font-size:10px}
    table.otpay-tbl td.num{text-align:right}
    table.otpay-tbl td.who,table.otpay-tbl th.who{text-align:left;min-width:110px}
    table.otpay-tbl td.who .note{font-size:8px;color:#666;font-weight:400}
    table.otpay-tbl td.total{font-weight:700;background:#faf7f0}
    table.otpay-tbl tr.sum td{font-weight:700;background:#f7f3eb;border-top:0.8pt solid #8a8a8a}
  </style>
  <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:8px;flex-wrap:wrap">
    <h2 style="font-size:16px;margin:0">残業代・休日手当　${label}</h2>
    <span style="font-size:11px">対象期間：${md(a.start)}〜${md(a.end)}（20日締め）</span>
  </div>
  <div style="font-size:10px;color:#555;margin-bottom:8px;line-height:1.7">
    ${esc(otPayBasisText(a))}<br>
    割増の基礎に入れる項目：${SALARY_ITEMS.filter(i=>a.st.baseItems[i.key]).map(i=>i.label).join('・')||'（なし）'}。
    休日労働の日は全時間を休日労働として見るため、残業には数えていません。
    振替出勤（事前に振替休日を決めた日）は労働日の振替なので割増せず、8時間を超えた分だけ残業に入れています。
    役員（管理監督者）は時間外・休日の割増の対象外ですが、深夜割増は計算しています。
    残業は1日8時間を超えた分で数えており、週40時間を超えた分の判定は入れていません。
  </div>
  ${otPayTableHtml(a, true)}
  <div style="font-size:9px;color:#555;margin-top:8px">出力日時：${new Date().toLocaleString('ja-JP')}　手寄（てよせ）</div>`;
  printHtml(`残業代・休日手当 ${label}`, html);
}

// ════ 計算の設定 ════
function openOtPaySettings(){
  if(!isPayrollAdmin()) return;
  const st = otPaySettings();
  const mo = otPayMonth || dezuraCurrentMonth();
  document.getElementById('ots-daily').value = st.dailyHours;
  ['regular','trainee'].forEach(cal=>{
    const el = document.getElementById('ots-mh-'+cal);
    el.value = Number(st.monthlyHours[cal])>0 ? st.monthlyHours[cal] : '';
    const w = otWorkDaysInYear(cal, mo);
    const auto = Math.round(w.work*st.dailyHours/12*10)/10;
    const hint = document.getElementById('ots-mh-'+cal+'-hint');
    if(!w.hasData){
      hint.textContent = '勤務カレンダーが未登録のため、空欄なら160時間';
      hint.className = 'ots-hint';
    } else if(auto > OT_LEGAL_MAX_MONTHLY){
      hint.textContent = `勤務カレンダーからは ${auto}時間（${w.fy}年度の所定労働日数 ${w.work}日）ですが、`
        + `法定の上限（週40時間＝月${OT_LEGAL_MAX_MONTHLY}時間）を超えています。`
        + `カレンダーの休日が足りていない可能性があります。空欄のままなら${OT_LEGAL_MAX_MONTHLY}時間で計算します。`;
      hint.className = 'ots-hint bad';
    } else {
      hint.textContent = `空欄なら勤務カレンダーから ${auto}時間（${w.fy}年度の所定労働日数 ${w.work}日）`;
      hint.className = 'ots-hint';
    }
  });
  document.getElementById('ots-rate-ot').value    = st.rates.overtime;
  document.getElementById('ots-rate-hol').value   = st.rates.holiday;
  document.getElementById('ots-rate-night').value = st.rates.night;
  document.getElementById('ots-base-items').innerHTML = SALARY_ITEMS.map(i=>`
    <label class="ots-check"><input type="checkbox" id="ots-base-${i.key}"${st.baseItems[i.key]?' checked':''}>${esc(i.label)}</label>`).join('');
  document.getElementById('otpay-settings-modal').classList.add('open');
}
function closeOtPaySettings(){ document.getElementById('otpay-settings-modal').classList.remove('open'); }

async function saveOtPaySettings(){
  const num = (id, def) => { const v = parseFloat(document.getElementById(id).value); return isFinite(v) && v>=0 ? v : def; };
  const mh = {};
  ['regular','trainee'].forEach(cal=>{
    const v = parseFloat(document.getElementById('ots-mh-'+cal).value);
    if(isFinite(v) && v>0) mh[cal] = v;      // 空欄なら勤務カレンダーから計算する
  });
  const baseItems = {};
  SALARY_ITEMS.forEach(i=>baseItems[i.key] = document.getElementById('ots-base-'+i.key).checked);
  const v = {
    dailyHours: num('ots-daily', 8),
    monthlyHours: mh,
    rates: {overtime:num('ots-rate-ot',1.25), holiday:num('ots-rate-hol',1.35), night:num('ots-rate-night',0.25)},
    baseItems
  };
  if(v.dailyHours<=0){ showToast('1日の所定労働時間を入れてください'); return; }
  await dbSaveAppSetting('overtime_pay', v);
  closeOtPaySettings();
  showToast('計算の設定を保存しました');
  renderOtPay();
}
