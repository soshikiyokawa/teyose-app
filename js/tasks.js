// ════ タスク管理（やること・担当者・期限・チェックリスト） ════
//
//   ・担当者は表示名の配列。案件の参加メンバーと同じ考え方で、発注先は会社名でもよい
//     （会社名で入れておけば、その会社のアカウント全員が自分あてとして見られる）
//   ・案件に紐づけないタスク（社内のこと）も作れる
//   ・見えるのは、社員は全件／発注先は自分あてのぶんだけ（RLSで絞られる）
//   ・発注先が直せるのは「済／未済」とチェックリストだけ（DB側のトリガーで止めている）
//   ・期限が今日・明日のタスクは毎朝7時に通知が届く（task-remind）

let tasks = [];
let tasksReady = true;
let taskFilter = 'mine';          // mine＝自分あて / open＝未済すべて / done＝済み / all＝すべて
let taskProjectFilter = '';       // 案件名で絞る（空＝すべて）
let editingTodoId = null;      // 工程表の editingTaskId と名前がぶつかるので別名にしている
let taskAssignees = [];           // 編集中のタスクの担当者
let taskChecklist = [];           // 編集中のチェックリスト [{id,text,done,by,at}]
let taskHandoffs = [];            // 編集中のタスクの引き継ぎ履歴（読むだけ）
let handoffTo = [];               // 引き継ぎ先に選んだ人
let handoffMode = 'handoff';      // handoff＝引き継ぐ（社員） / return＝引き継ぎ元へ返す（発注先）

async function fetchTasks(){
  const { data, error } = await sb.from('tasks').select('*')
    .order('status').order('due_date',{ascending:true,nullsFirst:false}).order('id',{ascending:false});
  tasksReady = !error;
  tasks = (data||[]).map(r=>({
    id:r.id, title:r.title||'', detail:r.detail||'', projectId:r.project_id||null,
    assignees:r.assignees||[], dueDate:r.due_date||'', status:r.status||'open',
    checklist:r.checklist||[], handoffs:r.handoffs||[], createdBy:r.created_by||'',
    doneAt:r.done_at||null, doneBy:r.done_by||'', createdAt:r.created_at, updatedAt:r.updated_at
  }));
}

function taskProjectName(t){
  return (projects||[]).find(p=>p.id===t.projectId)?.name || '';
}
function isMyTask(t){
  return isMyProjectMember(t.assignees);   // 表示名でも発注先の会社名でも一致する
}
function taskCanEdit(){ return currentUserRole==='staff' || currentUserRole==='carpenter'; }
function taskCanDelete(){ return currentUserRole==='staff'; }

// ── 期限の見え方 ──
function taskToday(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
// 期限までの日数（マイナス＝期限切れ）。期限なしは null
function taskDaysLeft(t){
  if(!t.dueDate) return null;
  const a=new Date(t.dueDate+'T00:00:00'), b=new Date(taskToday()+'T00:00:00');
  return Math.round((a-b)/86400000);
}
function taskDueLabel(t){
  const d=taskDaysLeft(t);
  if(d===null) return {text:'期限なし', cls:'none'};
  const [,mm,dd]=t.dueDate.split('-');
  const md=Number(mm)+'/'+Number(dd);
  if(d<0)  return {text:`${md}（${-d}日超過）`, cls:'over'};
  if(d===0) return {text:`${md}（今日）`, cls:'today'};
  if(d===1) return {text:`${md}（明日）`, cls:'soon'};
  if(d<=7)  return {text:`${md}（あと${d}日）`, cls:'soon'};
  return {text:md, cls:''};
}

// ── 一覧 ──
function visibleTasks(){
  let list = tasks.slice();
  if(taskFilter==='mine')      list = list.filter(t=>t.status==='open' && isMyTask(t));
  else if(taskFilter==='open') list = list.filter(t=>t.status==='open');
  else if(taskFilter==='done') list = list.filter(t=>t.status==='done');
  if(taskProjectFilter) list = list.filter(t=>taskProjectName(t)===taskProjectFilter);
  // 未済を先に、期限が近いものから。期限なしは末尾
  const key = t=>{
    const d=taskDaysLeft(t);
    return [t.status==='done'?1:0, d===null?1:0, d===null?0:d, -t.id];
  };
  return list.sort((a,b)=>{
    const ka=key(a), kb=key(b);
    for(let i=0;i<ka.length;i++){ if(ka[i]!==kb[i]) return ka[i]-kb[i]; }
    return 0;
  });
}

function myOpenTaskCount(){
  return tasks.filter(t=>t.status==='open' && isMyTask(t)).length;
}
// 下のメニューの「タスク」に、自分あての未済の件数を出す
function updateTaskBadge(){
  const el=document.getElementById('nav-task-dot');
  if(!el) return;
  const n=myOpenTaskCount();
  el.textContent = n>99 ? '99+' : (n||'');
  el.style.display = n ? 'flex' : 'none';
}

function renderTaskPage(){
  renderTaskFilters();
  const wrap=document.getElementById('task-list');
  if(!wrap) return;
  if(!tasksReady){
    wrap.innerHTML='<div class="empty">タスクの準備ができていません。管理者にお問い合わせください</div>';
    return;
  }
  const list=visibleTasks();
  const cnt=document.getElementById('task-count');
  if(cnt) cnt.textContent = `${list.length}件`;
  if(!list.length){
    wrap.innerHTML=`<div class="empty">${taskFilter==='mine'?'自分あての未済のタスクはありません':'該当するタスクはありません'}</div>`;
    return;
  }
  wrap.innerHTML=list.map(t=>{
    const due=taskDueLabel(t);
    const pn=taskProjectName(t);
    const done=t.status==='done';
    const cl=t.checklist||[];
    const clDone=cl.filter(c=>c.done).length;
    const mine=isMyTask(t);
    return `
    <div class="task-row${done?' done':''}">
      <button type="button" class="task-check${done?' on':''}" onclick="toggleTaskDone(${t.id})"
        title="${done?'未済に戻す':'済にする'}">${done?'✓':''}</button>
      <div class="task-main" onclick="openTaskEdit(${t.id})">
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-meta">
          <span class="task-due ${due.cls}">${due.text}</span>
          ${pn?`<span class="task-proj">${esc(pn)}</span>`:''}
          ${cl.length?`<span class="task-cl">${clDone}/${cl.length}</span>`:''}
          ${(t.handoffs||[]).length?`<span class="task-ho" title="${esc((t.handoffs||[]).map(h=>(h.from||'')+'→'+((h.to||[]).join('、'))).join(' / '))}">引継${t.handoffs.length>1?t.handoffs.length:''}</span>`:''}
          ${t.assignees.length
            ? `<span class="task-asg${mine?' mine':''}">${t.assignees.map(esc).join('、')}</span>`
            : '<span class="task-asg none">担当者なし</span>'}
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderTaskFilters(){
  const el=document.getElementById('task-filters');
  if(el){
    const opts=[['mine','自分あて'],['open','未済すべて'],['done','済み'],['all','すべて']];
    el.innerHTML=opts.map(([v,l])=>
      `<button type="button" class="sf-btn${taskFilter===v?' active':''}" onclick="setTaskFilter('${v}')">${l}</button>`
    ).join('');
  }
  // 案件で絞る（タスクが付いている案件だけ出す）
  const sel=document.getElementById('task-project-filter');
  if(sel){
    const names=[...new Set(tasks.map(taskProjectName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'));
    sel.innerHTML='<option value="">案件すべて</option>'+names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
    sel.value = names.includes(taskProjectFilter) ? taskProjectFilter : '';
    taskProjectFilter = sel.value;
  }
}
function setTaskFilter(v){ taskFilter=v; renderTaskPage(); }
function setTaskProjectFilter(v){ taskProjectFilter=v; renderTaskPage(); }

// ── 済／未済の切り替え ──
async function toggleTaskDone(id){
  const t=tasks.find(x=>x.id===id);
  if(!t) return;
  const done = t.status!=='done';
  const row = done
    ? {status:'done', done_at:new Date().toISOString(), done_by:currentUserDisplayName||''}
    : {status:'open', done_at:null, done_by:''};
  const { error } = await sb.from('tasks').update(row).eq('id',id);
  if(error){ showToast('更新に失敗しました：'+error.message); return; }
  Object.assign(t, {status:row.status, doneAt:row.done_at, doneBy:row.done_by});
  renderTaskPage(); updateTaskBadge();
  showToast(done?'済にしました':'未済に戻しました');
}

// ── 作る・直す ──
function openTaskNew(){
  if(!taskCanEdit()){ showToast('タスクを作れるのはきよかわの社員だけです'); return; }
  editingTodoId=null;
  taskAssignees=[]; taskChecklist=[]; taskHandoffs=[];
  document.getElementById('task-modal-title').textContent='タスクを追加';
  document.getElementById('task-title').value='';
  document.getElementById('task-detail').value='';
  document.getElementById('task-due').value='';
  renderTaskProjectSelect(null);
  renderTaskAssignees(); renderTaskChecklist();
  // 読み取り専用にしていたら元に戻す
  ['task-title','task-detail','task-due','task-project'].forEach(i=>{
    const el=document.getElementById(i); if(el) el.disabled=false;
  });
  document.getElementById('task-assignee-add').style.display='';
  document.getElementById('task-delete-btn').style.display='none';
  document.getElementById('task-handoff-btn').style.display='none';   // 新しく作るときは引き継げない
  document.getElementById('task-return-btn').style.display='none';
  renderTaskHandoffs();
  document.getElementById('task-modal').classList.add('open');
  setTimeout(()=>document.getElementById('task-title').focus(),100);
}

function openTaskEdit(id){
  const t=tasks.find(x=>x.id===id);
  if(!t) return;
  editingTodoId=id;
  taskAssignees=[...t.assignees];
  taskChecklist=(t.checklist||[]).map(c=>({...c}));
  taskHandoffs=(t.handoffs||[]).map(h=>({...h}));
  document.getElementById('task-modal-title').textContent = taskCanEdit() ? 'タスクを直す' : 'タスク';
  document.getElementById('task-title').value=t.title;
  document.getElementById('task-detail').value=t.detail;
  document.getElementById('task-due').value=t.dueDate;
  renderTaskProjectSelect(t.projectId);
  renderTaskAssignees(); renderTaskChecklist();
  document.getElementById('task-delete-btn').style.display = taskCanDelete() ? '' : 'none';
  // 発注先はチェックリストだけ触れる（他は読むだけ）
  const ro = !taskCanEdit();
  ['task-title','task-detail','task-due','task-project'].forEach(i=>{
    const el=document.getElementById(i); if(el) el.disabled=ro;
  });
  document.getElementById('task-assignee-add').style.display = ro ? 'none' : '';
  // 社員は「引き継ぐ」。発注先は「引き継ぎ元へ返す」だけできる
  const hoBtn=document.getElementById('task-handoff-btn');
  const retBtn=document.getElementById('task-return-btn');
  hoBtn.style.display = (taskCanEdit() && t.status!=='done') ? '' : 'none';
  if(canReturnTask(t)){
    retBtn.style.display='';
    retBtn.textContent=`${taskReturnTarget(t)}さんに返す`;
  } else {
    retBtn.style.display='none';
  }
  renderTaskHandoffs();
  document.getElementById('task-modal').classList.add('open');
}
function closeTaskModal(){ document.getElementById('task-modal').classList.remove('open'); }

function renderTaskProjectSelect(projectId){
  const el=document.getElementById('task-project');
  if(!el) return;
  const list=(projects||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'ja'));
  el.innerHTML='<option value="">（案件に紐づけない）</option>'
    + list.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  el.value = projectId ? String(projectId) : '';
}

// ── 担当者 ──
function renderTaskAssignees(){
  const el=document.getElementById('task-assignees');
  if(!el) return;
  el.innerHTML = taskAssignees.length
    ? taskAssignees.map(n=>`<span class="member-tag">${esc(n)}${taskCanEdit()
        ? `<button type="button" onclick="removeTaskAssignee('${n.replace(/'/g,"\\'")}')" style="margin-left:4px;border:0;background:none;color:inherit;cursor:pointer;padding:0">×</button>` : ''}</span>`).join('')
    : '<span style="color:var(--text-muted);font-size:11px">担当者なし</span>';
}
function removeTaskAssignee(name){
  const i=taskAssignees.indexOf(name);
  if(i>=0) taskAssignees.splice(i,1);
  renderTaskAssignees();
}
// 担当者を選ぶ（案件の参加メンバーを選ぶのと同じ候補を使う）
function openTaskAssigneePicker(){
  const el=document.getElementById('task-assignee-picker');
  if(!el) return;
  const cands = (typeof _memberCandidates==='function') ? _memberCandidates() : [];
  let html='', lastKind='';
  cands.forEach(m=>{
    if(m.kind!==lastKind){ html+=`<div class="section-lbl" style="margin:10px 0 4px">${m.kind}</div>`; lastKind=m.kind; }
    const on=taskAssignees.includes(m.name);
    html+=`<button type="button" class="member-row${on?' on':''}" onclick="toggleTaskAssignee('${m.name.replace(/'/g,"\\'")}')">
      <span class="member-check">${on?'✓':''}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.name)}${m.supplierName?`<span style="font-size:11px;color:var(--text-muted)">（${esc(m.supplierName)}）</span>`:''}${m.note?`<span style="font-size:11px;color:var(--text-muted)">　${esc(m.note)}</span>`:''}</span>
    </button>`;
  });
  el.innerHTML = html || '<div style="font-size:12px;color:var(--text-muted);padding:10px">候補がありません</div>';
  document.getElementById('task-assignee-modal').classList.add('open');
}
function closeTaskAssigneePicker(){
  document.getElementById('task-assignee-modal').classList.remove('open');
  renderTaskAssignees();
}
function toggleTaskAssignee(name){
  const i=taskAssignees.indexOf(name);
  if(i>=0) taskAssignees.splice(i,1); else taskAssignees.push(name);
  openTaskAssigneePicker();
}

// ── チェックリスト ──
function renderTaskChecklist(){
  const el=document.getElementById('task-checklist');
  if(!el) return;
  el.innerHTML = taskChecklist.map((c,i)=>`
    <div class="task-cl-row">
      <button type="button" class="task-check sm${c.done?' on':''}" onclick="toggleTaskClItem(${i})">${c.done?'✓':''}</button>
      <span style="flex:1;min-width:0;${c.done?'text-decoration:line-through;color:var(--text-muted)':''}">${esc(c.text)}${
        c.done&&c.by?`<span class="task-cl-by">${esc(c.by)}${c.at?' '+clDateLabel(c.at):''}</span>`:''}</span>
      ${taskCanEdit()?`<button type="button" class="btn xs" onclick="removeTaskClItem(${i})">削除</button>`:''}
    </div>`).join('')
    || '<div style="font-size:11px;color:var(--text-muted)">項目なし</div>';
  const n=taskChecklist.filter(c=>c.done).length;
  const lbl=document.getElementById('task-cl-progress');
  if(lbl) lbl.textContent = taskChecklist.length ? `${n}/${taskChecklist.length} 完了` : '';
}
// 済にした日付（引き継ぎ先が「いつまでやってあるか」を見るためのもの）
function clDateLabel(iso){
  const d=new Date(iso);
  if(isNaN(d)) return '';
  return (d.getMonth()+1)+'/'+d.getDate();
}
function toggleTaskClItem(i){
  const c=taskChecklist[i];
  if(!c) return;
  c.done=!c.done;
  // 誰がいつ済にしたかを残す。戻したときは消す
  if(c.done){ c.by=currentUserDisplayName||''; c.at=new Date().toISOString(); }
  else { c.by=''; c.at=''; }
  renderTaskChecklist();
}
function removeTaskClItem(i){ taskChecklist.splice(i,1); renderTaskChecklist(); }
function addTaskClItem(){
  const el=document.getElementById('task-cl-input');
  const text=(el?.value||'').trim();
  if(!text) return;
  taskChecklist.push({id:Date.now()+Math.floor(Math.random()*1000), text, done:false});
  el.value='';
  renderTaskChecklist();
}

// ════ 引き継ぎ（途中まで進めて、その先を別の人に渡す） ════
//
// チェックリストをいくつか済にしたところで「引き継ぐ」を押すと、
// 担当者が引き継ぎ先に入れ替わり、渡した時点の進み具合とひとことが履歴に残る。
// 受け取った人には通知が届き、どこから続ければよいかが分かる。

function renderTaskHandoffs(){
  const wrap=document.getElementById('task-handoff-history');
  if(!wrap) return;
  if(!taskHandoffs.length){ wrap.style.display='none'; wrap.innerHTML=''; return; }
  wrap.style.display='';
  wrap.innerHTML = '<div class="section-lbl" style="margin:2px 0 4px">引き継ぎの記録</div>' +
    taskHandoffs.map(h=>{
      const when=(d=>isNaN(d)?'':`${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`)(new Date(h.at));
      return `<div class="task-ho-row${h.kind==='return'?' back':''}">
        <div class="task-ho-line"><b>${esc(h.from||'—')}</b> ${h.kind==='return'?'↩':'→'} <b>${esc((h.to||[]).join('、')||'—')}</b>${h.kind==='return'?'<span class="task-ho-back">返却</span>':''}
          <span class="task-ho-when">${when}${h.total?`　${h.done}/${h.total} まで`:''}</span></div>
        ${h.note?`<div class="task-ho-note">${esc(h.note)}</div>`:''}
      </div>`;
    }).join('');
}

// 発注先が「返す」相手。自分に引き継いだ人のうちいちばん新しいもの、
// 引き継ぎがまだ無ければタスクを作った人。ほかの人には回せない
// （SQL側の task_return_target と同じ決まりにしてある）
function taskReturnTarget(t){
  const mine = myMemberNames();
  const hs = t?.handoffs || [];
  for(let i=hs.length-1; i>=0; i--){
    const h = hs[i];
    if((h.to||[]).some(n=>mine.includes(n)) && h.from) return h.from;
  }
  return t?.createdBy || '';
}
// 発注先が返せる状態か（自分が担当で、返す相手がいて、まだ済んでいない）
function canReturnTask(t){
  return !taskCanEdit() && !!t && t.status!=='done' && isMyTask(t) && !!taskReturnTarget(t);
}

function openTaskHandoff(){
  if(!editingTodoId || !taskCanEdit()) return;
  handoffMode='handoff';
  handoffTo=[];
  showHandoffModal('タスクを引き継ぐ',
    'いまの進み具合とひとことを添えて、その先を別の人に渡します。渡した記録はタスクに残ります。');
}

// 発注先：自分に渡してきた人へ返す（相手は決まっているので選ばせない）
function openTaskReturn(){
  const t=tasks.find(x=>x.id===editingTodoId);
  if(!canReturnTask(t)) return;
  handoffMode='return';
  handoffTo=[taskReturnTarget(t)];
  showHandoffModal(`${handoffTo[0]}さんに返す`,
    'こちらの分が終わったことを、引き継いでくれた方に伝えて返します。ほかの方には回せません。');
}

function showHandoffModal(title, lead){
  const ret = handoffMode==='return';
  document.getElementById('ho-title').textContent=title;
  document.getElementById('ho-lead').textContent=lead;
  const done=taskChecklist.filter(c=>c.done).length;
  document.getElementById('ho-progress').textContent =
    taskChecklist.length ? `いまの進み具合：${done}/${taskChecklist.length} 完了` : 'チェックリストはありません';
  document.getElementById('ho-note').value='';
  document.getElementById('ho-due').value=document.getElementById('task-due').value||'';
  document.getElementById('ho-keep-me').checked=false;
  // 返す場合は、相手も期限も変えられない（発注先が変えられるのは担当者を返すことだけ）
  document.getElementById('ho-picker').style.display = ret ? 'none' : '';
  document.getElementById('ho-to-label').textContent = ret ? '返す先' : '引き継ぎ先 *';
  document.getElementById('ho-options').style.display = ret ? 'none' : '';
  document.getElementById('ho-go').textContent = ret ? '返す' : '引き継ぐ';
  renderHandoffTo();
  document.getElementById('task-handoff-modal').classList.add('open');
}
function closeTaskHandoff(){ document.getElementById('task-handoff-modal').classList.remove('open'); }

function renderHandoffTo(){
  const tag=document.getElementById('ho-to-tags');
  if(tag) tag.innerHTML = handoffTo.length
    ? handoffTo.map(n=>`<span class="member-tag">${esc(n)}</span>`).join('')
    : '<span style="color:var(--text-muted);font-size:11px">選んでください</span>';
  const el=document.getElementById('ho-picker');
  if(!el || handoffMode==='return') return;   // 返す先は決まっているので候補は出さない
  const cands=(typeof _memberCandidates==='function') ? _memberCandidates() : [];
  let html='', lastKind='';
  cands.forEach(m=>{
    if(m.kind!==lastKind){ html+=`<div class="section-lbl" style="margin:10px 0 4px">${m.kind}</div>`; lastKind=m.kind; }
    const on=handoffTo.includes(m.name);
    html+=`<button type="button" class="member-row${on?' on':''}" onclick="toggleHandoffTo('${m.name.replace(/'/g,"\\'")}')">
      <span class="member-check">${on?'✓':''}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.name)}${m.supplierName?`<span style="font-size:11px;color:var(--text-muted)">（${esc(m.supplierName)}）</span>`:''}${m.note?`<span style="font-size:11px;color:var(--text-muted)">　${esc(m.note)}</span>`:''}</span>
    </button>`;
  });
  el.innerHTML = html || '<div style="font-size:12px;color:var(--text-muted);padding:10px">候補がありません</div>';
}
function toggleHandoffTo(name){
  const i=handoffTo.indexOf(name);
  if(i>=0) handoffTo.splice(i,1); else handoffTo.push(name);
  renderHandoffTo();
}

async function doTaskHandoff(){
  if(!editingTodoId) return;
  const ret = handoffMode==='return';
  if(!handoffTo.length){ showToast(ret?'返す相手が分かりません':'引き継ぎ先を選んでください'); return; }
  const t=tasks.find(x=>x.id===editingTodoId);
  if(!t) return;

  const note=document.getElementById('ho-note').value.trim();
  const due=document.getElementById('ho-due').value||null;
  const keepMe=!ret && document.getElementById('ho-keep-me').checked;
  const done=taskChecklist.filter(c=>c.done).length;

  // 自分を担当に残すかどうか。残さない場合は引き継ぎ先だけが担当になる
  const mine=myMemberNames();
  const keep = keepMe ? taskAssignees.filter(n=>mine.includes(n)) : [];
  const next = ret ? [...handoffTo] : [...new Set([...keep, ...handoffTo])];

  const entry={
    at:new Date().toISOString(),
    from:currentUserDisplayName||'',
    to:[...handoffTo],
    note,
    done,
    total:taskChecklist.length
  };
  if(ret) entry.kind='return';
  const handoffs=[...taskHandoffs, entry];

  // 返す場合は task_return を呼ぶ。返すと自分から見えなくなる行になるので、
  // ふつうの更新では書けない。返す相手と履歴の中身はSupabase側で決まる
  let error;
  if(ret){
    ({ error } = await sb.rpc('task_return', {
      p_id: editingTodoId, p_note: note, p_checklist: taskChecklist
    }));
  } else {
    ({ error } = await sb.from('tasks')
      .update({assignees:next, due_date:due, checklist:taskChecklist, handoffs})
      .eq('id',editingTodoId));
  }
  if(error){ showToast((ret?'返すのに失敗しました：':'引き継ぎに失敗しました：')+error.message); return; }

  // 引き継ぎ先（返す先）に知らせる（自分あてには送らない）
  const notify=handoffTo.filter(n=>!mine.includes(n));
  if(notify.length){
    const dueTxt = (ret ? t.dueDate : due) ? `期限 ${String(ret?t.dueDate:due).replace(/-/g,'/')}` : '期限なし';
    const prog = taskChecklist.length ? `${done}/${taskChecklist.length}まで完了` : '';
    dbSendPushToNames(notify, ret?'タスクが返ってきました':'タスクを引き継ぎました',
      `${t.title}（${[dueTxt, prog].filter(Boolean).join('・')}）${currentUserDisplayName?' — '+currentUserDisplayName:''}${note?'：'+note:''}`,
      'task').catch(()=>{});
  }

  closeTaskHandoff();
  closeTaskModal();
  await refreshTasks();
  showToast(ret ? `${handoffTo.join('、')}さんに返しました` : `${handoffTo.join('、')}さんに引き継ぎました`);
}

// ── 保存・削除 ──
async function saveTask(){
  // 発注先はチェックリストと済／未済だけ保存できる（他はDB側でも元に戻される）
  if(!taskCanEdit()){
    if(!editingTodoId) return;
    const { error } = await sb.from('tasks').update({checklist:taskChecklist}).eq('id',editingTodoId);
    if(error){ showToast('保存に失敗しました：'+error.message); return; }
    const t=tasks.find(x=>x.id===editingTodoId); if(t) t.checklist=taskChecklist;
    closeTaskModal(); renderTaskPage();
    showToast('保存しました');
    return;
  }

  const title=document.getElementById('task-title').value.trim();
  if(!title){ showToast('やることを入力してください'); return; }
  const row={
    title,
    detail:document.getElementById('task-detail').value.trim(),
    project_id:Number(document.getElementById('task-project').value)||null,
    assignees:taskAssignees,
    due_date:document.getElementById('task-due').value||null,
    checklist:taskChecklist,
    handoffs:taskHandoffs
  };

  // 新しく担当になった人にだけ知らせる（すでに担当だった人には送らない）
  const before = editingTodoId ? (tasks.find(x=>x.id===editingTodoId)?.assignees||[]) : [];
  const added = taskAssignees.filter(n=>!before.includes(n) && !myMemberNames().includes(n));

  let saved;
  if(editingTodoId){
    const { data, error } = await sb.from('tasks').update(row).eq('id',editingTodoId).select().single();
    if(error){ showToast('保存に失敗しました：'+error.message); return; }
    saved=data;
  } else {
    const { data, error } = await sb.from('tasks')
      .insert({...row, created_by:currentUserDisplayName||''}).select().single();
    if(error){ showToast('登録に失敗しました：'+error.message); return; }
    saved=data;
  }

  if(added.length){
    const due = row.due_date ? `期限 ${row.due_date.replace(/-/g,'/')}` : '期限なし';
    const pn = row.project_id ? ((projects||[]).find(p=>p.id===row.project_id)?.name||'') : '';
    dbSendPushToNames(added, 'タスクが割り当てられました',
      `${title}（${due}${pn?'・'+pn:''}）${currentUserDisplayName?' — '+currentUserDisplayName:''}`, 'task').catch(()=>{});
  }

  closeTaskModal();
  await refreshTasks();
  showToast(editingTodoId?'保存しました':'タスクを追加しました');
}

async function deleteTask(){
  if(!editingTodoId || !taskCanDelete()) return;
  if(!confirm('このタスクを消します。よろしいですか？')) return;
  const { error } = await sb.from('tasks').delete().eq('id',editingTodoId);
  if(error){ showToast('削除に失敗しました：'+error.message); return; }
  closeTaskModal();
  await refreshTasks();
  showToast('タスクを消しました');
}

async function refreshTasks(){
  try{ await fetchTasks(); }catch(_){ return; }
  updateTaskBadge();
  if(document.getElementById('page-task')?.classList.contains('active')) renderTaskPage();
}
