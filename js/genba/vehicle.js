// ════ 車両管理（車検・オイル交換・夏／冬タイヤ交換） ════
//
// 会社所有の車両ごとに、車検満了日と点検責任者を登録し、点検の実施記録を残す。
// 通知（vehicle-remind）と同じ考え方で「今やるべきこと」を画面にも出す。
//   車検        … 満了日の3か月前から注意表示
//   オイル交換  … 4/1・10/1 から次のシーズンまでに1回
//   夏タイヤ    … 4/1 から
//   冬タイヤ    … 12/1 から

const VEHICLE_KINDS = ['車検','オイル交換','夏タイヤ','冬タイヤ'];
const VEHICLE_WARN_DAYS = 90;   // 車検がこの日数を切ったら注意表示

// きよかわの社員（管理者・一般社員）か。発注先は含まない
function appIsEmployee(){ return currentUserRole==='staff' || currentUserRole==='carpenter'; }

function vhToday(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function vhDaysLeft(s){ return s ? Math.round((new Date(s+'T00:00:00')-new Date(vhToday()+'T00:00:00'))/86400000) : null; }
function vhLabel(s){ return s ? s.replace(/-/g,'/') : '—'; }

// 実施時期（シーズン）の開始日。通知（vehicle-remind）と同じ判定にする
function vhSeasonStart(kind, today){
  const [y,m,d]=(today||vhToday()).split('-').map(Number);
  const md=m*100+d;
  if(kind==='オイル交換'){
    if(md>=1001) return `${y}-10-01`;
    if(md>=401)  return `${y}-04-01`;
    return `${y-1}-10-01`;
  }
  if(kind==='夏タイヤ'){
    if(md>=1201) return null;
    if(md>=401)  return `${y}-04-01`;
    return null;
  }
  if(kind==='冬タイヤ'){
    if(md>=1201) return `${y}-12-01`;
    if(md<401)   return `${y-1}-12-01`;
    return null;
  }
  return null;
}

// 車両の最新の実施記録
function vhLastRecord(vehicleId, kind){
  return vehicleRecords
    .filter(r=>r.vehicleId===vehicleId && r.kind===kind)
    .sort((a,b)=>(b.doneDate||'').localeCompare(a.doneDate||''))[0] || null;
}

// 今のシーズン分が済んでいるか
function vhSeasonDone(vehicleId, kind){
  const start=vhSeasonStart(kind);
  if(!start) return null;                       // 今はその時期ではない
  const last=vhLastRecord(vehicleId, kind);
  return !!(last && last.doneDate>=start);
}

// 画面に出す「状態」
function vhStatus(v, kind){
  if(kind==='車検'){
    const left=vhDaysLeft(v.inspectionDate);
    if(v.inspectionDate==null||v.inspectionDate==='') return {text:'満了日が未登録', color:'var(--text-muted)', warn:true};
    if(left<0)  return {text:`期限切れ（${vhLabel(v.inspectionDate)}）`, color:'var(--danger)', warn:true};
    if(left<=VEHICLE_WARN_DAYS) return {text:`あと${left}日（${vhLabel(v.inspectionDate)}）`, color:'var(--warn-t)', warn:true};
    return {text:vhLabel(v.inspectionDate), color:'var(--text)', warn:false};
  }
  const start=vhSeasonStart(kind);
  const last=vhLastRecord(v.id, kind);
  // タイヤは季節が来るまで対象外（前回の実施日は右側に別途表示する）
  if(!start) return {text:'時期外', color:'var(--text-muted)', warn:false};
  if(last && last.doneDate>=start) return {text:`実施済み（${vhLabel(last.doneDate)}）`, color:'var(--ok-t)', warn:false};
  return {text:`未実施（${vhLabel(start)}〜）`, color:'var(--danger)', warn:true};
}

// ── 画面 ──
function renderVehicle(){
  const el=document.getElementById('vehicle-body');
  if(!el) return;
  if(typeof vehicleTableReady!=='undefined' && !vehicleTableReady){
    el.innerHTML=`<div class="card" style="padding:12px;font-size:12px;color:var(--text-sub);line-height:1.7">
      この機能を使うには、データベースの準備が必要です。<br>
      ${currentUserRole==='staff' ? 'supabase/migration-genba26.sql を実行し、Edge Function（vehicle-remind）をデプロイしてください。' : '管理者に連絡してください。'}
    </div>`;
    return;
  }
  // 車両の追加・編集は社員なら誰でもできる（削除だけ管理者）
  document.getElementById('vehicle-add-btn').style.display = appIsEmployee() ? '' : 'none';

  if(!vehicles.length){
    el.innerHTML='<div class="card"><div class="empty" style="padding:18px">車両が登録されていません。'+
      (appIsEmployee()?'右上の「車両を追加」から登録してください。':'管理者に登録を依頼してください。')+'</div></div>';
    return;
  }
  el.innerHTML=vehicles.map(vehicleCardHtml).join('');
}

function vehicleCardHtml(v){
  const row=(kind)=>{
    const st=vhStatus(v, kind);
    const last=vhLastRecord(v.id, kind);
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:0.5px solid var(--border)">
      <span style="width:74px;flex-shrink:0;font-size:12px;color:var(--text-sub)">${kind}</span>
      <span style="flex:1;min-width:0;font-size:12px;color:${st.color};font-weight:${st.warn?'800':'600'}">${st.text}</span>
      ${last&&kind!=='車検'?`<span style="font-size:10px;color:var(--text-muted);white-space:nowrap">前回 ${vhLabel(last.doneDate)}</span>`:''}
      <button class="btn xs" onclick="openVehicleRecord(${v.id},'${kind}')">実施登録</button>
    </div>`;
  };
  const insp=vhStatus(v,'車検');
  return `<div class="card" style="padding:12px;margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:800">${esc(v.name)}
          ${v.plate?`<span style="font-size:11px;font-weight:400;color:var(--text-muted)">　${esc(v.plate)}</span>`:''}</div>
        <div style="font-size:11px;color:var(--text-sub)">点検責任者：${v.managerName?esc(v.managerName):'<span style="color:var(--danger)">未設定</span>'}</div>
      </div>
      ${insp.warn?`<span class="status-badge pending">要対応</span>`:''}
      ${appIsEmployee()?`<button class="btn xs" onclick="openVehicleEdit(${v.id})">編集</button>`:''}
      <button class="btn xs" onclick="openVehicleHistory(${v.id})">履歴</button>
    </div>
    ${VEHICLE_KINDS.map(row).join('')}
    ${v.note?`<div style="font-size:11px;color:var(--text-muted);margin-top:6px">${esc(v.note)}</div>`:''}
  </div>`;
}

// ── 車両の登録・編集（管理者のみ） ──
let _vehicleEditId=null;
function openVehicleEdit(id){
  _vehicleEditId=id||null;
  const v=id?vehicles.find(x=>x.id===id):null;
  document.getElementById('vehicle-edit-title').textContent=v?'車両を編集':'車両を追加';
  document.getElementById('vh-name').value=v?.name||'';
  document.getElementById('vh-plate').value=v?.plate||'';
  document.getElementById('vh-inspection').value=v?.inspectionDate||'';
  document.getElementById('vh-note').value=v?.note||'';
  // 点検責任者：社員から選ぶ
  const sel=document.getElementById('vh-manager');
  const emp=(typeof allProfiles!=='undefined'?allProfiles:[])
    .filter(p=>p.role==='staff'||p.role==='carpenter')
    .sort((a,b)=>cmpEmployee(a.displayName,b.displayName));
  sel.innerHTML='<option value="">選択してください</option>'+emp.map(p=>`<option value="${esc(p.displayName)}">${esc(p.displayName)}</option>`).join('');
  sel.value=v?.managerName||'';
  // 削除は管理者のみ（実施記録もまとめて消えるため）
  document.getElementById('vehicle-delete-btn').style.display=(v && currentUserRole==='staff')?'':'none';
  document.getElementById('vehicle-edit-modal').classList.add('open');
}
function closeVehicleEdit(){ document.getElementById('vehicle-edit-modal').classList.remove('open'); _vehicleEditId=null; }

async function saveVehicle(){
  const name=document.getElementById('vh-name').value.trim();
  if(!name){ showToast('車両名を入力してください'); return; }
  const patch={
    name,
    plate:document.getElementById('vh-plate').value.trim(),
    managerName:document.getElementById('vh-manager').value,
    inspectionDate:document.getElementById('vh-inspection').value||null,
    note:document.getElementById('vh-note').value.trim()
  };
  await dbSaveVehicle(_vehicleEditId, patch);
  closeVehicleEdit();
  await refreshVehicles();
  renderVehicle();
  showToast('保存しました');
}
async function deleteVehicle(){
  const v=vehicles.find(x=>x.id===_vehicleEditId);
  if(!v) return;
  if(!confirm(`${v.name}を削除しますか？\n実施記録もすべて消えます。`)) return;
  await dbDeleteVehicle(v.id);
  closeVehicleEdit();
  await refreshVehicles();
  renderVehicle();
  showToast('削除しました');
}

// ── 実施登録 ──
let _recVehicleId=null, _recKind='';
function openVehicleRecord(vehicleId, kind){
  const v=vehicles.find(x=>x.id===vehicleId);
  if(!v) return;
  _recVehicleId=vehicleId; _recKind=kind;
  document.getElementById('vehicle-rec-title').textContent=`${v.name}　${kind}`;
  document.getElementById('vr-date').value=vhToday();
  document.getElementById('vr-odo').value='';
  document.getElementById('vr-note').value='';
  // 車検は次回の満了日も入れてもらう（車両の満了日を更新する）
  const nextWrap=document.getElementById('vr-next-wrap');
  nextWrap.style.display = kind==='車検' ? '' : 'none';
  if(kind==='車検'){
    // 初期値は「実施日の2年後」（貨物車などは1年。必要に応じて直してもらう）
    const [y,m,d]=vhToday().split('-').map(Number);
    document.getElementById('vr-next').value=`${y+2}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  document.getElementById('vehicle-rec-modal').classList.add('open');
}
function closeVehicleRecord(){ document.getElementById('vehicle-rec-modal').classList.remove('open'); _recVehicleId=null; }

async function saveVehicleRecord(){
  const doneDate=document.getElementById('vr-date').value;
  if(!doneDate){ showToast('実施日を入力してください'); return; }
  const rec={
    vehicleId:_recVehicleId, kind:_recKind, doneDate,
    nextDate: _recKind==='車検' ? (document.getElementById('vr-next').value||null) : null,
    odo: parseInt(document.getElementById('vr-odo').value,10)||null,
    note: document.getElementById('vr-note').value.trim()
  };
  await dbAddVehicleRecord(rec);
  // 車検は車両の満了日も更新する
  if(_recKind==='車検' && rec.nextDate){
    await dbSaveVehicle(_recVehicleId, {inspectionDate:rec.nextDate});
  }
  closeVehicleRecord();
  await refreshVehicles();
  renderVehicle();
  showToast('実施を登録しました');
}

// ── 履歴 ──
function openVehicleHistory(vehicleId){
  const v=vehicles.find(x=>x.id===vehicleId);
  if(!v) return;
  document.getElementById('vehicle-hist-title').textContent=v.name;
  const list=vehicleRecords.filter(r=>r.vehicleId===vehicleId)
    .sort((a,b)=>(b.doneDate||'').localeCompare(a.doneDate||''));
  document.getElementById('vehicle-hist-body').innerHTML = list.length
    ? list.map(r=>`<div style="display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:0.5px solid var(--border)">
        <span style="width:70px;flex-shrink:0;font-size:11px;font-weight:700;color:var(--accent-t)">${esc(r.kind)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700">${vhLabel(r.doneDate)}
            ${r.nextDate?`<span style="font-weight:400;color:var(--text-muted)">　次回 ${vhLabel(r.nextDate)}</span>`:''}</div>
          <div style="font-size:10px;color:var(--text-muted)">${r.odo?`${fmt(r.odo)}km　`:''}${esc(r.userName||'')}${r.note?'　'+esc(r.note):''}</div>
        </div>
        ${currentUserRole==='staff'?`<button class="btn xs danger" onclick="deleteVehicleRecord(${r.id})">削除</button>`:''}
      </div>`).join('')
    : '<div class="empty" style="padding:14px">記録はありません</div>';
  document.getElementById('vehicle-hist-modal').classList.add('open');
}
function closeVehicleHistory(){ document.getElementById('vehicle-hist-modal').classList.remove('open'); }

async function deleteVehicleRecord(id){
  const r=vehicleRecords.find(x=>x.id===id);
  if(!r) return;
  if(!confirm(`${r.kind}（${vhLabel(r.doneDate)}）の記録を削除しますか？`)) return;
  await dbDeleteVehicleRecord(id);
  await refreshVehicles();
  const vid=r.vehicleId;
  renderVehicle();
  openVehicleHistory(vid);
  showToast('削除しました');
}

async function refreshVehicles(){
  try{ await fetchVehicles(); }catch(e){ console.warn('車両データの再取得に失敗',e); }
}
