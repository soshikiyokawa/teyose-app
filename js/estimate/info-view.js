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

  const site = val('est-site');
  const rows = [];
  const add = (label, html, cls) => { if(html) rows.push({label, html, cls}); };

  add('物件名', esc(val('est-project')), 'iv-strong');
  add('工事場所', site
    ? `${esc(site)} <a class="iv-link" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site)}"
         target="_blank" rel="noopener">地図</a>`
    : '');
  add('契約済み駐車場', esc(val('est-parking')));

  const clients = text('client-members-summary');
  add('お客様チャット', (clients && !/未設定$/.test(clients)) ? esc(clients) : '');

  // 着工と完工は横に並べる。
  // 実績（着工日・引渡日）が入っていればそちらを、まだなら予定の日を出す
  const when = (planId, actId, doneLbl) => {
    const a = ymd(val(actId)), p = ymd(val(planId));
    if(a) return { lbl: doneLbl, date: a, done: true };
    if(p) return { lbl: '予定',   date: p, done: false };
    return null;
  };
  const start = when('est-start-date','est-actual-start','着工日');
  const end   = when('est-end-date',  'est-handover',    '引渡日');
  const term = (title, w) => w
    ? `<div class="iv-term"><div class="iv-term-t">${title}</div>
         <div class="iv-term-d${w.done?' done':''}">${esc(w.date)}</div>
         <div class="iv-term-k">${w.lbl}</div></div>`
    : `<div class="iv-term"><div class="iv-term-t">${title}</div>
         <div class="iv-term-d none">—</div><div class="iv-term-k">未定</div></div>`;
  const termsHtml = (start || end)
    ? `<div class="iv-terms">${term('着工', start)}${term('完工', end)}</div>` : '';

  view.innerHTML = (rows.length || termsHtml)
    ? (rows.length ? `<dl class="iv-list">${rows.map(r=>
        `<dt>${esc(r.label)}</dt><dd class="${r.cls||''}">${r.html}</dd>`).join('')}</dl>` : '')
      + termsHtml
    : '<div class="iv-empty">まだ何も入っていません。右上の「編集」から入力してください。</div>';

  // 管理者以外には、編集できないことを添える
  if(!infoCanEdit()){
    view.insertAdjacentHTML('beforeend',
      '<div class="iv-note">案件情報を直せるのは管理者だけです。</div>');
  }
}
