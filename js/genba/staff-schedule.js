// ════ 人員配置スケジュール（誰がいつどの現場に入るか） ════
//
// 工程表と同じガントチャートの形で出す。
//   ・大工程にあたるのが社員大工（下の STAFF_CARPENTERS の9人・並びも固定）
//   ・小工程にあたるのが「いつ・どの現場」の1本1本
//   ・見た目は工程表と同じ作り（css/schedule.css の .gantt-* をそのまま使う）
//
// 工程表との違いは2つ。
//   ①「保存」を押す形ではなく、足した・直した・消したをその場で書き込む
//     （配置は何人かで同時にいじることがあり、1枚で上書きすると消し合うため）
//   ② 人の行は消せない。いつも9人ぶん並ぶ（空いている人がすぐ分かるように）
//
// 置き場所：勤怠日報 → 日報タブの左。見られるのは社員、直せるのは管理者だけ。

// アカウントの表示名で持つ（js/genba/genba-nippo.js の EMPLOYEE_ORDER と同じ綴り）。
// 日報の実績と同じ名前にそろえておくと、あとで予定と実績を突き合わせられる。
// 並びは「会長・太視・説志・原口・山口・梅田・石橋・梶原・創史」の順
const STAFF_CARPENTERS = [
  '清川伸二','清川太視','清川説志','原口晴郎','山口大輔',
  '梅田昭文','石橋実咲','梶原大地','清川創史'
];

// 表に出す行。決まった9人に加えて、名前が合わない配置が残っていたらその人も出す
// （名前を変えたあとなどに、配置が黙って消えないようにするため）
function ssRows(){
  const extra = [...new Set(staffAssigns.map(a=>a.person))]
    .filter(p=>p && !STAFF_CARPENTERS.includes(p))
    .sort((a,b)=>a.localeCompare(b,'ja'));
  return [...STAFF_CARPENTERS, ...extra];
}

// 人ごとの帯の色。工程表のバーと同じで、名前が黒でも白でも読める明るさに寄せる
const STAFF_COLORS = [
  '#93c5fd','#86efac','#fcd34d','#fca5a5','#c4b5fd',
  '#a5f3fc','#fdba74','#f9a8d4','#bef264'
];

const SS_CELL_W = 28;      // 1日ぶんの幅（px）。工程表と同じ
const SS_PAST_DAYS = 7;    // 今日より前を何日ぶん出すか
const SS_MIN_DAYS  = 56;   // 少なくともこの日数ぶんは出す

let staffAssigns   = [];     // [{id, person, projectName, start, end, note}]
let ssCollapsed    = {};     // 人ごとの開け閉め（閉じると帯1本にまとまる）
let ssEditId       = null;   // 直している配置のid（新しく足すときは null）
let ssEditPerson   = '';     // 新しく足すときの相手
let ssScrollLeft   = -1;     // 横の位置（描き直しても戻さない）
let ssD0           = '';     // 左端の日付
let ssDays         = 0;
let ssReady        = true;

function ssCanEdit(){ return currentUserRole === 'staff'; }

// ── 読み込み ──
async function fetchStaffAssigns(){
  const { data, error } = await sb.from('staff_assignments')
    .select('*').order('start_date', { ascending: true });
  ssReady = !error;
  if(error){ console.warn('人員配置を読めませんでした', error.message); return; }
  staffAssigns = (data||[]).map(r=>({
    id:r.id, person:r.person||'', projectName:r.project_name||'',
    start:r.start_date||'', end:r.end_date||'', note:r.note||''
  }));
}
async function refreshStaffAssigns(){
  try{ await fetchStaffAssigns(); }catch(_){ return; }
  if(document.getElementById('ss-inner')) renderStaffSchedule();
}

// ── 日付まわり（工程表と同じ数え方） ──
function ssToday(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function ssAddDays(ymd, n){
  const d = new Date(ymd+'T00:00:00');
  d.setDate(d.getDate()+n);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function ssDiffDays(a, b){
  return Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00')) / 86400000);
}

// 出す期間を決める。今日の1週間前から、配置の終わりまで（最低8週間）
function ssRange(){
  const starts = staffAssigns.map(a=>a.start).filter(Boolean).sort();
  const ends   = staffAssigns.map(a=>a.end).filter(Boolean).sort();
  const today  = ssToday();
  let from = ssAddDays(today, -SS_PAST_DAYS);
  if(starts.length && starts[0] < from) from = starts[0];
  // 左端は月曜にそろえる（7日ごとの線が週の区切りになるように）
  const d = new Date(from+'T00:00:00');
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  from = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');

  let to = ssAddDays(today, SS_MIN_DAYS);
  if(ends.length && ends[ends.length-1] > to) to = ends[ends.length-1];
  return { from, days: Math.max(SS_MIN_DAYS, ssDiffDays(from, to) + 7) };
}

function ssPersonColor(person){
  const i = STAFF_CARPENTERS.indexOf(person);
  const base = STAFF_COLORS[(i < 0 ? 0 : i) % STAFF_COLORS.length];
  // 工程表と同じ決まりで、名前が読める明るさに寄せる
  return (typeof _readableBarColor === 'function') ? _readableBarColor(base) : base;
}

// その人の配置を、開始の早い順に
function ssAssignsOf(person){
  return staffAssigns.filter(a=>a.person===person)
    .sort((a,b)=> (a.start||'').localeCompare(b.start||'') || a.id-b.id);
}

// いまこの人が入っている現場（今日の日付で見る）
function ssNowAt(person){
  const t = ssToday();
  return ssAssignsOf(person).filter(a=>a.start<=t && t<=a.end).map(a=>a.projectName);
}

// ── 画面 ──
function renderStaffSchedule(){
  const inner = document.getElementById('ss-inner');
  if(!inner) return;

  const editable = ssCanEdit();
  document.getElementById('ss-add-btn')?.style.setProperty('display', editable ? '' : 'none');

  if(!ssReady){
    inner.innerHTML = '<div class="sch-empty"><p>人員配置の準備ができていません。<br>管理者にお問い合わせください</p></div>';
    return;
  }

  const { from, days } = ssRange();
  ssD0 = from; ssDays = days;
  const W = days * SS_CELL_W;
  const today = ssToday();
  const todayOff = ssDiffDays(from, today);

  // 日付の見出し（月・日・曜日）
  let monthRow='', dayRow='', wdRow='', stripes='';
  const months = [];
  for(let i=0;i<days;i++){
    const ymd = ssAddDays(from, i);
    const d = new Date(ymd+'T00:00:00');
    const key = d.getFullYear()+'-'+(d.getMonth()+1);
    if(!months.length || months[months.length-1].key !== key){
      months.push({ key, label: d.getFullYear()+'年'+(d.getMonth()+1)+'月', count: 1 });
    } else months[months.length-1].count++;
    const wd = d.getDay();
    const we = (wd===0 || wd===6);
    const cls = (ymd===today) ? 'gantt-td' : (we ? 'gantt-we' : '');
    dayRow += `<div class="gantt-day-cell ${cls}" style="width:${SS_CELL_W}px">${d.getDate()}</div>`;
    wdRow  += `<div class="gantt-wd-cell ${cls}" style="width:${SS_CELL_W}px">${'日月火水木金土'[wd]}</div>`;
    if(we) stripes += `<div class="gantt-we-stripe" style="left:${i*SS_CELL_W}px;width:${SS_CELL_W}px"></div>`;
  }
  monthRow = months.map(m=>`<div class="gantt-month-cell" style="width:${m.count*SS_CELL_W}px">${m.label}</div>`).join('');

  const todayBand = (todayOff>=0 && todayOff<days)
    ? `<div class="gantt-today-band" style="left:${todayOff*SS_CELL_W}px;width:${SS_CELL_W}px"></div>` : '';
  const todayLine = (todayOff>=0 && todayOff<days)
    ? `<div class="gantt-today-line" style="left:${todayOff*SS_CELL_W+Math.floor(SS_CELL_W/2)}px"></div>` : '';

  let leftRows='', rightRows='';
  ssRows().forEach(person=>{
    const list = ssAssignsOf(person);
    const col  = ssPersonColor(person);
    const open = !ssCollapsed[person];
    const nowAt = ssNowAt(person);

    // ── 人の行（工程表の大工程にあたる） ──
    leftRows += `<div class="gantt-row gantt-row-left gantt-row-major" onclick="ssToggle('${person}')">
      <button type="button" class="gantt-toggle-btn">${open?'▾':'▸'}</button>
      <span class="gantt-badge gantt-badge-maj" style="background:${col};color:#23201c">人</span>
      <span class="grl-name">${esc(person)}</span>
      <span class="grl-days">${list.length}件</span>
    </div>`;

    // 人の帯は、その人の配置がある日だけ色を敷く（空いている日がひと目で分かる）
    let bands='';
    list.forEach(a=>{
      const s = Math.max(0, ssDiffDays(from, a.start));
      const e = Math.min(days-1, ssDiffDays(from, a.end));
      if(e < 0 || s > days-1) return;
      bands += `<div class="ss-band" style="left:${s*SS_CELL_W}px;width:${(e-s+1)*SS_CELL_W}px;background:${col}"></div>`;
    });
    rightRows += `<div class="gantt-row gantt-row-right gantt-row-major" style="width:${W}px;background-color:${col}2b">
      <div class="gantt-grid"></div>${stripes}${todayBand}${todayLine}${bands}
      <div class="gantt-grp-chip" style="border-left-color:${col}" onclick="event.stopPropagation();ssToggle('${person}')">
        <span class="gantt-grp-caret">${open?'▼':'▶'}</span>
        <span class="gantt-grp-name">${esc(person)}</span>
        ${nowAt.length ? `<span class="ss-now">${esc(nowAt.join('・'))}</span>`
                       : '<span class="ss-free">空き</span>'}
      </div>
    </div>`;

    if(!open) return;

    // ── その人の配置（工程表の小工程にあたる） ──
    list.forEach(a=>{
      const s = ssDiffDays(from, a.start);
      const e = ssDiffDays(from, a.end);
      const barL = s * SS_CELL_W;
      const barW = Math.max(SS_CELL_W, (e - s + 1) * SS_CELL_W);
      const dur = e - s + 1;
      leftRows += `<div class="gantt-row gantt-row-left gantt-row-minor" onclick="ssOpenEdit(${a.id})">
        <span style="display:inline-block;width:14px"></span>
        <span class="gantt-badge gantt-badge-min">現</span>
        <span class="grl-color-dot" style="background:${col}"></span>
        <span class="grl-name">${esc(a.projectName||'（現場未入力）')}</span>
        <span class="grl-days">${dur}日</span>
      </div>`;
      rightRows += `<div class="gantt-row gantt-row-right" style="width:${W}px;background-color:${col}12">
        <div class="gantt-grid"></div>${stripes}${todayBand}${todayLine}
        <div class="gantt-bar gantt-bar-minor ss-bar" id="ss-bar-${a.id}"
             style="left:${barL}px;width:${barW}px;background:${col}"
             title="${esc(a.projectName)}　${a.start.replace(/-/g,'/')}〜${a.end.replace(/-/g,'/')}${a.note?'　'+esc(a.note):''}"
             onmousedown="ssDragStart(event,${a.id},'move')" ontouchstart="ssDragStart(event,${a.id},'move')">
          ${editable?`<div class="gantt-bar-hdl gantt-bar-hdl-l"
            onmousedown="event.stopPropagation();ssDragStart(event,${a.id},'start')"
            ontouchstart="event.stopPropagation();ssDragStart(event,${a.id},'start')"></div>`:''}
          <span class="gantt-bar-text">${esc(a.projectName||'（現場未入力）')}</span>
          ${editable?`<div class="gantt-bar-hdl gantt-bar-hdl-r"
            onmousedown="event.stopPropagation();ssDragStart(event,${a.id},'end')"
            ontouchstart="event.stopPropagation();ssDragStart(event,${a.id},'end')"></div>`:''}
        </div>
      </div>`;
    });

    // 足すための1行（管理者だけ）
    if(editable){
      leftRows += `<div class="gantt-row gantt-row-left ss-add-row" onclick="ssOpenNew('${person}')">
        <span style="display:inline-block;width:14px"></span>
        <span class="grl-name ss-add-lbl">＋ ${esc(person)}の配置を足す</span>
      </div>`;
      rightRows += `<div class="gantt-row gantt-row-right ss-add-row" style="width:${W}px"
        onclick="ssOpenNew('${person}')">
        <div class="gantt-grid"></div>${stripes}${todayBand}${todayLine}
      </div>`;
    }
  });

  inner.innerHTML = `
    <div class="gantt-container" style="--gantt-cell:${SS_CELL_W}px">
      <div class="gantt-left-panel">
        <div class="gantt-head-left"><div class="gantt-head-left-inner" id="ss-head-left">
          <span class="glh-name" style="flex:1">社員大工 ／ 現場</span>
          <span style="width:32px;text-align:right">日数</span>
        </div></div>
        <div class="gantt-body-left" id="ss-body-left">${leftRows}</div>
      </div>
      <div class="gantt-right-panel">
        <div class="gantt-head-right" id="ss-head-right">
          <div class="gantt-month-row" style="width:${W}px">${monthRow}</div>
          <div class="gantt-day-row"   style="width:${W}px">${dayRow}</div>
          <div class="gantt-wd-row"    style="width:${W}px">${wdRow}</div>
        </div>
        <div class="gantt-body-right" id="ss-body-right">${rightRows}</div>
      </div>
    </div>`;

  // 左右の見出しの高さをそろえる（行がずれないように）
  const hl = inner.querySelector('.gantt-head-left'), hr = inner.querySelector('.gantt-head-right');
  if(hl && hr) hl.style.height = hr.offsetHeight + 'px';

  // 縦横のスクロールを左右で合わせる
  const bl = document.getElementById('ss-body-left'), br = document.getElementById('ss-body-right');
  br.addEventListener('scroll', ()=>{
    ssScrollLeft = br.scrollLeft;
    hr.scrollLeft = br.scrollLeft;
    bl.scrollTop  = br.scrollTop;
  });
  bl.addEventListener('scroll', ()=>{ br.scrollTop = bl.scrollTop; });

  // はじめは今日のあたりを出す。2回目からは見ていた位置のまま
  br.scrollLeft = (ssScrollLeft >= 0) ? ssScrollLeft
                : Math.max(0, (todayOff - 3) * SS_CELL_W);
  hr.scrollLeft = br.scrollLeft;
}

function ssToggle(person){
  ssCollapsed[person] = !ssCollapsed[person];
  renderStaffSchedule();
}
function ssScrollToToday(){
  const br = document.getElementById('ss-body-right');
  if(!br) return;
  const off = ssDiffDays(ssD0, ssToday());
  br.scrollLeft = Math.max(0, (off - 3) * SS_CELL_W);
}
function ssToggleAll(){
  const anyOpen = ssRows().some(p=>!ssCollapsed[p]);
  ssRows().forEach(p=>{ ssCollapsed[p] = anyOpen; });
  renderStaffSchedule();
}

// ── バーを引きずって動かす（工程表と同じ感じ。1日きざみ） ──
let _ssDrag = null;
function ssDragStart(e, id, type){
  if(!ssCanEdit()) return;
  const a = staffAssigns.find(x=>x.id===id);
  if(!a) return;
  const pt = e.touches ? e.touches[0] : e;
  _ssDrag = { id, type, x0: pt.clientX, start: a.start, end: a.end, moved: false };
  document.addEventListener('mousemove', ssDragMove, { passive:false });
  document.addEventListener('mouseup',   ssDragEnd);
  document.addEventListener('touchmove', ssDragMove, { passive:false });
  document.addEventListener('touchend',  ssDragEnd);
  e.preventDefault();
}
function ssDragMove(e){
  if(!_ssDrag) return;
  const pt = e.touches ? e.touches[0] : e;
  const dx = pt.clientX - _ssDrag.x0;
  const step = Math.round(dx / SS_CELL_W);
  if(Math.abs(dx) >= SS_CELL_W * 0.4) _ssDrag.moved = true;
  const a = staffAssigns.find(x=>x.id===_ssDrag.id);
  if(!a) return;
  if(_ssDrag.type === 'move'){
    a.start = ssAddDays(_ssDrag.start, step);
    a.end   = ssAddDays(_ssDrag.end,   step);
  } else if(_ssDrag.type === 'start'){
    const s = ssAddDays(_ssDrag.start, step);
    if(s <= a.end) a.start = s;
  } else {
    const t = ssAddDays(_ssDrag.end, step);
    if(t >= a.start) a.end = t;
  }
  // 引きずっている間は、バーだけ動かす（全部描き直すとカクつくため）
  const bar = document.getElementById('ss-bar-'+a.id);
  if(bar){
    const s = ssDiffDays(ssD0, a.start), t = ssDiffDays(ssD0, a.end);
    bar.style.left  = (s * SS_CELL_W) + 'px';
    bar.style.width = Math.max(SS_CELL_W, (t - s + 1) * SS_CELL_W) + 'px';
  }
  e.preventDefault();
}
async function ssDragEnd(){
  const d = _ssDrag;
  _ssDrag = null;
  document.removeEventListener('mousemove', ssDragMove);
  document.removeEventListener('mouseup',   ssDragEnd);
  document.removeEventListener('touchmove', ssDragMove);
  document.removeEventListener('touchend',  ssDragEnd);
  if(!d) return;
  const a = staffAssigns.find(x=>x.id===d.id);
  if(!a) return;
  if(!d.moved){                       // 動かしていないならタップ扱い。中身を直す画面を出す
    a.start = d.start; a.end = d.end;
    ssOpenEdit(d.id);
    return;
  }
  const { error } = await sb.from('staff_assignments')
    .update({ start_date:a.start, end_date:a.end }).eq('id', d.id);
  if(error){                          // 書けなかったら元に戻す
    a.start = d.start; a.end = d.end;
    showToast('動かせませんでした：'+error.message);
  }
  renderStaffSchedule();
}

// ── 足す・直す・消す ──
function ssFillProjectSelect(picked){
  const sel = document.getElementById('ss-project');
  if(!sel) return;
  // もう終わった工事（完工・失注）は選べないようにする。
  // 現場以外（設計・事務など）も入れられるよう、決まったものも並べる
  const names = (projects||[])
    .filter(p=>typeof isProjectClosed==='function' ? !isProjectClosed(p) : true)
    .map(p=>p.name);
  const extras = ['設計','事務','空き家管理','研修','応援'];
  const all = [...new Set([...names, ...extras, ...(picked?[picked]:[])])];
  sel.innerHTML = '<option value="">現場を選択…</option>' +
    all.map(n=>`<option value="${esc(n)}"${n===picked?' selected':''}>${esc(n)}</option>`).join('');
  if(picked) sel.value = picked;
}
function ssFillPersonSelect(picked){
  const sel = document.getElementById('ss-person');
  if(!sel) return;
  sel.innerHTML = ssRows()
    .map(p=>`<option value="${esc(p)}"${p===picked?' selected':''}>${esc(p)}</option>`).join('');
  if(picked) sel.value = picked;
}
function ssOpenNew(person){
  if(!ssCanEdit()){ showToast('人員配置を組めるのは管理者だけです'); return; }
  ssEditId = null; ssEditPerson = person;
  document.getElementById('ss-modal-title').textContent = person ? person + 'の配置を足す' : '配置を足す';
  ssFillPersonSelect(person || ssRows()[0]);
  ssFillProjectSelect('');
  document.getElementById('ss-start').value = ssToday();
  document.getElementById('ss-end').value   = ssAddDays(ssToday(), 4);
  document.getElementById('ss-note').value  = '';
  document.getElementById('ss-delete-btn').style.display = 'none';
  document.getElementById('ss-modal').classList.add('open');
}
function ssOpenEdit(id){
  const a = staffAssigns.find(x=>x.id===id);
  if(!a) return;
  if(!ssCanEdit()){
    showToast(`${a.person}：${a.projectName}（${a.start.replace(/-/g,'/')}〜${a.end.replace(/-/g,'/')}）`);
    return;
  }
  ssEditId = id; ssEditPerson = a.person;
  document.getElementById('ss-modal-title').textContent = '配置を直す';
  ssFillPersonSelect(a.person);
  ssFillProjectSelect(a.projectName);
  document.getElementById('ss-start').value = a.start;
  document.getElementById('ss-end').value   = a.end;
  document.getElementById('ss-note').value  = a.note || '';
  document.getElementById('ss-delete-btn').style.display = '';
  document.getElementById('ss-modal').classList.add('open');
}
function closeSsModal(){ document.getElementById('ss-modal').classList.remove('open'); }

async function saveSsAssign(){
  const person  = document.getElementById('ss-person').value;
  const project = document.getElementById('ss-project').value;
  const start   = document.getElementById('ss-start').value;
  const end     = document.getElementById('ss-end').value;
  const note    = document.getElementById('ss-note').value.trim();
  if(!person){ showToast('社員大工を選んでください'); return; }
  if(!project){ showToast('現場を選んでください'); return; }
  if(!start || !end){ showToast('期間を入れてください'); return; }
  if(end < start){ showToast('終わりの日が始まりより前になっています'); return; }

  const row = { person, project_name:project, start_date:start, end_date:end, note };
  if(ssEditId){
    const { error } = await sb.from('staff_assignments').update(row).eq('id', ssEditId);
    if(error){ showToast('保存できませんでした：'+error.message); return; }
  } else {
    const { error } = await sb.from('staff_assignments')
      .insert({ ...row, created_by: currentUserDisplayName||'' });
    if(error){ showToast('登録できませんでした：'+error.message); return; }
  }
  closeSsModal();
  await refreshStaffAssigns();
  showToast(ssEditId ? '配置を直しました' : '配置を足しました');
}

async function deleteSsAssign(){
  if(!ssEditId) return;
  if(!confirm('この配置を消します。よろしいですか？')) return;
  const { error } = await sb.from('staff_assignments').delete().eq('id', ssEditId);
  if(error){ showToast('消せませんでした：'+error.message); return; }
  closeSsModal();
  await refreshStaffAssigns();
  showToast('配置を消しました');
}
