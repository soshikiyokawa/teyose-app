// ════ 案件情報の「読むだけ」の画面 ════
//
// 案件を開いたら、まずは中身が読みやすく並んだ形で出す。
// 右上の「編集」を押したときだけ、これまでの入力欄に切り替わる。
//   ・うっかり書き換えてしまうのを防ぐため
//   ・ふだんは見るだけのことが多いため
//
// 中身は入力欄からそのまま読む。別に持たないので、表示と中身がずれない。

let infoEditMode = false;

function infoCanEdit(){ return currentUserRole === 'staff'; }

// 編集と閲覧を切り替える
function toggleInfoEdit(){
  if(!infoCanEdit()){ showToast('案件情報を直せるのは管理者だけです'); return; }
  infoEditMode = !infoEditMode;
  applyInfoMode();
  if(!infoEditMode) showToast('編集を終わりました');
}

// 案件を切り替えたとき・タブを開いたときは、読むだけの形に戻す
function resetInfoMode(){
  infoEditMode = false;
  applyInfoMode();
}

function applyInfoMode(){
  const view = document.getElementById('info-view');
  const form = document.getElementById('info-form');
  if(!view || !form) return;
  // 管理者以外はもともと直せないので、いつも読むだけ
  const editing = infoEditMode && infoCanEdit();

  view.style.display = editing ? 'none' : '';
  form.style.display = editing ? '' : 'none';

  const btn = document.getElementById('info-edit-btn');
  if(btn){
    btn.textContent = editing ? '編集を終わる' : '編集';
    btn.classList.toggle('primary', editing);
  }
  const save = document.getElementById('info-save-btn');
  if(save) save.style.display = editing ? '' : 'none';
  // 削除の出し分けは updateProjDeleteBtn が持っている（編集中かどうかも見ている）
  if(typeof updateProjDeleteBtn === 'function') updateProjDeleteBtn();

  if(!editing) renderInfoView();
}

// ── 読むだけの画面を組み立てる ──
function renderInfoView(){
  const view = document.getElementById('info-view');
  if(!view) return;
  if(!selectedProject){
    view.innerHTML = '<div class="iv-empty">左の一覧から案件を選んでください。</div>';
    return;
  }

  const val  = id => (document.getElementById(id)?.value || '').trim();
  const text = id => (document.getElementById(id)?.textContent || '').trim();
  const ymd  = s => s ? String(s).replace(/-/g,'/') : '';
  // 選んでいないとき（「—」「選択...」などの見出し）は、何も無いものとして扱う
  const sel  = id => {
    const e = document.getElementById(id);
    if(!e || !e.value || e.selectedIndex < 0) return '';
    return (e.options[e.selectedIndex]?.textContent || '').trim();
  };

  const site = val('est-site');
  const rows = [];
  const add = (label, html, cls) => { if(html) rows.push({label, html, cls}); };

  add('物件名', esc(val('est-project')), 'iv-strong');
  add('工事区分', esc(sel('info-type')));
  add('工事場所', site
    ? `${esc(site)} <a class="iv-link" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site)}"
         target="_blank" rel="noopener">地図</a>`
    : '');
  add('契約済み駐車場', esc(val('est-parking')));

  // 日付は「予定」と「実績」を並べて出す
  const term = (planId, actId, planLbl, actLbl) => {
    const p = ymd(val(planId)), a = ymd(val(actId));
    if(!p && !a) return '';
    return [p ? `${planLbl} ${esc(p)}` : '', a ? `<b>${actLbl} ${esc(a)}</b>` : '']
      .filter(Boolean).join('　／　');
  };
  add('着工', term('est-start-date','est-actual-start','予定','着工日'));
  add('完工', term('est-end-date','est-handover','予定','引渡日'));

  // 工期（実績があれば実績で、無ければ予定で）
  const s = val('est-actual-start') || val('est-start-date');
  const e = val('est-handover')     || val('est-end-date');
  if(s && e){
    const n = Math.round((new Date(e+'T00:00:00') - new Date(s+'T00:00:00')) / 86400000) + 1;
    if(n > 0) add('工期', `${n}日間`);
  }

  const members = text('proj-members-summary');
  add('参加メンバー', (members && members!=='未設定') ? esc(members) : '');
  const clients = text('client-members-summary');
  add('お客様チャット', (clients && !/未設定$/.test(clients)) ? esc(clients) : '');

  view.innerHTML = rows.length
    ? `<dl class="iv-list">${rows.map(r=>
        `<dt>${esc(r.label)}</dt><dd class="${r.cls||''}">${r.html}</dd>`).join('')}</dl>`
    : '<div class="iv-empty">まだ何も入っていません。右上の「編集」から入力してください。</div>';

  // 管理者以外には、編集できないことを添える
  if(!infoCanEdit()){
    view.insertAdjacentHTML('beforeend',
      '<div class="iv-note">案件情報を直せるのは管理者だけです。</div>');
  }
}
