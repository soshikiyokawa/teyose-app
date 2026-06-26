// ════ 見積：サブタブ切り替え・ステータスバッジ ════

function estSubTab(t){
  document.querySelectorAll('#page-estimate .sub-tab-btn').forEach((b,i)=>b.classList.toggle('active',['info','items','summary'][i]===t));
  document.querySelectorAll('#page-estimate .sub-page').forEach(p=>p.classList.remove('active'));
  document.getElementById('estsub-'+t).classList.add('active');
  if(t==='items') renderSections();
  if(t==='summary'){recalcSum();renderSumBreakdown();}
}

function updateEstBadge(){
  const s=document.getElementById('est-status').value;
  const b=document.getElementById('est-badge');
  b.className='badge '+s;
  b.textContent=s==='draft'?'下書き':s==='sent'?'提出済み':'受注';
}
