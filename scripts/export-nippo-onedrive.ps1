# ════ 日報のOneDrive自動バックアップ ════
# 毎日21時にタスクスケジューラから実行され、当月と前月の日報CSVを
# OneDriveの共有フォルダに保存する（OneDriveが自動でクラウド同期）。
# PCが21時に起動していなかった場合は、次回起動時に自動実行される（StartWhenAvailable）。

$ErrorActionPreference = 'Stop'

$secret = '0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919'
$base   = 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/export-nippo'
$outDir = 'C:\Users\sokiy\OneDrive\共有\日報バックアップ'
$logFile = Join-Path $outDir '保存ログ.txt'

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force $outDir | Out-Null }

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy/MM/dd HH:mm') $msg"
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

# 当月と前月（日報は後から修正されることがあるため、前月分も毎回上書きして最新に保つ）
foreach ($offset in 0, -1) {
    $month = (Get-Date).AddMonths($offset).ToString('yyyy-MM')
    $outFile = Join-Path $outDir "日報_$month.csv"
    $tmp = Join-Path $env:TEMP "nippo_$month.csv"
    try {
        Invoke-WebRequest -Uri "$base`?month=$month" -Headers @{ 'x-remind-secret' = $secret } -OutFile $tmp -UseBasicParsing -TimeoutSec 60
        Move-Item $tmp $outFile -Force
        Write-Log "OK  日報_$month.csv を保存しました"
    } catch {
        Write-Log "エラー ($month): $($_.Exception.Message)"
    }
}

# ログが大きくなりすぎたら古い行を削る（最新200行だけ残す）
try {
    $lines = Get-Content $logFile -Encoding UTF8
    if ($lines.Count -gt 200) { $lines | Select-Object -Last 200 | Set-Content $logFile -Encoding UTF8 }
} catch {}
