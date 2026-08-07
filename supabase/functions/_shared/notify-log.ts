// 送ったプッシュ通知を notifications テーブルに残すための共通処理。
//
// スマホの通知は消してしまうと読み返せないので、アプリの「通知」から
// 後から確かめられるように1件ずつ記録しておく（1行＝宛先1人ぶん）。
//
// 通知そのものの送信は各Edge Functionがこれまでどおり行う。
// ここは記録だけを担当し、失敗しても通知の送信は止めない。

export async function logNotifications(
  admin: any,
  userIds: string[],
  payload: { title?: string; body?: string; tab?: string | null },
  source: string,
) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return;
  try {
    await admin.from("notifications").insert(
      ids.map((user_id) => ({
        user_id,
        title: payload.title || "手寄",
        body: payload.body || "",
        tab: payload.tab || null,
        source,
      })),
    );
  } catch (_e) {
    // 記録に失敗しても通知は送れているので、ここでは何もしない
  }
}
