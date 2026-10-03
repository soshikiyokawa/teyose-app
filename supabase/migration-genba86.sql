-- ════ チャットの添付に、ワード・エクセルなども置けるようにする ════
--
-- 画面側（index.html の accept）は広げたが、保管場所の側で種類を絞っていると
-- 「送れませんでした」になってしまう。chat-files の絞りを外しておく。
--
-- もともと絞っていなければ、何も変わらない（流しても害は無い）。

-- ── いまの設定 ──
select id as "保管場所",
       coalesce(array_to_string(allowed_mime_types, ', '), '（絞っていない）') as "置ける種類",
       coalesce(file_size_limit::text, '（上限なし）') as "1つあたりの上限"
  from storage.buckets
 where id = 'chat-files';

-- ── 種類の絞りを外す ──
--    画面側で選べるものを絞っているので、ここでは止めない。
--    大きさは アプリ側で40MBまでに止めている（js/data/db.js の dbUploadChatFile）
update storage.buckets
   set allowed_mime_types = null
 where id = 'chat-files'
   and allowed_mime_types is not null;

-- ── 直したあと ──
--    「置ける種類」が（絞っていない）になっていれば完了
select id as "保管場所",
       coalesce(array_to_string(allowed_mime_types, ', '), '（絞っていない）') as "置ける種類",
       coalesce(file_size_limit::text, '（上限なし）') as "1つあたりの上限"
  from storage.buckets
 where id = 'chat-files';
