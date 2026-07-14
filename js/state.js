// ════ グローバル状態（アプリ起動中に変化するデータ） ════
// データの実体はSupabase（js/data/db.js）から取得し、ここへ反映する

// 認証・権限
let currentUserRole = null;       // 'staff' | 'carpenter' | 'supplier'
let currentUserSupplierId = null; // supplierロールの場合、自社のsupplier id
let currentUserDisplayName = '';
let currentUserId = null;         // auth.users の uuid（日報・有給の本人判定用）

// 現場管理（写真・図面・日報・有給）
let sitePhotos = [];        // 現場写真
let drawings = [];          // 図面
let dailyReports = [];      // 日報（carpenterは自分の分のみ・staffは全員分。RLSが自動で絞る）
let leaveRequests = [];     // 有給申請（同上）
let genbaProjectId = null;  // 現場ページで選択中の工事ID（写真・図面タブ共通）
let editingNippoId = null;  // 編集中の日報ID（nullなら新規）
let nippoMonth = null;      // 日報一覧で表示中の月（'YYYY-MM'）
let nippoFilterUser = '';   // staff用：日報一覧の社員絞り込み（user_id。空=全員）
let viewingPhotoId = null;  // 写真ビューアで表示中の写真ID

// やり取り
let talkPanelOpen = false;
let activeTalkPanelSupplier = null;
let talkThreads = {};

// 受発注
let cart=[], orders=[], orderSeq=1, costEntries=[], currentOrder=null;

// 案件マスタ（物件名・施主名・工事区分・現場住所・備考）。見積・受発注の親となるエンティティ
let projects=[];
let selectedProject=null;  // 左サイドバーで選択中の案件オブジェクト
let editingProjectId=null; // 案件モーダルで編集中のID（nullなら新規作成）

// 見積
let estDirty=false; // 未保存の変更あり
let estimates=[],estSeq=1,editingEstId=null;
let selectedProjectName=null; // 選択中の案件名（selectedProject?.name と同期。後方互換用）
let sections=[],secSeq=1,itemSeq=1;
let estimatePresets=[]; // 工事品目マスタ（工種ごとの明細・単位・原価の選択候補）
let estimateCategories=[]; // 工種マスタ
let estimateDefaults={}; // 工事区分（新築／リフォーム等）ごとのデフォルト明細 {type: sections[]}

// 見積：明細入力画面のドラッグ並び替え用の一時状態
let dragSrcSecId=null;
let dragSrcItemSecId=null, dragSrcItemId=null;

// 見積の工事区分（新築・リフォーム等）。マスタ画面の工事区分タブ・見積入力の選択肢もこれを使う。追加・削除可能
let estimateTypes=[];
let estTypeIdSeq=1;

// 工種・工事品目マスタ画面の一時状態
let editingEstCatId=null;
let editingEstPresetId=null;
let activeEstPresetCat=null;
let activeMasterWorkType='新築'; // 工種・工事品目マスタで今表示中の工事区分
let dragSrcEstCatId=null, estCatDirty=false;
let dragSrcEstPresetId=null, estPresetDirty=false;

// 発注先マスタ
let suppliers = [];
let supplierIdSeq = 1, editingSupplierId=null;

// 品目マスタ
let master = [];
let masterIdSeq = 1, editingMasterId=null;

// 発注作成フロー（発注先選択 → 品目選択）の一時状態
let selectedSupplier=null, activeCat='全て', pendingItem=null;

// 品目マスタ画面（ドラッグ並び替え）の一時状態
let dragSrcId = null;
let activeMasterSupplier = null;
let masterDirty = false; // 並び替え後に保存ボタンを光らせるフラグ

// 発注先マスタ画面（ドラッグ並び替え）の一時状態
let dragSrcSupplierId = null;
let supplierDirty = false;
