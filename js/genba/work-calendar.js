// ════ 勤務カレンダー管理（事務専用：出勤日／休日の設定・社員区分の割り当て） ════
// 休日 ＝ work_holidays に登録された日。出勤日 ＝ 登録が無い日。
// cal: 'regular'（役員・一般社員）／'trainee'（訓練校生）

// 初期化（この月を土日祝で休みに）用の祝日・会社休（2026年度）
const WC_NATIONAL_HOLIDAYS = [
  '2026-04-29','2026-05-04','2026-05-05','2026-05-06','2026-07-20','2026-08-11',
  '2026-09-21','2026-09-22','2026-09-23','2026-10-12','2026-11-03','2026-11-23',
  '2027-01-01','2027-01-11','2027-02-11','2027-02-23','2027-03-22'
];
const WC_COMPANY_CLOSURES = ['2026-08-13','2026-08-14','2026-12-30','2026-12-31'];

function wcDateStr(y,m,d){ return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'); }
function wcThisMonth(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }

function openWorkCalendar(){
  if(currentUserRole!=='staff') return;
  wcCal='regular';
  wcMonth=wcMonth||wcThisMonth();
  document.getElementById('wc-modal').classList.add('open');
  renderWorkCalendar();
}
function closeWorkCalendar(){ document.getElementById('wc-modal').classList.remove('open'); }

function wcSetCal(cal){ wcCal=cal; renderWorkCalendar(); }
function wcMonthShift(delta){
  const [y,m]=wcMonth.split('-').map(Number);
  const d=new Date(y,m-1+delta,1);
  wcMonth=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  renderWorkCalendar();
}

async function wcToggleDay(dateStr){
  const set=workHolidays[wcCal];
  try{
    if(set.has(dateStr)) await dbRemoveHoliday(wcCal,dateStr);
    else await dbAddHoliday(wcCal,dateStr);
  }catch(e){ return; }
  renderWorkCalendar();
}

// この月を土日祝で休みに（既存の休日はそのまま。不足分を追加）
async function wcSeedMonth(){
  const [y,m]=wcMonth.split('-').map(Number);
  const label=`${y}年${m}月`;
  const isTrainee=wcCal==='trainee';
  if(!confirm(`${label}の${isTrainee?'訓練校生':'一般社員'}カレンダーを、${isTrainee?'日曜＋祝日':'土日＋祝日'}で休みに設定します。\n（既に設定済みの休日はそのまま残ります）`)) return;
  const days=new Date(y,m,0).getDate();
  const add=[];
  for(let d=1;d<=days;d++){
    const ds=wcDateStr(y,m,d);
    const dow=new Date(y,m-1,d).getDay();
    let holiday=false;
    if(isTrainee){
      holiday = dow===0 || WC_NATIONAL_HOLIDAYS.includes(ds); // 訓練校生：日曜＋祝日
    } else {
      holiday = dow===0 || dow===6 || WC_NATIONAL_HOLIDAYS.includes(ds) || WC_COMPANY_CLOSURES.includes(ds); // 一般：土日＋祝日＋会社休
    }
    if(holiday && !workHolidays[wcCal].has(ds)) add.push(ds);
  }
  for(const ds of add){ try{ await dbAddHoliday(wcCal,ds); }catch(e){} }
  showToast(`${label}を初期化しました（${add.length}日を休みに設定）`);
  renderWorkCalendar();
}

function renderWorkCalendar(){
  // グループ切替
  document.getElementById('wc-cal-regular').classList.toggle('active', wcCal==='regular');
  document.getElementById('wc-cal-trainee').classList.toggle('active', wcCal==='trainee');

  const [y,m]=wcMonth.split('-').map(Number);
  document.getElementById('wc-month-lbl').textContent=`${y}年${m}月`;

  const set=workHolidays[wcCal];
  const firstDow=new Date(y,m-1,1).getDay();
  const days=new Date(y,m,0).getDate();
  const yobi=['日','月','火','水','木','金','土'];

  let cells='';
  for(let i=0;i<firstDow;i++) cells+='<div class="wc-cell wc-empty"></div>';
  let workCount=0;
  for(let d=1;d<=days;d++){
    const ds=wcDateStr(y,m,d);
    const dow=new Date(y,m-1,d).getDay();
    const isHoliday=set.has(ds);
    if(!isHoliday) workCount++;
    const cls=isHoliday?'wc-holiday':(dow===0?'wc-sun':dow===6?'wc-sat':'');
    cells+=`<div class="wc-cell ${cls}" onclick="wcToggleDay('${ds}')">
      <span class="wc-d">${d}</span>
      <span class="wc-mk">${isHoliday?'休':''}</span>
    </div>`;
  }
  document.getElementById('wc-grid').innerHTML=
    yobi.map((w,i)=>`<div class="wc-head ${i===0?'wc-sun':i===6?'wc-sat':''}">${w}</div>`).join('')+cells;
  document.getElementById('wc-workcount').textContent=`この月の出勤日：${workCount}日`;

  renderWcAssign();
}

// 社員区分の割り当て
function renderWcAssign(){
  const el=document.getElementById('wc-assign-list');
  if(!allProfiles.length){ el.innerHTML='<div class="empty" style="padding:10px">社員が登録されていません</div>'; return; }
  const groups=['','役員','一般社員','訓練校生'];
  const labels={'':'（対象外）','役員':'役員','一般社員':'一般社員','訓練校生':'訓練校生'};
  el.innerHTML=allProfiles.filter(p=>p.role!=='supplier').map(p=>`
    <div class="wc-assign-row">
      <span style="flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.displayName||'（名前未設定）')}</span>
      <select onchange="wcSetGroup('${p.id}',this.value)" style="font-size:12px;padding:4px 6px">
        ${groups.map(g=>`<option value="${g}"${p.workGroup===g?' selected':''}>${labels[g]}</option>`).join('')}
      </select>
    </div>`).join('');
}
async function wcSetGroup(userId, group){
  try{ await dbSetWorkGroup(userId, group); }catch(e){ return; }
  showToast('区分を保存しました');
}
