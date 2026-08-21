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

// 社員区分（勤務カレンダーの区分と同じ）
const OT_CALS = [{key:'regular', label:'一般社員'}, {key:'trainee', label:'訓練校生'}];
function otCalLabel(cal){ return (OT_CALS.find(c=>c.key===cal)||{}).label || cal; }

const OT_PAY_DEFAULT = {
  dailyHours: 8,          // 1日の所定労働時間（区分ごとの指定が無いときに使う）
  dailyHoursByCal: {},    // {trainee:7.5} 区分ごとの1日の所定労働時間
  systems: {},            // {trainee:'yearly'} 労働時間制。'yearly'＝1年単位の変形労働時間制
  monthlyHours: {},       // {regular:160} 1か月平均所定労働時間の直接指定。空なら自動
  rates: {overtime:1.25, holiday:1.35, night:0.25},
  baseItems: {basePay:true, familyAllowance:false, positionAllowance:true,
              skillAllowance:true, fixedOvertime:false,
              commuteAllowance:false, vehicleAllowance:false}
};

function otPaySettings(){
  const s = (typeof appSettings!=='undefined' && appSettings && appSettings.overtime_pay) || {};
  return {
    dailyHours: Number(s.dailyHours)>0 ? Number(s.dailyHours) : OT_PAY_DEFAULT.dailyHours,
    dailyHoursByCal: Object.assign({}, s.dailyHoursByCal||{}),
    systems: Object.assign({}, s.systems||{}),
    monthlyHours: Object.assign({}, s.monthlyHours||{}),
    rates: Object.assign({}, OT_PAY_DEFAULT.rates, s.rates||{}),
    baseItems: Object.assign({}, OT_PAY_DEFAULT.baseItems, s.baseItems||{})
  };
}

// その区分の1日の所定労働時間
function otDailyHours(cal, st){
  const v = Number(st.dailyHoursByCal[cal]);
  return v>0 ? v : st.dailyHours;
}
// その区分の労働時間制。'yearly'＝1年単位の変形労働時間制
function otSystem(cal, st){ return st.systems[cal]==='yearly' ? 'yearly' : 'normal'; }

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

// 年間に働ける法定の総枠（週40時間）。うるう年かどうかで変わるので暦日数から出す
function otYearlyFrame(days){ return 40 * days / 7; }
// 1か月平均所定労働時間の法定の上限（＝総枠 ÷ 12）。365日なら173.8時間
function otLegalMaxMonthly(days){ return Math.round(otYearlyFrame(days)/12*10)/10; }
// 1年単位の変形労働時間制の、年間所定労働日数の限度（対象期間が3か月を超える場合）
const OT_YEARLY_MAX_DAYS = 280;

// 1か月平均所定労働時間
//
//  通常の労働時間制 … 年間の所定労働日数 × 1日の所定労働時間 ÷ 12
//  1年単位の変形労働時間制 … 年間の法定総枠（週40時間）÷ 12
//      日ごとの所定がばらつく制度なので、カレンダーの日数×所定時間では割らない。
//      年間平均で週40時間になるよう組む制度そのものの数字を使う。
function otMonthlyHours(cal, month, st){
  st = st || otPaySettings();
  const w = otWorkDaysInYear(cal, month);
  const dh = otDailyHours(cal, st);
  const yearly = otSystem(cal, st)==='yearly';
  const frame = otYearlyFrame(w.days);                 // 年間の法定総枠（時間）
  const planned = w.hasData ? Math.round(w.work*dh*10)/10 : 0;   // カレンダー上の年間所定労働時間
  const info = {cal, fy:w.fy, days:w.days, work:w.work, dailyHours:dh, yearly,
                frame:Math.round(frame*10)/10, planned, hasData:w.hasData,
                overDays: yearly && w.hasData && w.work > OT_YEARLY_MAX_DAYS,
                overFrame: w.hasData && planned > frame};

  const ov = Number(st.monthlyHours[cal]);
  if(ov>0) return Object.assign(info, {hours:ov, source:'設定', capped:false});

  if(yearly)
    return Object.assign(info, {hours:Math.round(frame/12*10)/10, source:'1年変形', capped:false});

  if(!w.hasData) return Object.assign(info, {hours:160, source:'既定', capped:false});

  const raw = Math.round(w.work*dh/12*10)/10;
  const max = otLegalMaxMonthly(w.days);
  // 勤務カレンダーの休日が足りていないと、ありえない大きさになる。
  // そのまま使うと時間単価が低く出て賃金が不足するので、法定の上限で頭打ちにして画面で知らせる
  if(raw > max) return Object.assign(info, {hours:max, source:'法定上限', capped:true, raw, max});
  return Object.assign(info, {hours:raw, source:'勤務カレンダー', capped:false});
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
    const how = mh.source==='勤務カレンダー' ? `（${mh.fy}年度の所定労働日数${mh.work}日×${mh.dailyHours}時間÷12）`
              : mh.source==='1年変形' ? `（1年単位の変形労働時間制。${mh.fy}年度の法定総枠 週40時間×${mh.days}日÷7＝${mh.frame}時間 ÷12）`
              : mh.capped ? `（法定上限。勤務カレンダーからは${mh.raw}時間）`
              : `（${mh.source}）`;
    return `${otCalLabel(c)} ${mh.hours}時間${how}`;
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
  const warns = [];
  [...new Set(a.userIds.map(id=>a.users[id].cal))].forEach(c=>{
    const mh = otMonthlyHours(c, a.month, a.st);
    const who = otCalLabel(c);
    if(mh.capped)
      warns.push(`${who}：1か月平均所定労働時間が法定の上限（週40時間＝月${mh.max}時間）を超えています（勤務カレンダーからは${mh.raw}時間）。`
        + `勤務カレンダーの休日が足りていない可能性があります。いまは上限の${mh.max}時間で計算しています。`
        + `1年単位の変形労働時間制なら、設定でそう選んでください。`);
    if(mh.overDays)
      warns.push(`${who}：${mh.fy}年度の所定労働日数が${mh.work}日で、1年単位の変形労働時間制の限度（${OT_YEARLY_MAX_DAYS}日）を超えています。`);
    if(mh.overFrame)
      warns.push(`${who}：${mh.fy}年度は、どの日も${mh.dailyHours}時間として数えると年間${mh.planned}時間（${mh.work}日×${mh.dailyHours}時間）になり、`
        + `法定の総枠${mh.frame}時間を超えます。設定で1日の所定労働時間の平均（${Math.floor(mh.frame/mh.work*100)/100}時間以下）を入れるか、勤務カレンダーの休日を増やしてください。`);
  });
  wrap.innerHTML =
    (noSalary.length ? `<div class="labor-warn">給与が未登録のため金額を出せない人：${esc(noSalary.join('、'))}</div>` : '')
    + warns.map(w=>`<div class="labor-warn danger">${esc(w)}</div>`).join('')
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
// 社員区分ごとの設定欄を組み立てる
function renderOtCalSettings(){
  const st = otPaySettings();
  const mo = otPayMonth || dezuraCurrentMonth();
  document.getElementById('ots-cals').innerHTML = OT_CALS.map(c=>`
    <div class="ots-cal">
      <div class="ots-cal-name">${esc(c.label)}</div>
      <div class="fg" style="margin-bottom:6px"><label>労働時間制</label>
        <select id="ots-sys-${c.key}" onchange="otCalSettingChanged()">
          <option value="normal">通常の労働時間制</option>
          <option value="yearly">1年単位の変形労働時間制</option>
        </select></div>
      <div class="pay-grid">
        <div class="fg"><label>1日の所定労働時間（平均）</label>
          <input type="number" id="ots-dh-${c.key}" step="0.25" min="0" placeholder="共通の値" oninput="otCalSettingChanged()"></div>
        <div class="fg"><label>1か月平均所定労働時間</label>
          <input type="number" id="ots-mh-${c.key}" step="0.1" min="0" placeholder="自動" oninput="otCalSettingChanged()"></div>
      </div>
      <div class="ots-hint" id="ots-hint-${c.key}"></div>
    </div>`).join('');
  OT_CALS.forEach(c=>{
    document.getElementById('ots-sys-'+c.key).value = otSystem(c.key, st);
    document.getElementById('ots-dh-'+c.key).value = Number(st.dailyHoursByCal[c.key])>0 ? st.dailyHoursByCal[c.key] : '';
    document.getElementById('ots-mh-'+c.key).value = Number(st.monthlyHours[c.key])>0 ? st.monthlyHours[c.key] : '';
  });
  otCalSettingChanged();
}

// 入力に合わせて説明を出し直す（保存しなくても結果が読めるように）
function otCalSettingChanged(){
  const mo = otPayMonth || dezuraCurrentMonth();
  const st = otSettingsFromForm();
  OT_CALS.forEach(c=>{
    const mh = otMonthlyHours(c.key, mo, st);
    const hint = document.getElementById('ots-hint-'+c.key);
    if(!hint) return;
    const lines = [];
    if(mh.source==='設定') lines.push(`直接指定した ${mh.hours}時間 で計算します。`);
    else if(mh.source==='1年変形')
      lines.push(`${mh.fy}年度の法定総枠 週40時間×${mh.days}日÷7＝${mh.frame}時間。1か月平均は ${mh.hours}時間 で計算します。`);
    else if(!mh.hasData) lines.push('勤務カレンダーが未登録のため、160時間で計算します。');
    else if(mh.capped)
      lines.push(`勤務カレンダーからは ${mh.raw}時間（所定労働日数${mh.work}日×${mh.dailyHours}時間÷12）ですが、`
        + `法定の上限（週40時間＝月${mh.max}時間）を超えています。いまは${mh.max}時間で計算します。`);
    else lines.push(`勤務カレンダーから ${mh.hours}時間（${mh.fy}年度の所定労働日数${mh.work}日×${mh.dailyHours}時間÷12）。`);

    let bad = mh.capped;
    if(mh.hasData){
      if(mh.overDays){
        lines.push(`${mh.fy}年度の所定労働日数が${mh.work}日で、1年単位の変形労働時間制の限度（${OT_YEARLY_MAX_DAYS}日）を超えています。`);
        bad = true;
      }
      if(mh.overFrame){
        lines.push(`点検：どの日も${mh.dailyHours}時間として数えると年間${mh.planned}時間（${mh.work}日×${mh.dailyHours}時間）になり、法定の総枠${mh.frame}時間を超えます。`
          + `1日の所定労働時間の平均を${Math.floor(mh.frame/mh.work*100)/100}時間以下にするか、休日を増やしてください。`
          + `日によって所定が違う場合は、その平均を入れてください。`);
        bad = true;
      } else if(mh.yearly){
        lines.push(`点検：どの日も${mh.dailyHours}時間として数えると年間${mh.planned}時間（${mh.work}日×${mh.dailyHours}時間）で、総枠${mh.frame}時間に収まっています。`);
      }
    }
    hint.textContent = lines.join('');
    hint.className = 'ots-hint' + (bad ? ' bad' : mh.yearly ? ' ok' : '');
  });
}

// いま画面に入っている値で設定オブジェクトを作る
function otSettingsFromForm(){
  const num = (id, def) => { const el=document.getElementById(id); const v = el ? parseFloat(el.value) : NaN; return isFinite(v)&&v>=0 ? v : def; };
  const st = otPaySettings();
  st.dailyHours = num('ots-daily', 8) || 8;
  st.dailyHoursByCal = {}; st.monthlyHours = {}; st.systems = {};
  OT_CALS.forEach(c=>{
    const dh = num('ots-dh-'+c.key, 0); if(dh>0) st.dailyHoursByCal[c.key] = dh;
    const mh = num('ots-mh-'+c.key, 0); if(mh>0) st.monthlyHours[c.key] = mh;
    const sys = document.getElementById('ots-sys-'+c.key);
    if(sys && sys.value==='yearly') st.systems[c.key] = 'yearly';
  });
  st.rates = {overtime:num('ots-rate-ot',1.25), holiday:num('ots-rate-hol',1.35), night:num('ots-rate-night',0.25)};
  const bi = {};
  SALARY_ITEMS.forEach(i=>{ const el=document.getElementById('ots-base-'+i.key); bi[i.key] = el ? el.checked : st.baseItems[i.key]; });
  st.baseItems = bi;
  return st;
}

function openOtPaySettings(){
  if(!isPayrollAdmin()) return;
  const st = otPaySettings();
  document.getElementById('ots-daily').value = st.dailyHours;
  document.getElementById('ots-rate-ot').value    = st.rates.overtime;
  document.getElementById('ots-rate-hol').value   = st.rates.holiday;
  document.getElementById('ots-rate-night').value = st.rates.night;
  document.getElementById('ots-base-items').innerHTML = SALARY_ITEMS.map(i=>`
    <label class="ots-check"><input type="checkbox" id="ots-base-${i.key}"${st.baseItems[i.key]?' checked':''} onchange="otCalSettingChanged()">${esc(i.label)}</label>`).join('');
  renderOtCalSettings();
  document.getElementById('otpay-settings-modal').classList.add('open');
}
function closeOtPaySettings(){ document.getElementById('otpay-settings-modal').classList.remove('open'); }

async function saveOtPaySettings(){
  const st = otSettingsFromForm();
  if(!(st.dailyHours>0)){ showToast('1日の所定労働時間を入れてください'); return; }
  const v = {
    dailyHours: st.dailyHours,
    dailyHoursByCal: st.dailyHoursByCal,
    systems: st.systems,
    monthlyHours: st.monthlyHours,
    rates: st.rates,
    baseItems: st.baseItems
  };
  await dbSaveAppSetting('overtime_pay', v);
  closeOtPaySettings();
  showToast('計算の設定を保存しました');
  renderOtPay();
}
