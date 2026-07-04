// ════ 工程表（ガントチャート） ════

const GANTT_CELL_W = 28; // px per day
const GANTT_COLORS = [
  '#3b82f6','#10b981','#f59e0b','#ef4444',
  '#8b5cf6','#06b6d4','#f97316','#ec4899',
  '#84cc16','#6b7280'
];

// ─ State ─
let scheduleTasks   = [];
let scheduleTaskSeq = 1;
let editingScheduleId = null;
let scheduleDirty   = false;

// ─ Date helpers ─
function todayStr() { return new Date().toISOString().slice(0, 10); }
function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function diffDays(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

// ─ DB ─
async function loadScheduleForProject() {
  const pName = selectedProject?.name;
  const badge = document.getElementById('sch-proj-name');
  if (badge) badge.textContent = pName || '（案件未選択）';
  scheduleTasks = [];
  editingScheduleId = null;
  scheduleDirty = false;
  scheduleTaskSeq = 1;

  if (!pName) { renderGantt(); return; }

  const { data, error } = await sb.from('schedules')
    .select('*')
    .eq('project_name', pName)
    .maybeSingle();

  if (error) { showToast('工程表の読み込みに失敗しました'); renderGantt(); return; }

  if (data) {
    editingScheduleId = data.id;
    scheduleTasks = data.tasks || [];
    scheduleTaskSeq = scheduleTasks.length
      ? Math.max(...scheduleTasks.map(t => t.id)) + 1
      : 1;
  }
  renderGantt();
}

async function saveSchedule() {
  const pName = selectedProject?.name;
  if (!pName) { showToast('案件を選択してください'); return; }

  const row = { project_name: pName, tasks: scheduleTasks, updated_at: new Date().toISOString() };

  if (editingScheduleId) {
    const { error } = await sb.from('schedules').update(row).eq('id', editingScheduleId);
    if (error) { showToast('保存に失敗しました: ' + error.message); return; }
  } else {
    const { data, error } = await sb.from('schedules').insert(row).select().single();
    if (error) { showToast('保存に失敗しました: ' + error.message); return; }
    editingScheduleId = data.id;
  }

  scheduleDirty = false;
  showToast('工程表を保存しました');
  _notifySchedulePersons(pName);
}

function _notifySchedulePersons(pName) {
  const persons = [...new Set(scheduleTasks.map(t => t.person).filter(Boolean))];
  persons.forEach(name => {
    if (suppliers.find(s => s.name === name)) {
      dbAddChatMessage(name, {
        role: 'me', type: 'text',
        text: `【工程表更新】${pName} の工程表が更新されました。ご確認ください。`
      }).catch(() => {});
    }
  });
}

// ─ Task CRUD ─
function schAddTask(level, parentId) {
  if (!selectedProject?.name) { showToast('案件を選択してください'); return; }
  level = level || 0;
  parentId = parentId || null;

  const sameLevel = scheduleTasks.filter(t => t.level === level);
  const color = GANTT_COLORS[sameLevel.length % GANTT_COLORS.length];
  const start = todayStr();
  const end   = addDaysStr(start, level === 0 ? 14 : 7);

  scheduleTasks.push({ id: scheduleTaskSeq++, level, parentId, name: '', start, end, person: '', color, collapsed: false });
  scheduleDirty = true;
  renderGantt();
  setTimeout(() => {
    const inputs = document.querySelectorAll('.gantt-name-inp');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }, 60);
}

function schRemoveTask(id) {
  scheduleTasks = scheduleTasks.filter(t => t.id !== id && t.parentId !== id);
  scheduleDirty = true;
  renderGantt();
}

function schUpdateTask(id, field, val) {
  const t = scheduleTasks.find(t => t.id === id);
  if (!t) return;
  t[field] = val;
  scheduleDirty = true;
  if (field === 'start' || field === 'end') renderGantt();
}

function schToggleCollapse(id) {
  const t = scheduleTasks.find(t => t.id === id);
  if (t) { t.collapsed = !t.collapsed; renderGantt(); }
}

// ─ Bulk shift ─
function openBulkShift() {
  if (!scheduleTasks.length) { showToast('工程がありません'); return; }
  document.getElementById('bulk-shift-from').value = todayStr();
  document.getElementById('bulk-shift-days').value = '';
  document.getElementById('bulk-shift-dir').value = 'later';
  document.getElementById('bulk-shift-modal').classList.add('open');
}

function applyBulkShift() {
  const fromDate = document.getElementById('bulk-shift-from').value;
  const days     = parseInt(document.getElementById('bulk-shift-days').value) || 0;
  const dir      = document.getElementById('bulk-shift-dir').value === 'later' ? 1 : -1;
  if (!fromDate || !days) { showToast('日付と日数を入力してください'); return; }

  const n = days * dir;
  scheduleTasks.forEach(t => {
    if (t.start >= fromDate) {
      t.start = addDaysStr(t.start, n);
      t.end   = addDaysStr(t.end, n);
    }
  });
  scheduleDirty = true;
  document.getElementById('bulk-shift-modal').classList.remove('open');
  renderGantt();
  showToast(`${days}日 ${dir > 0 ? '後ろ' : '前'} にずらしました`);
}

// ─ Excel export ─
async function exportScheduleExcel() {
  if (!scheduleTasks.length) { showToast('工程がありません'); return; }
  showToast('Excelを準備中…');
  await _loadXLSX().catch(() => null);
  if (!window.XLSX) { showToast('Excelライブラリの読み込みに失敗しました'); return; }

  const rows = [['階層', '工程名', '担当者', '開始日', '終了日', '日数']];
  scheduleTasks.forEach(t => {
    const days = t.start && t.end ? diffDays(t.start, t.end) + 1 : '';
    rows.push([
      t.level === 0 ? '大工程' : '　小工程',
      t.name,
      t.person,
      t.start,
      t.end,
      days
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [10, 28, 14, 12, 12, 6].map(w => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '工程表');
  const pName = selectedProject?.name || '工程表';
  XLSX.writeFile(wb, `工程表_${pName}_${todayStr().replace(/-/g,'')}.xlsx`);
}

let _xlsxPromise = null;
function _loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  if (!_xlsxPromise) {
    _xlsxPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  return _xlsxPromise;
}

// ─ Hook: called when selected project changes ─
function onProjectChanged() {
  if (document.getElementById('page-schedule')?.classList.contains('active')) {
    loadScheduleForProject();
  }
}

// ─ Gantt render ─
function renderGantt() {
  const wrap = document.getElementById('gantt-wrap');
  if (!wrap) return;

  const pName = selectedProject?.name;
  const badge = document.getElementById('sch-proj-name');
  if (badge) badge.textContent = pName || '（案件未選択）';

  if (!pName) {
    wrap.innerHTML = `<div class="sch-empty"><p>左サイドバーで案件を選択してください</p></div>`;
    return;
  }
  if (!scheduleTasks.length) {
    wrap.innerHTML = `<div class="sch-empty">
      <p>工程がまだありません</p>
      <button class="btn primary" onclick="schAddTask(0,null)">＋ 大工程を追加</button>
    </div>`;
    return;
  }

  // Calculate date range
  const allS = scheduleTasks.filter(t => t.start).map(t => t.start).sort();
  const allE = scheduleTasks.filter(t => t.end).map(t => t.end).sort();
  const minS = allS[0] || todayStr();
  const maxE = allE[allE.length - 1] || addDaysStr(todayStr(), 30);

  // d0: start of display range (back 7 days, aligned to Monday)
  const d0 = new Date(addDaysStr(minS, -7) + 'T00:00:00');
  const dow = d0.getDay();
  d0.setDate(d0.getDate() - (dow === 0 ? 6 : dow - 1));
  const d0str = d0.toISOString().slice(0, 10);

  const totalDays = diffDays(d0str, addDaysStr(maxE, 21)) + 1;
  const W = totalDays * GANTT_CELL_W;
  const todayS = todayStr();

  // Month groups
  const months = [];
  const cur = new Date(d0);
  for (let i = 0; i < totalDays; i++) {
    const ym = `${cur.getFullYear()}年${cur.getMonth() + 1}月`;
    if (!months.length || months[months.length - 1].label !== ym)
      months.push({ label: ym, count: 0 });
    months[months.length - 1].count++;
    cur.setDate(cur.getDate() + 1);
  }
  const monthRow = months.map(m =>
    `<div class="gantt-month-cell" style="width:${m.count * GANTT_CELL_W}px">${m.label}</div>`
  ).join('');

  // Day & weekday rows
  const c2 = new Date(d0);
  let dayRow = '', wdRow = '';
  for (let i = 0; i < totalDays; i++) {
    const wd = c2.getDay();
    const ds = c2.toISOString().slice(0, 10);
    const isWE = wd === 0 || wd === 6;
    const isTD = ds === todayS;
    const cls = isTD ? 'gantt-td' : isWE ? 'gantt-we' : '';
    const wdStr = ['日','月','火','水','木','金','土'][wd];
    dayRow += `<div class="gantt-day-cell ${cls}" style="width:${GANTT_CELL_W}px">${c2.getDate()}</div>`;
    wdRow  += `<div class="gantt-wd-cell ${cls}" style="width:${GANTT_CELL_W}px">${wdStr}</div>`;
    c2.setDate(c2.getDate() + 1);
  }

  // Weekend stripes (reusable in each row)
  const c3 = new Date(d0);
  let stripes = '';
  for (let i = 0; i < totalDays; i++) {
    const wd = c3.getDay();
    if (wd === 0 || wd === 6)
      stripes += `<div class="gantt-we-stripe" style="left:${i*GANTT_CELL_W}px;width:${GANTT_CELL_W}px"></div>`;
    c3.setDate(c3.getDate() + 1);
  }

  // Today line
  const todayOff = diffDays(d0str, todayS);
  const todayLine = (todayOff >= 0 && todayOff < totalDays)
    ? `<div class="gantt-today-line" style="left:${todayOff * GANTT_CELL_W + Math.floor(GANTT_CELL_W / 2)}px"></div>`
    : '';

  // Visible tasks (respecting collapse)
  const collapsedIds = new Set(
    scheduleTasks.filter(t => t.level === 0 && t.collapsed).map(t => t.id)
  );
  const visible = scheduleTasks.filter(t => t.level === 0 || !collapsedIds.has(t.parentId));

  let leftRows = '';
  let rightRows = '';

  visible.forEach(task => {
    const isMaj  = task.level === 0;
    const hasKids = scheduleTasks.some(t => t.parentId === task.id);
    const dur = task.start && task.end ? diffDays(task.start, task.end) + 1 : '?';

    const toggleBtn = (isMaj && hasKids)
      ? `<button class="gantt-toggle-btn" onclick="schToggleCollapse(${task.id})">${task.collapsed ? '▸' : '▾'}</button>`
      : `<span style="display:inline-block;width:14px"></span>`;

    const badge = isMaj
      ? `<span class="gantt-badge gantt-badge-maj">大</span>`
      : `<span class="gantt-badge gantt-badge-min" style="margin-left:8px">小</span>`;

    const addSubBtn = isMaj
      ? `<button class="btn xs" onclick="schAddTask(1,${task.id})" title="小工程を追加" style="padding:1px 4px;font-size:10px">＋小</button>`
      : `<span style="width:30px;display:inline-block"></span>`;

    leftRows += `<div class="gantt-row gantt-row-left ${isMaj ? 'gantt-row-major' : 'gantt-row-minor'}">
      <span class="gantt-drag-hdl">⠿</span>
      ${toggleBtn}
      ${badge}
      <input type="text" class="gantt-name-inp ${isMaj ? 'major' : ''}"
        value="${esc(task.name)}" placeholder="${isMaj ? '大工程名' : '小工程名'}"
        oninput="schUpdateTask(${task.id},'name',this.value)">
      <input type="text" class="gantt-person-inp"
        value="${esc(task.person)}" placeholder="担当"
        oninput="schUpdateTask(${task.id},'person',this.value)">
      <input type="color" class="gantt-color-inp" value="${task.color || '#3b82f6'}"
        oninput="schUpdateTask(${task.id},'color',this.value);renderGantt()">
      <input type="date" class="gantt-date-inp" value="${task.start || ''}"
        onchange="schUpdateTask(${task.id},'start',this.value)">
      <input type="date" class="gantt-date-inp" value="${task.end || ''}"
        onchange="schUpdateTask(${task.id},'end',this.value)">
      <span class="gantt-days-lbl">${dur}日</span>
      ${addSubBtn}
      <button class="btn danger xs" onclick="schRemoveTask(${task.id})" style="padding:1px 5px">×</button>
    </div>`;

    // Gantt bar
    const startOff = task.start ? diffDays(d0str, task.start) : 0;
    const endOff   = task.end   ? diffDays(d0str, task.end)   : 0;
    const barL = startOff * GANTT_CELL_W;
    const barW = Math.max(GANTT_CELL_W, (endOff - startOff + 1) * GANTT_CELL_W);
    const barCls = isMaj ? 'gantt-bar-major' : 'gantt-bar-minor';
    const barHtml = task.start && task.end
      ? `<div class="gantt-bar ${barCls}" style="left:${barL}px;width:${barW}px;background:${task.color || '#3b82f6'}">
           <span class="gantt-bar-text">${esc(task.name)}</span>
         </div>`
      : '';

    rightRows += `<div class="gantt-row gantt-row-right" style="width:${W}px">
      ${stripes}${todayLine}${barHtml}
    </div>`;
  });

  wrap.innerHTML = `
    <div class="gantt-container">
      <div class="gantt-left-panel">
        <div class="gantt-head-left">
          <div class="gantt-head-left-inner">
            <span style="width:14px"></span>
            <span style="width:14px"></span>
            <span style="width:18px"></span>
            <span class="glh-name">工程名</span>
            <span class="glh-person">担当</span>
            <span style="width:28px">色</span>
            <span class="glh-date">開始日</span>
            <span class="glh-date">終了日</span>
            <span style="width:30px;text-align:right">日数</span>
            <span style="width:72px"></span>
          </div>
        </div>
        <div class="gantt-body-left" id="gantt-body-left">${leftRows}</div>
      </div>
      <div class="gantt-right-panel">
        <div class="gantt-head-right" id="gantt-head-right">
          <div class="gantt-month-row" style="width:${W}px">${monthRow}</div>
          <div class="gantt-day-row"   style="width:${W}px">${dayRow}</div>
          <div class="gantt-wd-row"    style="width:${W}px">${wdRow}</div>
        </div>
        <div class="gantt-body-right" id="gantt-body-right">${rightRows}</div>
      </div>
    </div>
  `;

  // Sync scroll: right-body drives both vertical (left-body) and horizontal (right-head)
  const bodyL = document.getElementById('gantt-body-left');
  const bodyR = document.getElementById('gantt-body-right');
  const headR = document.getElementById('gantt-head-right');

  bodyR.addEventListener('scroll', () => {
    if (headR) headR.scrollLeft = bodyR.scrollLeft;
    if (bodyL) bodyL.scrollTop  = bodyR.scrollTop;
  });
  bodyL.addEventListener('scroll', () => {
    if (bodyR) bodyR.scrollTop = bodyL.scrollTop;
  });

  // Scroll right panel to show today
  if (todayOff > 5 && bodyR) {
    bodyR.scrollLeft = Math.max(0, (todayOff - 5) * GANTT_CELL_W);
  }
}
