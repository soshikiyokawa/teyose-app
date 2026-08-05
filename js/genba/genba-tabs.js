// ════ 現場ページ：タブ切替・工事選択・共通ユーティリティ ════

function genbaTab(t){
  ['photos','drawings','nippo','leave','holiday','license','vehicle'].forEach(n=>{
    document.getElementById('genbasub-'+n)?.classList.toggle('active',n===t);
    document.getElementById('genbatab-'+n)?.classList.toggle('active',n===t);
  });
  renderGenbaPage();
}

// 現場ページ全体の再描画（表示中のサブタブだけ描画する）
function renderGenbaPage(){
  // staffの写真・図面は案件情報タブに集約（現場ページは日報・有給のみ）
  if(currentUserRole==='staff'){
    const act = document.querySelector('#page-genba .sub-page.active');
    if(act && (act.id==='genbasub-photos'||act.id==='genbasub-drawings')){ genbaTab('nippo'); return; }
  }
  // 発注先は写真・図面だけ（日報などのタブは出さない）
  if(currentUserRole==='supplier'){
    const act = document.querySelector('#page-genba .sub-page.active');
    if(!act || !(act.id==='genbasub-photos'||act.id==='genbasub-drawings')){ genbaTab('photos'); return; }
    renderSupplierProjectInfo();
  }
  renderGenbaProjectSelects();
  if(document.getElementById('genbasub-photos')?.classList.contains('active')) mountGenbaFB('photo');
  if(document.getElementById('genbasub-drawings')?.classList.contains('active')) mountGenbaFB('drawing');
  if(document.getElementById('genbasub-nippo')?.classList.contains('active')) renderNippo();
  if(document.getElementById('genbasub-leave')?.classList.contains('active')) renderLeave();
  if(document.getElementById('genbasub-holiday')?.classList.contains('active')) renderHoliday();
  if(document.getElementById('genbasub-license')?.classList.contains('active')) renderLicense();
  if(document.getElementById('genbasub-vehicle')?.classList.contains('active')) renderVehicle();
}

// 案件が完工済みか。ステータスは案件ではなく見積に入っているので、そちらを見る
// （案件一覧の「完工」バッジと同じ判定）
function isProjectCompleted(p){
  if(!p) return false;
  const est = (typeof olEstimateOf==='function')
    ? olEstimateOf(p)
    : [...(estimates||[]).filter(e=>e.projectName===p.name)]
        .sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0))[0];
  return est?.status === 'completed';
}

// 写真・図面・日報の工事選択プルダウンを最新の案件一覧で埋める
function renderGenbaProjectSelects(){
  const optHtml = list => '<option value="">工事を選択...</option>' +
    list.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const opts = optHtml(projects);
  // 日報・休日出勤は、もう終わった工事を選ばないよう完工済みを外す
  const optsActive = optHtml(projects.filter(p=>!isProjectCompleted(p)));
  ['photo-project-select','drawing-project-select','nippo-project','holiday-project'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    const prev = el.value;
    // 日報・休日出勤は「その他」（案件に紐づかない：設計・事務・空き家管理など）を追加
    // 日報にはさらに「職業訓練校」（訓練校生の通学日）を「その他」の上に置く
    const withOther = (id==='nippo-project' || id==='holiday-project');
    el.innerHTML = withOther
      ? optsActive + (id==='nippo-project' ? `<option value="school">${NIPPO_SCHOOL}</option>` : '')
             + '<option value="other">その他</option>'
      : opts;
    // 選択状態を維持（写真・図面は共通のgenbaProjectIdを優先）
    if(!withOther && genbaProjectId) el.value = String(genbaProjectId);
    else if(prev) genbaSelectProject(el, prev);
    if(el.value==='') el.selectedIndex = 0;
  });
  // 「その他」欄の表示を同期
  if(typeof nippoProjectChanged==='function') nippoProjectChanged();
  if(typeof holidayProjectChanged==='function') holidayProjectChanged();
}

// 工事を選ぶ。一覧に無い案件（完工済みなど）は「（完工）」付きで足してから選ぶ。
// 過去の日報を開き直したときに、当時の工事がそのまま出るようにするため。
function genbaSelectProject(el, val){
  if(!el) return;
  const v = String(val||'');
  if(v && !Array.from(el.options).some(o=>o.value===v)){
    const p = (projects||[]).find(x=>String(x.id)===v);
    if(p){
      const o = document.createElement('option');
      o.value = v;
      o.textContent = p.name + (isProjectCompleted(p) ? '（完工）' : '');
      const tail = Array.from(el.options).find(x=>x.value==='school'||x.value==='other');
      el.insertBefore(o, tail || null);
    }
  }
  el.value = v;
}

function setGenbaProject(val){
  genbaProjectId = val ? Number(val) : null;
  renderGenbaProjectSelects();
  if(typeof renderSupplierProjectInfo==='function') renderSupplierProjectInfo();
  if(document.getElementById('genbasub-photos')?.classList.contains('active')) mountGenbaFB('photo');
  if(document.getElementById('genbasub-drawings')?.classList.contains('active')) mountGenbaFB('drawing');
}

// 保存・削除後にSupabaseから取り直して再描画する
async function refreshGenba(){
  try{ await fetchGenbaData(); }catch(e){ console.warn('現場データの再取得に失敗', e); }
  if(document.getElementById('page-genba')?.classList.contains('active')) renderGenbaPage();
  renderInfoGenbaSections();
  refreshFB(); // モーダルで開いているファイルブラウザにも反映
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
