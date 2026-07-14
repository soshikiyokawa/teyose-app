// ════ 現場ページ：タブ切替・工事選択・共通ユーティリティ ════

function genbaTab(t){
  ['photos','drawings','nippo','leave'].forEach(n=>{
    document.getElementById('genbasub-'+n)?.classList.toggle('active',n===t);
    document.getElementById('genbatab-'+n)?.classList.toggle('active',n===t);
  });
  renderGenbaPage();
}

// 現場ページ全体の再描画（表示中のサブタブだけ描画する）
function renderGenbaPage(){
  renderGenbaProjectSelects();
  if(document.getElementById('genbasub-photos')?.classList.contains('active')) renderSitePhotos();
  if(document.getElementById('genbasub-drawings')?.classList.contains('active')) renderDrawings();
  if(document.getElementById('genbasub-nippo')?.classList.contains('active')) renderNippo();
  if(document.getElementById('genbasub-leave')?.classList.contains('active')) renderLeave();
}

// 写真・図面・日報の工事選択プルダウンを最新の案件一覧で埋める
function renderGenbaProjectSelects(){
  const opts = '<option value="">工事を選択...</option>' +
    projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  ['photo-project-select','drawing-project-select','nippo-project'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    const prev = el.value;
    el.innerHTML = opts;
    // 選択状態を維持（写真・図面は共通のgenbaProjectIdを優先）
    if(id!=='nippo-project' && genbaProjectId) el.value = String(genbaProjectId);
    else if(prev) el.value = prev;
    if(el.value==='') el.selectedIndex = 0;
  });
}

function setGenbaProject(val){
  genbaProjectId = val ? Number(val) : null;
  renderGenbaProjectSelects();
  if(document.getElementById('genbasub-photos')?.classList.contains('active')) renderSitePhotos();
  if(document.getElementById('genbasub-drawings')?.classList.contains('active')) renderDrawings();
}

// 保存・削除後にSupabaseから取り直して再描画する
async function refreshGenba(){
  try{ await fetchGenbaData(); }catch(e){ console.warn('現場データの再取得に失敗', e); }
  renderGenbaPage();
}

// ── 日付ユーティリティ ──
function gbToday(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function gbThisMonth(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
// 'YYYY-MM-DD' → 'M/D（曜）'
function gbDateLabel(s){
  if(!s) return '';
  const d = new Date(s+'T00:00:00');
  const yobi = ['日','月','火','水','木','金','土'][d.getDay()];
  return (d.getMonth()+1)+'/'+d.getDate()+'（'+yobi+'）';
}
// 分 → '8時間30分'
function gbMinLabel(min){
  min = Math.max(0, Math.round(min||0));
  const h = Math.floor(min/60), m = min%60;
  if(h===0) return m+'分';
  return h+'時間'+(m>0 ? m+'分' : '');
}
