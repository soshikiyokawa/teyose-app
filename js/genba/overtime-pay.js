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
//  1か月平均所定労働時間
//    通常の労働時間制 … 年間の所定労働日数 × 1日の所定労働時間 ÷ 12
//    1年単位の変形労働時間制 … 年間の法定総枠（週40時間）÷ 12
//    年間の所定労働日数は勤務カレンダー（4月始まりの年度）から数える。
//    社員区分ごとにカレンダーが違うので、一般社員と訓練校生で別に出す。
//    設定で固定の数字を入れることもできる。
//
//  割増率（既定）… 残業1.25／休日労働1.35／深夜+0.25／所定外（法定内）1.0
//    振替出勤（事前に振替休日を決めた日）は労働日の振替なので割増しない。
//    その日を所定労働日、振替休日を休日として数え直したうえで①②を見る。
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
  // naibu＝所定外だが法定内（8時間以内）。割増は要らないので1.0倍
  rates: {overtime:1.25, holiday:1.35, night:0.25, naibu:1.0},
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

// ════ 労働時間の切り分け ════
//
// 時間外（割増あり）になるのは、次の順に数えたもの。二重には数えない。
//   ① 1日 … その日の所定労働時間（8時間に満たない日は8時間）を超えた分
//   ② 1週 … その週の所定労働時間（40時間に満たない週は40時間）を超えた分（①を除く）
//   ③ 所定外だが法定内 … 所定は超えたが①②にならなかった分。割増は要らないが賃金は要る
//
// 週は日曜はじまり。土曜日が締め期間に入る週を、その月度の週として数える。
// こうすると月をまたいでも週が分かれず、二重にも数えない。
// 法定休日の労働（出面表の「休」）は別枠（1.35倍）なので、この計算からは外す。

function otSaturdayOf(dateStr){
  const d = new Date(dateStr+'T00:00:00');
  d.setDate(d.getDate() + (6 - d.getDay()));
  return dzDateStr(d);
}
function otAddDays(dateStr, n){
  const d = new Date(dateStr+'T00:00:00');
  d.setDate(d.getDate()+n);
  return dzDateStr(d);
}
// その日がその区分の所定労働日か（勤務カレンダーの休日でなければ所定労働日）
function otIsWorkDay(cal, dateStr){
  const set = (typeof workHolidays!=='undefined' && workHolidays) ? workHolidays[cal] : null;
  if(set && set.size) return !set.has(dateStr);
  const dow = new Date(dateStr+'T00:00:00').getDay();
  return dow!==0 && dow!==6;
}

// fromDate〜toDate の週（土曜がその範囲に入る週）について、①②③を切り分ける。
//   dayMin  … {日付: 実働分}（休み・欠勤・法定休日労働は入れない）
//   premSet … 法定休日労働の日（週の計算から外す）
//   schedOv … {日付: 所定労働日か} 振替出勤・振替休日の入れ替えを反映する
function otSplitHours(cal, fromDate, toDate, dayMin, premSet, st, schedOv){
  const dailyMin = Math.round(otDailyHours(cal, st) * 60);
  // otByDate / naibuByDate は「その時間がどの日に起きたか」。
  // 現場ごとの労務費に割り振るときに、その日の日報の現場へ配るために使う
  const out = {otMin:0, naibuMin:0, actualMin:0, weeks:0, otByDate:{}, naibuByDate:{}};
  const seen = new Set();
  for(let d=fromDate; d<=toDate; d=otAddDays(d,1)){
    const sat = otSaturdayOf(d);
    if(sat<fromDate || sat>toDate || seen.has(sat)) continue;   // 土曜が範囲内の週だけ
    seen.add(sat);
    out.weeks++;
    const sun = otAddDays(sat,-6);
    let wActual=0, wOt1=0, wNaibu=0, wSchedMin=0;
    const dayOt1={}, dayNaibu={};
    for(let k=0; k<7; k++){
      const day = otAddDays(sun,k);
      // 振替出勤の日は所定労働日、その振替休日は休日として数える（カレンダーより優先）
      const ov = schedOv ? schedOv[day] : undefined;
      const isWork = (ov===undefined) ? otIsWorkDay(cal, day) : ov;
      const scheduled = isWork ? dailyMin : 0;
      wSchedMin += scheduled;
      if(premSet && premSet.has(day)) continue;       // 法定休日労働は別枠
      const actual = dayMin[day] || 0;
      if(!actual) continue;
      const dayLimit = Math.max(scheduled, 480);      // 所定が8時間未満の日は8時間が境目
      const ot1 = Math.max(0, actual - dayLimit);
      const naibu = Math.max(0, (actual - ot1) - scheduled);
      dayOt1[day] = ot1; dayNaibu[day] = naibu;
      wOt1 += ot1; wNaibu += naibu; wActual += actual;
    }
    const weekLimit = Math.max(wSchedMin, 40*60);     // 所定が40時間未満の週は40時間が境目
    const ot2 = Math.min(Math.max(0, wActual - weekLimit - wOt1), wNaibu);
    out.otMin    += wOt1 + ot2;
    out.naibuMin += wNaibu - ot2;
    out.actualMin += wActual;

    // 週の②は、法内だった時間から出るので、その日ごとの法内の多さで按分する
    const days = Object.keys(dayNaibu);
    const share = otSplitInt(ot2, days.map(x=>dayNaibu[x]));
    days.forEach((day,i)=>{
      out.otByDate[day]    = (out.otByDate[day]||0)    + dayOt1[day] + share[i];
      out.naibuByDate[day] = (out.naibuByDate[day]||0) + dayNaibu[day] - share[i];
    });
    Object.keys(dayOt1).forEach(day=>{
      if(dayNaibu[day]===undefined) out.otByDate[day] = (out.otByDate[day]||0) + dayOt1[day];
    });
  }
  return out;
}

// 合計がぴったり合うように整数で按分する（端数はいちばん惜しいものから1ずつ）
function otSplitInt(total, weights){
  const sum = weights.reduce((a,b)=>a+b, 0);
  if(!total || !sum) return weights.map(()=>0);
  const raw = weights.map(w=>total*w/sum);
  const outv = raw.map(v=>Math.floor(v));
  let rest = total - outv.reduce((a,b)=>a+b, 0);
  const order = raw.map((v,i)=>[v-Math.floor(v), i]).sort((a,b)=>b[0]-a[0]);
  for(let k=0; k<order.length && rest>0; k++, rest--) outv[order[k][1]]++;
  return outv;
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
      monthlyHours: mh.hours, monthlyHoursSource: mh.source, yearly: mh.yearly,
      baseWage: base,
      rate: base ? Math.round(base / mh.hours) : 0,
      otMin:0, naibuMin:0, holMin:0, furiMin:0, nightMin:0
    };
  });

  // 承認済みの休日出勤を「休日労働（割増あり）」と「振替出勤（割増なし）」に分ける。
  // 週の計算で締め期間の外側も見るので、期間で絞らずに全部拾っておく
  const prem = {}, furi = {}, schedOv = {};
  (holidayRequests||[]).filter(hr=>hr.status==='approved').forEach(hr=>{
    if(!hr.workDate) return;
    if(isFurikaeHoliday(hr)){
      (furi[hr.userId] = furi[hr.userId] || new Set()).add(hr.workDate);
      // 労働日の振替：出た日が所定労働日になり、振替休日が休日になる
      const o = schedOv[hr.userId] = schedOv[hr.userId] || {};
      o[hr.workDate] = true;
      if(hr.substituteDate) o[hr.substituteDate] = false;
    } else {
      (prem[hr.userId] = prem[hr.userId] || new Set()).add(hr.workDate);
    }
  });

  // 週の判定で締め期間の前後にはみ出すので、日報は少し広めに拾う
  const wideFrom = otAddDays(start,-7), wideTo = otAddDays(end,7);
  const dayMin = {};    // uid -> {日付: 実働分}
  const daySite = {};   // uid -> {日付: {現場名: 実働分}}   割増を現場へ配るのに使う
  const holSite = {};   // uid -> {現場名: 休日労働の分}
  const nightSite = {}; // uid -> {現場名: 深夜の分}
  const siteOf = n => n.projectName || '（工事未設定）';
  (dailyReports||[]).filter(n=>n.workDate>=wideFrom && n.workDate<=wideTo).forEach(n=>{
    const u = users[n.userId];
    if(!u || isNippoStateName(n.projectName)) return;      // 休み・欠勤は働いていない
    const inPeriod = n.workDate>=start && n.workDate<=end;
    const site = siteOf(n);
    if(prem[n.userId] && prem[n.userId].has(n.workDate)){
      if(inPeriod){
        u.holMin += n.workMinutes;             // 休日労働：全時間を1.35で見る
        const h = holSite[n.userId] = holSite[n.userId] || {};
        h[site] = (h[site]||0) + n.workMinutes;
      }
    } else {
      (dayMin[n.userId] = dayMin[n.userId] || {})[n.workDate] =
        (dayMin[n.userId][n.workDate] || 0) + n.workMinutes;
      if(inPeriod){
        const ds = daySite[n.userId] = daySite[n.userId] || {};
        const dd = ds[n.workDate] = ds[n.workDate] || {};
        dd[site] = (dd[site]||0) + n.workMinutes;
      }
      if(inPeriod && furi[n.userId] && furi[n.userId].has(n.workDate)) u.furiMin += n.workMinutes;
    }
    if(inPeriod){
      const nm = otNightMinutes(n.startTime, n.endTime);
      u.nightMin += nm;
      if(nm){ const g = nightSite[n.userId] = nightSite[n.userId] || {}; g[site] = (g[site]||0) + nm; }
    }
  });

  Object.keys(users).forEach(id=>{
    const u = users[id];
    const s = otSplitHours(u.cal, start, end, dayMin[id]||{}, prem[id], st, schedOv[id]);
    u.otMin = s.otMin; u.naibuMin = s.naibuMin; u.workedMin = s.actualMin;
    // 日ごとの時間外・所定外を、その日に出た現場へ実働時間の割合で配る
    u.otSite = otSpreadToSites(s.otByDate,    daySite[id]||{}, start, end);
    u.naibuSite = otSpreadToSites(s.naibuByDate, daySite[id]||{}, start, end);
    u.holSite = holSite[id] || {};
    u.nightSite = nightSite[id] || {};
  });

  const yen = (rate, mult, min) => Math.round(rate * mult * min / 60);
  const userIds = Object.keys(users)
    .filter(id=>users[id].otMin || users[id].naibuMin || users[id].holMin || users[id].nightMin)
    .sort((a,b)=>cmpEmployee(users[a].name, users[b].name));

  userIds.forEach(id=>{
    const u = users[id];
    u.otPay    = u.exempt ? 0 : yen(u.rate, st.rates.overtime, u.otMin);
    u.naibuPay = u.exempt ? 0 : yen(u.rate, st.rates.naibu,    u.naibuMin);
    u.holPay   = u.exempt ? 0 : yen(u.rate, st.rates.holiday,  u.holMin);
    u.nightPay = yen(u.rate, st.rates.night, u.nightMin);
    u.total    = u.otPay + u.naibuPay + u.holPay + u.nightPay;
    // 現場ごとの金額。合計が u.total とぴったり合うように配る。
    // siteYen＝ぜんぶ合わせた額／siteYenBy＝残業・休日労働・深夜・所定外それぞれの額
    u.siteYen = {};
    u.siteYenBy = {ot:{}, hol:{}, night:{}, naibu:{}};
    const add = (kind, yenTotal, minBySite) => {
      const names = Object.keys(minBySite);
      if(!yenTotal || !names.length) return;
      const parts = otSplitInt(yenTotal, names.map(n=>minBySite[n]));
      names.forEach((n,i)=>{
        if(!parts[i]) return;
        u.siteYen[n] = (u.siteYen[n]||0) + parts[i];
        u.siteYenBy[kind][n] = (u.siteYenBy[kind][n]||0) + parts[i];
      });
    };
    add('ot',    u.otPay,    u.otSite);
    add('naibu', u.naibuPay, u.naibuSite);
    add('hol',   u.holPay,   u.holSite);
    add('night', u.nightPay, u.nightSite);
  });

  return {month, start, end, st, users, userIds};
}

// 日ごとの分数を、その日に出た現場へ実働時間の割合で配る
//   byDate  … {日付: 分}
//   daySite … {日付: {現場名: 実働分}}
function otSpreadToSites(byDate, daySite, start, end){
  const out = {};
  Object.keys(byDate||{}).forEach(day=>{
    const min = byDate[day];
    if(!min || day<start || day>end) return;      // 締め期間の中だけ
    const sites = daySite[day];
    if(!sites){ out['（工事未設定）'] = (out['（工事未設定）']||0) + min; return; }
    const names = Object.keys(sites);
    const parts = otSplitInt(min, names.map(n=>sites[n]));
    names.forEach((n,i)=>{ if(parts[i]) out[n] = (out[n]||0) + parts[i]; });
  });
  return out;
}

// ════ 1年単位の変形労働時間制の年間精算 ════
//
// この制度では、対象期間（年度）ぜんぶで見て法定の総枠を超えた時間も時間外になる。
// 毎日の8時間・毎週の40時間で数えた分を引いた残りが、年度末に出てくる時間外。
// 年度の途中でも「いまいくら分たまっているか」が分かるように出す。
function otYearlySettlement(month){
  const st = otPaySettings();
  const {from, to, fy} = otFiscalRange(month);
  const today = (typeof gbToday==='function') ? gbToday() : to;
  const upto = today < to ? today : to;
  const rows = [];

  const prem = {}, schedOv = {};
  (holidayRequests||[]).filter(hr=>hr.status==='approved' && hr.workDate).forEach(hr=>{
    if(!isFurikaeHoliday(hr)){ (prem[hr.userId] = prem[hr.userId] || new Set()).add(hr.workDate); return; }
    const o = schedOv[hr.userId] = schedOv[hr.userId] || {};
    o[hr.workDate] = true;
    if(hr.substituteDate) o[hr.substituteDate] = false;
  });
  const dayMin = {};
  (dailyReports||[]).filter(n=>n.workDate>=from && n.workDate<=upto).forEach(n=>{
    if(isNippoStateName(n.projectName)) return;
    if(prem[n.userId] && prem[n.userId].has(n.workDate)) return;
    (dayMin[n.userId] = dayMin[n.userId] || {})[n.workDate] =
      (dayMin[n.userId][n.workDate] || 0) + n.workMinutes;
  });

  nippoEmployees().forEach(p=>{
    const cal = p.workGroup==='訓練校生' ? 'trainee' : 'regular';
    if(otSystem(cal, st)!=='yearly') return;                 // 1年変形の区分だけ
    if(typeof isLeaveExempt==='function' && isLeaveExempt(p.displayName)) return;  // 役員は対象外
    const s = otSplitHours(cal, from, upto, dayMin[p.id]||{}, prem[p.id], st, schedOv[p.id]);
    const mh = otMonthlyHours(cal, month, st);
    const frameMin = Math.round(mh.frame * 60);
    // 年度の途中なので、総枠も経過日数で按分して見通しを出す
    const passed = Math.round((new Date(upto+'T00:00:00') - new Date(from+'T00:00:00'))/86400000) + 1;
    const overMin = Math.max(0, s.actualMin - frameMin - s.otMin);
    const salary = salaryFor(p.id, month);
    const base = otBaseWage(salary, st);
    const rate = base ? Math.round(base / mh.hours) : 0;
    rows.push({id:p.id, name:p.displayName, cal, fy, from, upto, passed, days:mh.days,
      actualMin:s.actualMin, frameMin, countedMin:s.otMin, naibuMin:s.naibuMin, overMin, rate,
      overPay: rate ? Math.round(rate * st.rates.overtime * overMin/60) : 0,
      // このペースで年度末まで進んだときの見込み
      forecastMin: passed>0 ? Math.round(s.actualMin * mh.days / passed) : 0});
  });
  rows.sort((a,b)=>cmpEmployee(a.name, b.name));
  return {fy, from, upto, rows};
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
      <td class="num">${u.naibuMin?otH(u.naibuMin):''}</td>
      <td class="num">${u.naibuPay?fmt(u.naibuPay):''}</td>
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
      <th class="num">所定外<br>(h)</th><th class="num">所定外<br>の賃金</th>
      <th class="num">残業<br>(h)</th><th class="num">残業代</th>
      <th class="num">休日労働<br>(h)</th><th class="num">休日手当</th>
      <th class="num">深夜<br>(h)</th><th class="num">深夜割増</th>
      <th class="num total">合計</th>
    </tr>
    ${rows}
    <tr class="sum">
      <td class="who">合計</td><td class="num"></td>
      <td class="num">${otH(sum('naibuMin'))}</td><td class="num">${fmt(sum('naibuPay'))}</td>
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
       + `割増率：残業${st.rates.overtime}／休日労働${st.rates.holiday}／深夜+${st.rates.night}／所定外（法定内）${st.rates.naibu}　`
       + `残業＝①1日の所定（8時間未満の日は8時間）を超えた分＋②週の所定（40時間未満の週は40時間）を超えた分。`
       + `所定外（法定内）＝所定は超えたが①②にならなかった分で、割増は要らないぶん。`;
}

// 時間外の中身の種類。表の列の並びもこの順
const OT_KINDS = [
  {key:'ot',    label:'残業代'},
  {key:'hol',   label:'休日出勤'},
  {key:'night', label:'深夜労働'},
  {key:'naibu', label:'所定外'}
];

// 誰の時間外の賃金が、どの現場にいくら乗っているか。
// 現場ごとに、残業・休日出勤・深夜労働・所定外の別でも金額が分かるようにする
function otSiteTableHtml(a, forPrint){
  const bySite = {};                       // 現場名 -> {uid: 円}
  const kindOf = {};                       // 現場名 -> {種類: 円}
  const colTotal = {}; a.userIds.forEach(id=>colTotal[id]=0);
  const kindTotal = {}; OT_KINDS.forEach(k=>kindTotal[k.key]=0);
  a.userIds.forEach(id=>{
    const u = a.users[id];
    Object.entries(u.siteYen||{}).forEach(([name,v])=>{
      (bySite[name] = bySite[name] || {})[id] = (bySite[name][id]||0) + v;
      colTotal[id] += v;
    });
    OT_KINDS.forEach(k=>{
      Object.entries((u.siteYenBy||{})[k.key]||{}).forEach(([name,v])=>{
        const g = kindOf[name] = kindOf[name] || {};
        g[k.key] = (g[k.key]||0) + v;
        kindTotal[k.key] += v;
      });
    });
  });
  const names = Object.keys(bySite).sort((x,y)=>{
    const sx = Object.values(bySite[x]).reduce((n,v)=>n+v,0);
    const sy = Object.values(bySite[y]).reduce((n,v)=>n+v,0);
    return sy-sx || x.localeCompare(y,'ja');
  });
  if(!names.length) return '';
  const ids = a.userIds.filter(id=>colTotal[id]);
  // 4種類とも必ず出す。ゼロの月も「無かった」と分かるようにするため
  const kinds = OT_KINDS;
  let grand = 0;
  const rows = names.map(name=>{
    const sum = ids.reduce((n,id)=>n+(bySite[name][id]||0), 0);
    grand += sum;
    const g = kindOf[name] || {};
    return `<tr>
      <td class="who">${esc(name)}</td>
      ${kinds.map(k=>`<td class="num">${g[k.key]?fmt(g[k.key]):''}</td>`).join('')}
      <td class="num total">${fmt(sum)}</td>
      ${ids.map(id=>`<td class="num">${bySite[name][id]?fmt(bySite[name][id]):''}</td>`).join('')}
    </tr>`;
  }).join('');
  return `
  <div class="otpay-year">
    <div class="otpay-year-head">現場ごとの時間外の内訳（種類別・誰の分がいくら）</div>
    <div class="otpay-year-note">
      残業・休日出勤・深夜労働が起きた日の日報から、その現場に乗せています。
      同じ日に2つの現場に出ていれば、その日の実働時間で分けています。現場別労務費の「時間外」と同じ金額です。
      左半分がその現場の種類別の金額、右半分が誰の分か。縦に見ればその人の月度の合計になります。
      ${kinds.map(k=>k.label).join('＋')}＝時間外の計です。
    </div>
    <div class="labor-scroll">
      <table class="otpay-tbl${forPrint?' print':''}">
        <tr><th class="who">現場（工事）</th>
          ${kinds.map(k=>`<th class="num">${k.label}</th>`).join('')}
          <th class="num total">時間外の計</th>
          ${ids.map(id=>`<th class="num">${esc(a.users[id].name)}</th>`).join('')}</tr>
        ${rows}
        <tr class="sum"><td class="who">合計</td>
          ${kinds.map(k=>`<td class="num">${fmt(kindTotal[k.key])}</td>`).join('')}
          <td class="num total">${fmt(grand)}</td>
          ${ids.map(id=>`<td class="num">${colTotal[id]?fmt(colTotal[id]):''}</td>`).join('')}</tr>
      </table>
    </div>
  </div>`;
}

// 1年単位の変形労働時間制の年間精算（該当する区分の社員がいるときだけ出す）
function otYearlyHtml(y){
  if(!y.rows.length) return '';
  const md = s => { const [,m,d] = s.split('-'); return `${Number(m)}/${Number(d)}`; };
  const rows = y.rows.map(r=>`<tr${r.overMin?' class="over"':''}>
      <td class="who">${esc(r.name)}</td>
      <td class="num">${otH(r.actualMin)}</td>
      <td class="num">${otH(r.frameMin)}</td>
      <td class="num">${r.countedMin?otH(r.countedMin):''}</td>
      <td class="num total">${r.overMin?otH(r.overMin):''}</td>
      <td class="num total">${r.overPay?fmt(r.overPay):''}</td>
      <td class="num">${otH(r.forecastMin)}</td>
    </tr>`).join('');
  return `
  <div class="otpay-year">
    <div class="otpay-year-head">1年単位の変形労働時間制の年間精算（${y.fy}年度）</div>
    <div class="otpay-year-note">
      この制度は、対象期間ぜんぶで見て法定の総枠を超えた時間も時間外になります。
      毎日の8時間・毎週の40時間で数えた分を引いた残りが、年度末に出てくる時間外です。
      いまは ${md(y.from)}〜${md(y.upto)} までの途中経過です。「このままの見込み」は、今のペースで年度末まで進んだ場合の実労働時間です。
    </div>
    <div class="labor-scroll">
      <table class="otpay-tbl">
        <tr><th class="who">社員</th><th class="num">実労働<br>(h)</th><th class="num">法定総枠<br>(h)</th>
          <th class="num">計上済み<br>の時間外</th><th class="num total">総枠超過<br>(h)</th><th class="num total">その賃金</th>
          <th class="num">このままの<br>見込み(h)</th></tr>
        ${rows}
      </table>
    </div>
  </div>`;
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
    (typeof nippoDupWarnHtml==='function' ? nippoDupWarnHtml(a.start, a.end) : '')
    + (noSalary.length ? `<div class="labor-warn">給与が未登録のため金額を出せない人：${esc(noSalary.join('、'))}</div>` : '')
    + warns.map(w=>`<div class="labor-warn danger">${esc(w)}</div>`).join('')
    + `<div class="labor-scroll">${otPayTableHtml(a, false)}</div>`
    + otSiteTableHtml(a, false)
    + otYearlyHtml(otYearlySettlement(mo))
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
  ${otSiteTableHtml(a, true)}
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
  st.rates = {overtime:num('ots-rate-ot',1.25), holiday:num('ots-rate-hol',1.35),
              night:num('ots-rate-night',0.25), naibu:num('ots-rate-naibu',1.0)};
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
  document.getElementById('ots-rate-naibu').value = st.rates.naibu;
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
