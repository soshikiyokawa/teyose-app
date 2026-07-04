// ════ 工程表（ガントチャート） ════

const GANTT_CELL_W = 28; // px per day
const GANTT_COLORS = [
  '#3b82f6','#10b981','#f59e0b','#ef4444',
  '#8b5cf6','#06b6d4','#f97316','#ec4899',
  '#84cc16','#6b7280'
];

// ─ State ─
let scheduleTasks     = [];
let scheduleTaskSeq   = 1;
let editingScheduleId = null;
let scheduleDirty     = false;
let editingTaskId     = null;

// ─ Drag state ─
let ganttD0str    = ''; // leftmost date of current gantt view (for hit testing)
let _drag         = null; // { type:'move'|'resize-start'|'resize-end', taskId, startX, origStart, origEnd, moved }
let ganttScrollLeft = -1; // -1 = 未設定（初回のみ今日へスクロール）

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

// ─ Color: 小工程は親（大工程）の色を使う ─
function _getTaskColor(task) {
  if (task.level === 0) return task.color || '#3b82f6';
  const parent = scheduleTasks.find(t => t.id === task.parentId);
  return parent ? (parent.color || '#3b82f6') : (task.color || '#3b82f6');
}

// ─ 親（大工程）の日付を子（小工程）の最小開始〜最大終了に合わせる ─
function _syncParentDates(parentId) {
  if (!parentId) return;
  const parent = scheduleTasks.find(t => t.id === parentId);
  if (!parent) return;
  const kids = scheduleTasks.filter(t => t.parentId === parentId && t.start && t.end);
  if (!kids.length) return;
  parent.start = kids.map(t => t.start).sort()[0];
  parent.end   = kids.map(t => t.end).sort().reverse()[0];
}

// ─ DB ─
async function loadScheduleForProject() {
  const pName = selectedProject?.name;
  const badge = document.getElementById('sch-proj-name');
  if (badge) badge.textContent = pName || '（案件未選択）';
  scheduleTasks = []; editingScheduleId = null; editingTaskId = null;
  scheduleDirty = false; scheduleTaskSeq = 1; ganttScrollLeft = -1;

  if (!pName) { renderGantt(); return; }

  const { data, error } = await sb.from('schedules')
    .select('*').eq('project_name', pName).maybeSingle();
  if (error) { showToast('工程表の読み込みに失敗しました'); renderGantt(); return; }

  if (data) {
    editingScheduleId = data.id;
    scheduleTasks = data.tasks || [];
    scheduleTaskSeq = scheduleTasks.length ? Math.max(...scheduleTasks.map(t => t.id)) + 1 : 1;
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
  [...new Set(scheduleTasks.map(t => t.person).filter(Boolean))].forEach(name => {
    if (suppliers.find(s => s.name === name)) {
      dbAddChatMessage(name, { role:'me', type:'text',
        text:`【工程表更新】${pName} の工程表が更新されました。ご確認ください。`
      }).catch(()=>{});
    }
  });
}

// ─ Task CRUD ─
function schAddTask(level, parentId) {
  if (!selectedProject?.name) { showToast('案件を選択してください'); return; }
  level = level || 0; parentId = parentId || null;
  const parent = scheduleTasks.find(t => t.id === parentId);
  const color = (level === 1 && parent)
    ? (parent.color || GANTT_COLORS[0])
    : GANTT_COLORS[scheduleTasks.filter(t=>t.level===0).length % GANTT_COLORS.length];
  const start = todayStr();
  const end   = addDaysStr(start, level === 0 ? 14 : 7);
  const newId = scheduleTaskSeq++;
  scheduleTasks.push({ id:newId, level, parentId, name:'', start, end, person:'', color, collapsed:false });
  scheduleDirty = true;
  editingTaskId = newId;
  renderGantt();
}

function schAddNextSubTask(currentId) {
  const t = scheduleTasks.find(t => t.id === currentId);
  if (!t) return;
  // Create sibling: same parent (or 大工程 if this is already major)
  const parentId = t.level === 1 ? t.parentId : t.id;
  const level    = t.level === 1 ? 1 : 1;
  schAddTask(level, parentId);
}

function schRemoveTask(id) {
  scheduleTasks = scheduleTasks.filter(t => t.id !== id && t.parentId !== id);
  if (editingTaskId === id) editingTaskId = null;
  scheduleDirty = true;
  renderGantt();
}

function schUpdateTask(id, field, val) {
  const t = scheduleTasks.find(t => t.id === id);
  if (!t) return;
  t[field] = val;
  scheduleDirty = true;
}

function schUpdateTaskEdit(id, field, val) {
  const t = scheduleTasks.find(t => t.id === id);
  if (!t) return;
  t[field] = val;
  scheduleDirty = true;

  if (field === 'start' || field === 'end') {
    if (t.parentId) _syncParentDates(t.parentId);
    renderGantt();
  } else if (field === 'color') {
    // 大工程の色変更 → 小工程にも伝播
    if (t.level === 0) {
      scheduleTasks.filter(c => c.parentId === t.id).forEach(c => { c.color = val; });
    }
    renderGantt();
  } else {
    // Just update the name label in the compact row and edit sheet header
    const nameEl = document.getElementById('grl-name-' + id);
    if (nameEl) nameEl.textContent = val || '（工程名未入力）';
    const hdrEl  = document.querySelector('.tes-title');
    if (hdrEl)  hdrEl.textContent  = val || '（工程名未入力）';
  }
}

function schToggleCollapse(id) {
  const t = scheduleTasks.find(t => t.id === id);
  if (t) { t.collapsed = !t.collapsed; renderGantt(); }
}

// ─ Bar drag ─
function onBarDragStart(e, taskId, type) {
  if (e.touches === undefined && e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const task = scheduleTasks.find(t => t.id === taskId);
  if (!task) return;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  _drag = { type, taskId, startX: clientX, origStart: task.start, origEnd: task.end, moved: false };

  if (e.touches) {
    document.addEventListener('touchmove', _onDragMove, { passive: false });
    document.addEventListener('touchend',  _onDragEnd);
  } else {
    document.addEventListener('mousemove', _onDragMove);
    document.addEventListener('mouseup',   _onDragEnd);
  }
}

function _onDragMove(e) {
  if (!_drag) return;
  if (e.cancelable) e.preventDefault();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const dx = clientX - _drag.startX;
  if (Math.abs(dx) >= GANTT_CELL_W * 0.4) _drag.moved = true;
  if (!_drag.moved) return;

  const delta = Math.round(dx / GANTT_CELL_W);
  const task  = scheduleTasks.find(t => t.id === _drag.taskId);
  if (!task) return;

  if (_drag.type === 'move') {
    task.start = addDaysStr(_drag.origStart, delta);
    task.end   = addDaysStr(_drag.origEnd,   delta);
  } else if (_drag.type === 'resize-start') {
    const s = addDaysStr(_drag.origStart, delta);
    if (s <= task.end) task.start = s;
  } else {
    const e2 = addDaysStr(_drag.origEnd, delta);
    if (e2 >= task.start) task.end = e2;
  }
  _updateBarVisual(_drag.taskId);
  // 小工程ドラッグ中 → 親バーもリアルタイム更新
  const draggingTask = scheduleTasks.find(t => t.id === _drag.taskId);
  if (draggingTask?.parentId) {
    _syncParentDates(draggingTask.parentId);
    _updateBarVisual(draggingTask.parentId);
  }
}

function _onDragEnd(e) {
  const isTouch = e.touches !== undefined || e.type === 'touchend';
  document.removeEventListener('mousemove', _onDragMove);
  document.removeEventListener('mouseup',   _onDragEnd);
  document.removeEventListener('touchmove', _onDragMove);
  document.removeEventListener('touchend',  _onDragEnd);

  if (!_drag) return;
  const { taskId, moved } = _drag;
  _drag = null;

  if (!moved) {
    openTaskEdit(taskId); // treat as click
  } else {
    // ドラッグ確定後に親日付を同期してから再描画
    const movedTask = scheduleTasks.find(t => t.id === taskId);
    if (movedTask?.parentId) _syncParentDates(movedTask.parentId);
    scheduleDirty = true;
    renderGantt();
  }
}

// Live visual update during drag (no DOM rebuild)
function _updateBarVisual(taskId) {
  const task = scheduleTasks.find(t => t.id === taskId);
  if (!task || !ganttD0str) return;

  const startOff = diffDays(ganttD0str, task.start);
  const endOff   = diffDays(ganttD0str, task.end);
  const barL = startOff * GANTT_CELL_W;
  const barW = Math.max(GANTT_CELL_W, (endOff - startOff + 1) * GANTT_CELL_W);
  const dur  = diffDays(task.start, task.end) + 1;

  const bar = document.getElementById('gantt-bar-' + taskId);
  if (bar) { bar.style.left = barL + 'px'; bar.style.width = barW + 'px'; }

  const daysEl = document.getElementById('grl-days-' + taskId);
  if (daysEl) daysEl.textContent = dur + '日';

  // Update edit sheet if this task is open
  if (editingTaskId === taskId) {
    const sEl   = document.getElementById('tes-start');
    const eEl   = document.getElementById('tes-end');
    const durEl = document.getElementById('tes-dur-lbl');
    if (sEl)   sEl.value       = task.start;
    if (eEl)   eEl.value       = task.end;
    if (durEl) durEl.textContent = dur + '日';
  }
}

// ─ Edit panel ─
function openTaskEdit(id) {
  editingTaskId = id;
  _renderEditSheet();
  document.querySelectorAll('.gantt-row-left').forEach(r =>
    r.classList.toggle('tes-active-row', r.id === 'grl-' + id)
  );
  // Also highlight bar ring
  document.querySelectorAll('.gantt-bar').forEach(b => {
    const isActive = b.id === 'gantt-bar-' + id;
    b.classList.toggle('gantt-bar-selected', isActive);
  });
}

function closeTaskEdit() {
  editingTaskId = null;
  const sheet = document.getElementById('task-edit-sheet');
  if (sheet) sheet.style.display = 'none';
  document.querySelectorAll('.gantt-row-left').forEach(r => r.classList.remove('tes-active-row'));
  document.querySelectorAll('.gantt-bar').forEach(b => b.classList.remove('gantt-bar-selected'));
}

function _renderEditSheet() {
  const sheet = document.getElementById('task-edit-sheet');
  if (!sheet) return;
  const t = scheduleTasks.find(t => t.id === editingTaskId);
  if (!t) { closeTaskEdit(); return; }

  const isMaj = t.level === 0;
  const dur   = t.start && t.end ? diffDays(t.start, t.end) + 1 : '?';

  sheet.innerHTML = `
    <div class="tes-row">
      <span class="gantt-badge ${isMaj ? 'gantt-badge-maj' : 'gantt-badge-min'}">${isMaj ? '大' : '小'}</span>
      <span class="tes-title">${esc(t.name) || '（工程名未入力）'}</span>
      <button class="tes-close-btn" onclick="closeTaskEdit()" title="閉じる">×</button>
    </div>
    <div class="tes-fields">
      <div class="tes-field tes-name-field">
        <label>工程名</label>
        <input type="text" value="${esc(t.name)}" placeholder="${isMaj ? '大工程名' : '小工程名'}"
          oninput="schUpdateTaskEdit(${t.id},'name',this.value)">
      </div>
      <div class="tes-field">
        <label>担当者</label>
        <input type="text" value="${esc(t.person)}" placeholder="担当者名"
          oninput="schUpdateTaskEdit(${t.id},'person',this.value)">
      </div>
      ${isMaj ? `<div class="tes-field">
        <label>色</label>
        <input type="color" value="${t.color || '#3b82f6'}"
          oninput="schUpdateTaskEdit(${t.id},'color',this.value)">
      </div>` : ''}
      <div class="tes-field">
        <label>開始日</label>
        <input type="date" id="tes-start" value="${t.start || ''}"
          onchange="schUpdateTaskEdit(${t.id},'start',this.value)">
      </div>
      <div class="tes-field">
        <label>終了日</label>
        <input type="date" id="tes-end" value="${t.end || ''}"
          onchange="schUpdateTaskEdit(${t.id},'end',this.value)">
      </div>
      <div class="tes-field tes-dur-field">
        <label>日数</label>
        <span id="tes-dur-lbl" class="tes-dur">${dur}日</span>
      </div>
      <div class="tes-field tes-actions">
        ${isMaj
          ? `<button class="btn xs" onclick="schAddTask(1,${t.id})">＋ 小工程を追加</button>`
          : `<button class="btn xs" onclick="schAddNextSubTask(${t.id})">＋ 次の小工程を追加</button>`
        }
        <button class="btn danger xs" onclick="schRemoveTask(${t.id})">× 削除</button>
      </div>
    </div>
  `;
  sheet.style.display = 'flex';

  // Auto-focus name input
  setTimeout(() => sheet.querySelector('input[type=text]')?.focus(), 30);
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

  scheduleTasks.forEach(t => {
    if (t.start >= fromDate) {
      t.start = addDaysStr(t.start, days * dir);
      t.end   = addDaysStr(t.end,   days * dir);
    }
  });
  scheduleDirty = true;
  document.getElementById('bulk-shift-modal').classList.remove('open');
  renderGantt();
  showToast(`${days}日 ${dir > 0 ? '後ろ' : '前'}にずらしました`);
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
    rows.push([t.level === 0 ? '大工程' : '　小工程', t.name, t.person, t.start, t.end, days]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [10,28,14,12,12,6].map(w=>({wch:w}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '工程表');
  XLSX.writeFile(wb, `工程表_${selectedProject?.name||'工程表'}_${todayStr().replace(/-/g,'')}.xlsx`);
}

let _xlsxPromise = null;
function _loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  if (!_xlsxPromise) {
    _xlsxPromise = new Promise((res,rej) => {
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
  const inner = document.getElementById('gantt-inner');
  if (!inner) return;

  const pName = selectedProject?.name;
  const badge = document.getElementById('sch-proj-name');
  if (badge) badge.textContent = pName || '（案件未選択）';

  if (!pName) {
    inner.innerHTML = `<div class="sch-empty"><p>左サイドバーで案件を選択してください</p></div>`;
    _hideEditSheet(); return;
  }
  if (!scheduleTasks.length) {
    inner.innerHTML = `<div class="sch-empty">
      <p>工程がまだありません</p>
      <button class="btn primary" onclick="schAddTask(0,null)">＋ 大工程を追加</button>
    </div>`;
    _hideEditSheet(); return;
  }

  // Date range
  const allS = scheduleTasks.filter(t=>t.start).map(t=>t.start).sort();
  const allE = scheduleTasks.filter(t=>t.end).map(t=>t.end).sort();
  const minS = allS[0] || todayStr();
  const maxE = allE[allE.length-1] || addDaysStr(todayStr(), 30);

  const d0 = new Date(addDaysStr(minS, -7) + 'T00:00:00');
  const dow = d0.getDay();
  d0.setDate(d0.getDate() - (dow === 0 ? 6 : dow - 1));
  ganttD0str = d0.toISOString().slice(0, 10);
  const totalDays = diffDays(ganttD0str, addDaysStr(maxE, 21)) + 1;
  const W = totalDays * GANTT_CELL_W;
  const todayS = todayStr();

  // Month header
  const months = [];
  const cur = new Date(d0);
  for (let i = 0; i < totalDays; i++) {
    const ym = `${cur.getFullYear()}年${cur.getMonth()+1}月`;
    if (!months.length || months[months.length-1].label !== ym) months.push({label:ym,count:0});
    months[months.length-1].count++;
    cur.setDate(cur.getDate()+1);
  }
  const monthRow = months.map(m=>
    `<div class="gantt-month-cell" style="width:${m.count*GANTT_CELL_W}px">${m.label}</div>`
  ).join('');

  // Day & weekday rows
  const c2 = new Date(d0);
  let dayRow='', wdRow='';
  for (let i=0; i<totalDays; i++) {
    const wd=c2.getDay(), isWE=wd===0||wd===6, isTD=c2.toISOString().slice(0,10)===todayS;
    const cls=isTD?'gantt-td':isWE?'gantt-we':'';
    dayRow += `<div class="gantt-day-cell ${cls}" style="width:${GANTT_CELL_W}px">${c2.getDate()}</div>`;
    wdRow  += `<div class="gantt-wd-cell ${cls}" style="width:${GANTT_CELL_W}px">${['日','月','火','水','木','金','土'][wd]}</div>`;
    c2.setDate(c2.getDate()+1);
  }

  // Weekend stripes
  const c3 = new Date(d0);
  let stripes='';
  for (let i=0; i<totalDays; i++) {
    if (c3.getDay()===0||c3.getDay()===6)
      stripes += `<div class="gantt-we-stripe" style="left:${i*GANTT_CELL_W}px;width:${GANTT_CELL_W}px"></div>`;
    c3.setDate(c3.getDate()+1);
  }

  // Today line
  const todayOff = diffDays(ganttD0str, todayS);
  const todayLine = (todayOff>=0&&todayOff<totalDays)
    ? `<div class="gantt-today-line" style="left:${todayOff*GANTT_CELL_W+Math.floor(GANTT_CELL_W/2)}px"></div>` : '';

  // Visible tasks
  const collapsedIds = new Set(scheduleTasks.filter(t=>t.level===0&&t.collapsed).map(t=>t.id));
  const visible = scheduleTasks.filter(t=>t.level===0||!collapsedIds.has(t.parentId));

  let leftRows='', rightRows='';

  visible.forEach(task => {
    const isMaj   = task.level === 0;
    const hasKids = scheduleTasks.some(t => t.parentId === task.id);
    const dur     = task.start && task.end ? diffDays(task.start, task.end) + 1 : '?';
    const isActive = editingTaskId === task.id;

    const toggleBtn = (isMaj && hasKids)
      ? `<button class="gantt-toggle-btn" onclick="event.stopPropagation();schToggleCollapse(${task.id})">${task.collapsed?'▸':'▾'}</button>`
      : `<span style="display:inline-block;width:14px"></span>`;

    const badge = isMaj
      ? `<span class="gantt-badge gantt-badge-maj">大</span>`
      : `<span class="gantt-badge gantt-badge-min" style="margin-left:6px">小</span>`;

    leftRows += `<div class="gantt-row gantt-row-left ${isMaj?'gantt-row-major':'gantt-row-minor'} ${isActive?'tes-active-row':''}"
      id="grl-${task.id}" onclick="openTaskEdit(${task.id})">
      <span class="gantt-drag-hdl">⠿</span>
      ${toggleBtn}${badge}
      <span class="grl-color-dot" style="background:${_getTaskColor(task)}"></span>
      <span class="grl-name" id="grl-name-${task.id}">${esc(task.name)||'（工程名未入力）'}</span>
      <span class="grl-days" id="grl-days-${task.id}">${dur}日</span>
    </div>`;

    // Bar
    const startOff = task.start ? diffDays(ganttD0str, task.start) : 0;
    const endOff   = task.end   ? diffDays(ganttD0str, task.end)   : 0;
    const barL = startOff * GANTT_CELL_W;
    const barW = Math.max(GANTT_CELL_W, (endOff - startOff + 1) * GANTT_CELL_W);
    const barCls = isMaj ? 'gantt-bar-major' : 'gantt-bar-minor';
    const selCls = isActive ? 'gantt-bar-selected' : '';

    const barHtml = task.start && task.end
      ? `<div class="gantt-bar ${barCls} ${selCls}" id="gantt-bar-${task.id}"
           style="left:${barL}px;width:${barW}px;background:${_getTaskColor(task)}"
           onmousedown="onBarDragStart(event,${task.id},'move')"
           ontouchstart="onBarDragStart(event,${task.id},'move')">
           <div class="gantt-bar-hdl gantt-bar-hdl-l"
             onmousedown="event.stopPropagation();onBarDragStart(event,${task.id},'resize-start')"
             ontouchstart="event.stopPropagation();onBarDragStart(event,${task.id},'resize-start')"></div>
           <span class="gantt-bar-text">${esc(task.name)}</span>
           <div class="gantt-bar-hdl gantt-bar-hdl-r"
             onmousedown="event.stopPropagation();onBarDragStart(event,${task.id},'resize-end')"
             ontouchstart="event.stopPropagation();onBarDragStart(event,${task.id},'resize-end')"></div>
         </div>`
      : '';

    rightRows += `<div class="gantt-row gantt-row-right ${isActive?'tes-active-bg':''}" style="width:${W}px">
      ${stripes}${todayLine}${barHtml}
    </div>`;
  });

  inner.innerHTML = `
    <div class="gantt-container">
      <div class="gantt-left-panel">
        <div class="gantt-head-left">
          <div class="gantt-head-left-inner">
            <span style="width:14px"></span><span style="width:14px"></span>
            <span style="width:17px"></span><span style="width:10px"></span>
            <span class="glh-name" style="flex:1">工程名</span>
            <span style="width:32px;text-align:right;font-size:10px">日数</span>
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

  // Sync scroll
  const bodyL = document.getElementById('gantt-body-left');
  const bodyR = document.getElementById('gantt-body-right');
  const headR = document.getElementById('gantt-head-right');
  bodyR.addEventListener('scroll', ()=>{
    ganttScrollLeft = bodyR.scrollLeft;
    if(headR) headR.scrollLeft=bodyR.scrollLeft;
    if(bodyL) bodyL.scrollTop=bodyR.scrollTop;
  });
  bodyL.addEventListener('scroll', ()=>{ if(bodyR) bodyR.scrollTop=bodyL.scrollTop; });

  // 初回のみ今日へスクロール。以降は前回位置を維持
  if (ganttScrollLeft >= 0) {
    bodyR.scrollLeft = ganttScrollLeft;
  } else if (todayOff > 5) {
    bodyR.scrollLeft = Math.max(0, (todayOff - 5) * GANTT_CELL_W);
  }

  // Restore edit sheet if a task was being edited
  if (editingTaskId && scheduleTasks.find(t => t.id === editingTaskId)) {
    _renderEditSheet();
  } else {
    _hideEditSheet();
  }
}

function _hideEditSheet() {
  const sheet = document.getElementById('task-edit-sheet');
  if (sheet) sheet.style.display = 'none';
}
