// ════ 定型タスク（工事区分ごとの決まったやること）と工程表との連動 ════
//
// 「新築ならこれをやる」というタスクを登録しておき、案件にまとめて取り込む。
// 期限は工程表の節目（着工日・上棟日など）や工程の日付から「◯日前」で決める。
// 工程表を直して保存すると、取り込んだタスクの期限も付いて動く。
//
//   基準（anchorKind）
//     milestone … 工程表の節目の日付
//     schedule  … 工程表の工程名で探して、その開始日または完了日
//     none      … 基準なし（期限は空。手で入れる）

let taskTemplates = [];
let taskTemplatesReady = true;
let ttWorkType = '';          // 編集画面で選んでいる工事区分
let editingTemplateId = null;

// 工程表の節目（js/schedule.js の MILESTONE_LABELS と同じもの）
function ttMilestoneLabels(){
  return (typeof MILESTONE_LABELS!=='undefined') ? MILESTONE_LABELS
    : ['契約日','確認済証発行日','着工日','配筋検査日','上棟日','中間検査日','木完日','完了検査日','社内検査日','見学会','引渡日'];
}
// 工事区分の一覧（見積の区分をそのまま使う）
function ttWorkTypes(){
  const fromEst = (typeof estimateTypes!=='undefined' ? estimateTypes : []).map(t=>t.name).filter(Boolean);
  const fromTpl = taskTemplates.map(t=>t.workType);
  return [...new Set([...fromEst, ...fromTpl])];
}

async function fetchTaskTemplates(){
  const { data, error } = await sb.from('task_templates').select('*')
    .order('work_type').order('sort_order').order('id');
  taskTemplatesReady = !error;
  taskTemplates = (data||[]).map(r=>({
    id:r.id, workType:r.work_type||'', title:r.title||'', detail:r.detail||'',
    checklist:r.checklist||[], assignees:r.assignees||[],
    anchorKind:r.anchor_kind||'none', anchorName:r.anchor_name||'',
    anchorPoint:r.anchor_point||'start', offsetDays:Number(r.offset_days)||0,
    sortOrder:Number(r.sort_order)||0
  }));
}

// ── 期限の計算 ──
// sched: {tasks:[{name,start,end}], milestones:{ラベル:日付}}
function ttBaseDate(anchor, sched){
  if(!sched) return '';
  if(anchor.anchorKind==='milestone') return (sched.milestones||{})[anchor.anchorName] || '';
  if(anchor.anchorKind==='schedule'){
    const t=(sched.tasks||[]).find(x=>(x.name||'').trim()===(anchor.anchorName||'').trim());
    if(!t) return '';
    return (anchor.anchorPoint==='end' ? t.end : t.start) || '';
  }
  return '';
}
function ttAddDays(dateStr, n){
  if(!dateStr) return '';
  const d=new Date(dateStr+'T00:00:00');
  if(isNaN(d)) return '';
  d.setDate(d.getDate()+(Number(n)||0));
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
// 基準日が決まらなければ空（期限なし）にする
function ttDueDate(anchor, sched){
  const base=ttBaseDate(anchor, sched);
  return base ? ttAddDays(base, anchor.offsetDays) : '';
}
// 「着工日の7日前」のような説明文
function ttAnchorLabel(a){
  if(a.anchorKind==='none') return '期限なし';
  const name = a.anchorName || '（未設定）';
  const where = a.anchorKind==='schedule' ? `${name}の${a.anchorPoint==='end'?'完了日':'開始日'}` : name;
  const n = Number(a.offsetDays)||0;
  return n===0 ? `${where}` : n<0 ? `${where}の${-n}日前` : `${where}の${n}日後`;
}

// ── 定型タスクの一覧（管理者のみ） ──
function openTaskTemplates(){
  if(currentUserRole!=='staff'){ showToast('定型タスクを触れるのは管理者だけです'); return; }
  const types=ttWorkTypes();
  if(!ttWorkType || !types.includes(ttWorkType)) ttWorkType = types[0]||'新築';
  renderTaskTemplates();
  document.getElementById('tt-modal').classList.add('open');
}
function closeTaskTemplates(){ document.getElementById('tt-modal').classList.remove('open'); }
function setTtWorkType(v){ ttWorkType=v; renderTaskTemplates(); }

function renderTaskTemplates(){
  const sel=document.getElementById('tt-type');
  if(sel){
    const types=ttWorkTypes();
    sel.innerHTML=types.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');
    sel.value=ttWorkType;
  }
  const wrap=document.getElementById('tt-list');
  if(!wrap) return;
  if(!taskTemplatesReady){
    wrap.innerHTML='<div class="empty">定型タスクの準備ができていません。管理者にお問い合わせください</div>';
    return;
  }
  const list=taskTemplates.filter(t=>t.workType===ttWorkType);
  if(!list.length){
    wrap.innerHTML='<div class="empty">この工事区分の定型タスクはまだありません</div>';
    return;
  }
  wrap.innerHTML=list.map(t=>`
    <div class="task-row" style="cursor:pointer" onclick="openTemplateEdit(${t.id})">
      <div class="task-main">
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-meta">
          <span class="task-due ${t.anchorKind==='none'?'none':''}">${esc(ttAnchorLabel(t))}</span>
          ${t.checklist.length?`<span class="task-cl">${t.checklist.length}項目</span>`:''}
          ${t.assignees.length?`<span class="task-asg">${t.assignees.map(esc).join('、')}</span>`:''}
        </div>
      </div>
    </div>`).join('');
}

// ── 定型タスクの追加・編集 ──
let ttChecklist = [];
let ttAssignees = [];

function openTemplateNew(){
  editingTemplateId=null;
  ttChecklist=[]; ttAssignees=[];
  document.getElementById('tt-edit-title').textContent='定型タスクを追加';
  document.getElementById('tte-title').value='';
  document.getElementById('tte-detail').value='';
  document.getElementById('tte-anchor-kind').value='milestone';
  document.getElementById('tte-offset').value='0';
  document.getElementById('tte-point').value='start';
  ttAnchorKindChanged();
  renderTtChecklist(); renderTtAssignees();
  document.getElementById('tt-delete-btn').style.display='none';
  document.getElementById('tt-edit-modal').classList.add('open');
}
function openTemplateEdit(id){
  const t=taskTemplates.find(x=>x.id===id);
  if(!t) return;
  editingTemplateId=id;
  ttChecklist=(t.checklist||[]).map(c=>({...c}));
  ttAssignees=[...(t.assignees||[])];
  document.getElementById('tt-edit-title').textContent='定型タスクを直す';
  document.getElementById('tte-title').value=t.title;
  document.getElementById('tte-detail').value=t.detail;
  document.getElementById('tte-anchor-kind').value=t.anchorKind;
  document.getElementById('tte-offset').value=String(t.offsetDays);
  document.getElementById('tte-point').value=t.anchorPoint;
  ttAnchorKindChanged();
  if(t.anchorKind==='milestone') document.getElementById('tte-milestone').value=t.anchorName;
  if(t.anchorKind==='schedule')  document.getElementById('tte-schedule-name').value=t.anchorName;
  renderTtChecklist(); renderTtAssignees();
  document.getElementById('tt-delete-btn').style.display='';
  document.getElementById('tt-edit-modal').classList.add('open');
}
function closeTemplateEdit(){ document.getElementById('tt-edit-modal').classList.remove('open'); }

// 基準の種類を変えたら、入力欄を出し分ける
function ttAnchorKindChanged(){
  const k=document.getElementById('tte-anchor-kind').value;
  const ms=document.getElementById('tte-milestone-wrap');
  const sc=document.getElementById('tte-schedule-wrap');
  const off=document.getElementById('tte-offset-wrap');
  if(ms) ms.style.display = k==='milestone' ? '' : 'none';
  if(sc) sc.style.display = k==='schedule' ? '' : 'none';
  if(off) off.style.display = k==='none' ? 'none' : '';
  const sel=document.getElementById('tte-milestone');
  if(sel && !sel.options.length){
    sel.innerHTML=ttMilestoneLabels().map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('');
  }
}

function renderTtChecklist(){
  const el=document.getElementById('tte-checklist');
  if(!el) return;
  el.innerHTML = ttChecklist.map((c,i)=>`
    <div class="task-cl-row">
      <span style="flex:1;min-width:0">${esc(c.text)}</span>
      <button type="button" class="btn xs" onclick="removeTtClItem(${i})">削除</button>
    </div>`).join('') || '<div style="font-size:11px;color:var(--text-muted)">項目なし</div>';
}
function addTtClItem(){
  const el=document.getElementById('tte-cl-input');
  const text=(el?.value||'').trim();
  if(!text) return;
  ttChecklist.push({id:Date.now()+Math.floor(Math.random()*1000), text, done:false});
  el.value=''; renderTtChecklist();
}
function removeTtClItem(i){ ttChecklist.splice(i,1); renderTtChecklist(); }

function renderTtAssignees(){
  const el=document.getElementById('tte-assignees');
  if(!el) return;
  el.innerHTML = ttAssignees.length
    ? ttAssignees.map(n=>`<span class="member-tag">${esc(n)}<button type="button" onclick="removeTtAssignee(${jsArg(n)})" style="margin-left:4px;border:0;background:none;color:inherit;cursor:pointer;padding:0">×</button></span>`).join('')
    : '<span style="color:var(--text-muted);font-size:11px">取り込むときに決める</span>';
}
function removeTtAssignee(name){
  const i=ttAssignees.indexOf(name);
  if(i>=0) ttAssignees.splice(i,1);
  renderTtAssignees();
}
function openTtAssigneePicker(){
  const el=document.getElementById('tt-assignee-picker');
  if(!el) return;
  const cands=(typeof _memberCandidates==='function') ? _memberCandidates() : [];
  let html='', lastKind='';
  cands.forEach(m=>{
    if(m.kind!==lastKind){ html+=`<div class="section-lbl" style="margin:10px 0 4px">${m.kind}</div>`; lastKind=m.kind; }
    const on=ttAssignees.includes(m.name);
    html+=`<button type="button" class="member-row${on?' on':''}" onclick="toggleTtAssignee(${jsArg(m.name)})">
      <span class="member-check">${on?'✓':''}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.name)}${m.supplierName?`<span style="font-size:11px;color:var(--text-muted)">（${esc(m.supplierName)}）</span>`:''}</span>
    </button>`;
  });
  el.innerHTML = html || '<div style="font-size:12px;color:var(--text-muted);padding:10px">候補がありません</div>';
  document.getElementById('tt-assignee-modal').classList.add('open');
}
function closeTtAssigneePicker(){
  document.getElementById('tt-assignee-modal').classList.remove('open');
  renderTtAssignees();
}
function toggleTtAssignee(name){
  const i=ttAssignees.indexOf(name);
  if(i>=0) ttAssignees.splice(i,1); else ttAssignees.push(name);
  openTtAssigneePicker();
}

async function saveTemplate(){
  const title=document.getElementById('tte-title').value.trim();
  if(!title){ showToast('やることを入力してください'); return; }
  const kind=document.getElementById('tte-anchor-kind').value;
  let anchorName='';
  if(kind==='milestone') anchorName=document.getElementById('tte-milestone').value||'';
  if(kind==='schedule'){
    anchorName=document.getElementById('tte-schedule-name').value.trim();
    if(!anchorName){ showToast('工程の名前を入力してください'); return; }
  }
  const row={
    work_type: ttWorkType,
    title,
    detail: document.getElementById('tte-detail').value.trim(),
    checklist: ttChecklist,
    assignees: ttAssignees,
    anchor_kind: kind,
    anchor_name: anchorName,
    anchor_point: document.getElementById('tte-point').value||'start',
    offset_days: Number(document.getElementById('tte-offset').value)||0,
    sort_order: editingTemplateId
      ? (taskTemplates.find(t=>t.id===editingTemplateId)?.sortOrder||0)
      : (taskTemplates.filter(t=>t.workType===ttWorkType).length+1)*10
  };
  const q = editingTemplateId
    ? sb.from('task_templates').update(row).eq('id',editingTemplateId)
    : sb.from('task_templates').insert(row);
  const { error } = await q;
  if(error){ showToast('保存に失敗しました：'+error.message); return; }
  closeTemplateEdit();
  await refreshTaskTemplates();
  showToast(editingTemplateId?'保存しました':'定型タスクを追加しました');
}

async function deleteTemplate(){
  if(!editingTemplateId) return;
  if(!confirm('この定型タスクを消します。すでに取り込んだタスクは残ります。よろしいですか？')) return;
  const { error } = await sb.from('task_templates').delete().eq('id',editingTemplateId);
  if(error){ showToast('削除に失敗しました：'+error.message); return; }
  closeTemplateEdit();
  await refreshTaskTemplates();
  showToast('定型タスクを消しました');
}

async function refreshTaskTemplates(){
  try{ await fetchTaskTemplates(); }catch(_){ return; }
  if(document.getElementById('tt-modal')?.classList.contains('open')) renderTaskTemplates();
}

// ════ 案件への取り込み ════

let ttApplyProjectId = null;
let ttApplySched = null;      // 取り込み先の案件の工程表
let ttApplyPick = [];         // 取り込むテンプレートのID

async function openTaskApply(){
  if(currentUserRole==='supplier'){ return; }
  const sel=document.getElementById('ta-project');
  const list=(projects||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'ja'));
  sel.innerHTML='<option value="">案件を選択...</option>'
    + list.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  sel.value = ttApplyProjectId ? String(ttApplyProjectId) : '';
  ttApplyPick=[];
  document.getElementById('ta-list').innerHTML=
    '<div class="empty">案件を選ぶと、取り込む内容と期限が出ます</div>';
  document.getElementById('ta-note').textContent='';
  document.getElementById('tt-apply-modal').classList.add('open');
  if(sel.value) await taApplyProjectChanged(sel.value);
}
function closeTaskApply(){ document.getElementById('tt-apply-modal').classList.remove('open'); }

// 案件を選んだら、その案件の工程表を読んで期限を計算する
async function taApplyProjectChanged(v){
  ttApplyProjectId = Number(v)||null;
  ttApplySched = null;
  const wrap=document.getElementById('ta-list');
  const note=document.getElementById('ta-note');
  if(!ttApplyProjectId){ wrap.innerHTML='<div class="empty">案件を選ぶと、取り込む内容と期限が出ます</div>'; note.textContent=''; return; }

  const proj=(projects||[]).find(p=>p.id===ttApplyProjectId);
  wrap.innerHTML='<div class="empty">読み込んでいます…</div>';
  const { data } = await sb.from('schedules').select('tasks, milestones')
    .eq('project_name', proj?.name||'').maybeSingle();
  ttApplySched = data ? {tasks:data.tasks||[], milestones:data.milestones||{}} : null;

  // 案件の工事区分に合う定型タスクを出す
  ttWorkType = proj?.type || ttWorkType || '新築';
  const list=taskTemplates.filter(t=>t.workType===ttWorkType);
  ttApplyPick=list.map(t=>t.id);   // はじめは全部にチェックを入れておく

  note.innerHTML = `工事区分「${esc(ttWorkType)}」の定型タスク ${list.length}件`
    + (ttApplySched ? '' : '　<span style="color:var(--warn-t)">※この案件の工程表がまだありません。期限は空のまま取り込みます</span>');
  renderTaskApplyList();
}

function renderTaskApplyList(){
  const wrap=document.getElementById('ta-list');
  const list=taskTemplates.filter(t=>t.workType===ttWorkType);
  if(!list.length){
    wrap.innerHTML=`<div class="empty">工事区分「${esc(ttWorkType)}」の定型タスクがありません</div>`;
    return;
  }
  const proj=(projects||[]).find(p=>p.id===ttApplyProjectId);
  wrap.innerHTML=list.map(t=>{
    const due=ttDueDate(t, ttApplySched);
    const dup=(tasks||[]).some(x=>x.projectId===ttApplyProjectId && x.templateId===t.id);
    const on=ttApplyPick.includes(t.id);
    return `
    <button type="button" class="member-row${on?' on':''}" onclick="toggleTaskApply(${t.id})" style="align-items:flex-start">
      <span class="member-check" style="margin-top:2px">${on?'✓':''}</span>
      <span style="flex:1;min-width:0">
        <span style="display:block;font-size:12px;font-weight:600">${esc(t.title)}${dup?'<span class="task-file-cnt" style="margin-left:5px">取り込み済み</span>':''}</span>
        <span style="display:block;font-size:10px;color:var(--text-muted)">${esc(ttAnchorLabel(t))}　→　${due?`期限 ${due.replace(/-/g,'/')}`:'期限なし'}</span>
      </span>
    </button>`;
  }).join('');
}
function toggleTaskApply(id){
  const i=ttApplyPick.indexOf(id);
  if(i>=0) ttApplyPick.splice(i,1); else ttApplyPick.push(id);
  renderTaskApplyList();
}

async function doTaskApply(){
  if(!ttApplyProjectId){ showToast('案件を選んでください'); return; }
  const list=taskTemplates.filter(t=>t.workType===ttWorkType && ttApplyPick.includes(t.id));
  if(!list.length){ showToast('取り込むタスクを選んでください'); return; }

  const rows=list.map(t=>{
    const due=ttDueDate(t, ttApplySched);
    return {
      title:t.title, detail:t.detail, project_id:ttApplyProjectId,
      assignees:t.assignees, due_date:due||null, checklist:t.checklist,
      created_by:currentUserDisplayName||'',
      template_id:t.id, anchor_kind:t.anchorKind, anchor_name:t.anchorName,
      anchor_point:t.anchorPoint, offset_days:t.offsetDays,
      auto_due: t.anchorKind!=='none'
    };
  });
  const { error } = await sb.from('tasks').insert(rows);
  if(error){ showToast('取り込みに失敗しました：'+error.message); return; }

  // 担当者が決まっているものは、その人に知らせる
  const proj=(projects||[]).find(p=>p.id===ttApplyProjectId);
  const mine=myMemberNames();
  const byName={};
  rows.forEach(r=>(r.assignees||[]).forEach(n=>{
    if(mine.includes(n)) return;
    (byName[n]=byName[n]||[]).push(r.title);
  }));
  Object.keys(byName).forEach(n=>{
    const t=byName[n];
    dbSendPushToNames([n], `タスクが${t.length}件割り当てられました`,
      `${proj?.name||''}：${t.slice(0,3).join('／')}${t.length>3?` ほか${t.length-3}件`:''}`, 'task').catch(()=>{});
  });

  closeTaskApply();
  await refreshTasks();
  showToast(`${rows.length}件のタスクを取り込みました`);
}

// ════ 工程表との連動（工程表を保存したら期限を計算し直す） ════
//
// 期限が動いたタスクだけを直し、担当者にまとめて知らせる。
// 済んだタスクと、期限を工程表に合わせない設定のタスクは触らない。
async function syncTaskDuesForProject(projectName, sched){
  const proj=(projects||[]).find(p=>p.name===projectName);
  if(!proj) return;
  const targets=(tasks||[]).filter(t=>t.projectId===proj.id && t.autoDue && t.status!=='done');
  if(!targets.length) return;

  const changed=[];
  for(const t of targets){
    const due=ttDueDate({anchorKind:t.anchorKind, anchorName:t.anchorName,
                         anchorPoint:t.anchorPoint, offsetDays:t.offsetDays}, sched);
    const next=due||null;
    if((t.dueDate||null)===next) continue;
    const { error } = await sb.from('tasks').update({due_date:next}).eq('id',t.id);
    if(error){ console.warn('期限の更新に失敗しました', error); continue; }
    changed.push({title:t.title, before:t.dueDate, after:due, assignees:t.assignees||[]});
    t.dueDate = due||'';
  }
  if(!changed.length) return;

  // 担当者ごとにまとめて知らせる（自分あては送らない）
  const mine=myMemberNames();
  const byName={};
  changed.forEach(c=>c.assignees.forEach(n=>{
    if(mine.includes(n)) return;
    (byName[n]=byName[n]||[]).push(`${c.title}（${c.after?c.after.replace(/-/g,'/'):'期限なし'}）`);
  }));
  Object.keys(byName).forEach(n=>{
    const l=byName[n];
    dbSendPushToNames([n], 'タスクの期限が変わりました',
      `${projectName}：${l.slice(0,3).join('／')}${l.length>3?` ほか${l.length-3}件`:''}`, 'task').catch(()=>{});
  });

  updateTaskBadge();
  if(document.getElementById('page-task')?.classList.contains('active')) renderTaskPage();
  showToast(`工程表に合わせて ${changed.length}件のタスクの期限を直しました`);
}
