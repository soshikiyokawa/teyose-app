// ════ 定期点検（引渡日を基準にした点検の予定と実施記録） ════
//
// 引渡日が入っている案件について、次のタイミングで点検を行う。
//   3か月 ／ 1年 ／ 3年 ／ 5年 ／ 10年 ／ 15年 ／ 20年
// 予定日は引渡日から自動計算する（引渡日を直せば予定日も直る）。
// 実施したものだけ inspection_records に記録する。

const INSPECTION_PLAN = [
  {kind:'3か月', months:3},
  {kind:'1年',  months:12},
  {kind:'3年',  months:36},
  {kind:'5年',  months:60},
  {kind:'10年', months:120},
  {kind:'15年', months:180},
  {kind:'20年', months:240}
];

// 'YYYY-MM-DD' に月を足す（末日は繰り上げない）
function insAddMonths(s, n){
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(s||''));
  if(!m) return '';
  let y=+m[1], mo=+m[2]+n, d=+m[3];
  y += Math.floor((mo-1)/12); mo = ((mo-1)%12+12)%12+1;
  const last=new Date(Date.UTC(y,mo,0)).getUTCDate();
  return `${y}-${String(mo).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;
}
function insToday(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function insLabel(s){ return s ? s.replace(/-/g,'/') : '—'; }
// 年度（毎年3月1日が新年度）
function insFiscalYear(s){
  const m=/^(\d{4})-(\d{2})/.exec(String(s||''));
  if(!m) return null;
  return +m[2] >= 3 ? +m[1] : +m[1]-1;
}
function insThisFiscalYear(){ return insFiscalYear(insToday()); }

// 引渡日のある案件 × 点検の予定 → 一覧の元データ
function insAllSchedule(){
  const list=[];
  (projects||[]).forEach(p=>{
    if(!p.handoverDate) return;
    INSPECTION_PLAN.forEach(pl=>{
      const dueDate=insAddMonths(p.handoverDate, pl.months);
      if(!dueDate) return;
      const rec=(inspectionRecords||[]).find(r=>r.projectId===p.id && r.kind===pl.kind);
      list.push({
        project:p, kind:pl.kind, dueDate,
        fy: insFiscalYear(dueDate),
        doneDate: rec?.doneDate||'',
        note: rec?.note||'',
        recordId: rec?.id||null
      });
    });
  });
  return list.sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
}

// 状態（未実施／実施済／期限超過）
function insState(row){
  if(row.doneDate) return {label:`実施済（${insLabel(row.doneDate)}）`, color:'var(--ok-t)', kind:'done'};
  const today=insToday();
  if(row.dueDate < today) return {label:'未実施（期限超過）', color:'var(--danger)', kind:'over'};
  const soon=insAddMonths(today, 1);
  if(row.dueDate <= soon) return {label:'まもなく', color:'var(--warn-t)', kind:'soon'};
  return {label:'未実施', color:'var(--text-sub)', kind:'todo'};
}

// ── 画面 ──
let insFilterFY = null;      // 表示中の年度（null＝今年度）
let insHideDone = false;     // 実施済みを隠す

function renderInspection(){
  const el=document.getElementById('inspection-body');
  if(!el) return;
  if(typeof inspectionTableReady!=='undefined' && !inspectionTableReady){
    el.innerHTML=`<div class="card" style="padding:12px;font-size:12px;color:var(--text-sub);line-height:1.7">
      この機能を使うには、データベースの準備が必要です。<br>
      supabase/migration-genba29.sql を実行してください。</div>`;
    return;
  }
  const all=insAllSchedule();
  if(insFilterFY===null) insFilterFY=insThisFiscalYear();

  // 年度の選択肢（点検予定のある年度＋今年度）
  // よく見るものが上に来るよう「今年度 → これから → 過去」の順に並べる
  const now=insThisFiscalYear();
  const years=[...new Set([...all.map(r=>r.fy).filter(v=>v!=null), now])];
  const future=years.filter(y=>y>now).sort((a,b)=>a-b);
  const past=years.filter(y=>y<now).sort((a,b)=>b-a);
  const ordered=[now, ...future, ...past];
  const sel=document.getElementById('ins-fy');
  if(sel){
    sel.innerHTML=ordered.map(y=>`<option value="${y}"${y===insFilterFY?' selected':''}>${y}年度（${y}/3〜${y+1}/2）${y===now?'　今年度':''}</option>`).join('');
  }

  let list=all.filter(r=>r.fy===insFilterFY);
  const total=list.length;
  const doneCnt=list.filter(r=>r.doneDate).length;
  const overCnt=list.filter(r=>!r.doneDate && r.dueDate<insToday()).length;
  if(insHideDone) list=list.filter(r=>!r.doneDate);

  document.getElementById('ins-summary').innerHTML=
    `<span style="font-weight:700">${total}件</span>　実施済み ${doneCnt}件　未実施 ${total-doneCnt}件`+
    (overCnt?`　<span style="color:var(--danger);font-weight:700">期限超過 ${overCnt}件</span>`:'');

  el.innerHTML = list.length
    ? `<div class="card" style="padding:0;overflow:hidden">${list.map(insRowHtml).join('')}</div>`
    : `<div class="card"><div class="empty" style="padding:20px">${insFilterFY}年度に該当する点検はありません</div></div>`;
}

function insRowHtml(r){
  const st=insState(r);
  return `<div class="leave-row">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">
          <span style="cursor:pointer;color:var(--accent-t)" onclick="olOpenProject(${r.project.id})">${esc(r.project.name)}</span>
          <span class="badge sent" style="font-size:10px;padding:1px 6px;margin-left:4px">${r.kind}点検</span>
        </div>
        <div style="font-size:11px;color:var(--text-sub)">
          予定 ${insLabel(r.dueDate)}　<span style="color:var(--text-muted)">引渡 ${insLabel(r.project.handoverDate)}</span>
        </div>
        <div style="font-size:11px;color:${st.color};font-weight:700">${st.label}${r.note?`<span style="font-weight:400;color:var(--text-muted)">　${esc(r.note)}</span>`:''}</div>
      </div>
      <button class="btn xs${r.doneDate?'':' primary'}" onclick="openInspectionRecord(${r.project.id},'${r.kind}')">${r.doneDate?'変更':'実施登録'}</button>
    </div>
  </div>`;
}

function insFyChanged(){ insFilterFY=Number(document.getElementById('ins-fy').value); renderInspection(); }
function insToggleDone(){ insHideDone=document.getElementById('ins-hide-done').checked; renderInspection(); }

// ── 実施登録 ──
let _insProjectId=null, _insKind='';
function openInspectionRecord(projectId, kind){
  const p=(projects||[]).find(x=>x.id===projectId);
  if(!p) return;
  _insProjectId=projectId; _insKind=kind;
  const rec=(inspectionRecords||[]).find(r=>r.projectId===projectId && r.kind===kind);
  document.getElementById('ins-rec-title').textContent=`${p.name}　${kind}点検`;
  document.getElementById('ins-rec-sub').textContent=
    `引渡 ${insLabel(p.handoverDate)}　予定 ${insLabel(insAddMonths(p.handoverDate, INSPECTION_PLAN.find(x=>x.kind===kind)?.months||0))}`;
  document.getElementById('ins-rec-date').value=rec?.doneDate||insToday();
  document.getElementById('ins-rec-note').value=rec?.note||'';
  document.getElementById('ins-rec-delete').style.display = rec ? '' : 'none';
  document.getElementById('inspection-rec-modal').classList.add('open');
}
function closeInspectionRecord(){
  document.getElementById('inspection-rec-modal').classList.remove('open');
  _insProjectId=null; _insKind='';
}
async function saveInspectionRecord(){
  const doneDate=document.getElementById('ins-rec-date').value;
  if(!doneDate){ showToast('実施日を入力してください'); return; }
  const note=document.getElementById('ins-rec-note').value.trim();
  await dbSaveInspection(_insProjectId, _insKind, doneDate, note);
  closeInspectionRecord();
  await refreshInspections();
  renderInspection();
  showToast('実施を登録しました');
}
async function deleteInspectionRecord(){
  if(!confirm('この実施記録を削除しますか？（未実施に戻ります）')) return;
  await dbDeleteInspection(_insProjectId, _insKind);
  closeInspectionRecord();
  await refreshInspections();
  renderInspection();
  showToast('削除しました');
}

async function refreshInspections(){
  try{ await fetchInspections(); }catch(e){ console.warn('点検記録の再取得に失敗',e); }
}
