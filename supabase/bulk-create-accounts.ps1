# 手寄アプリ：アカウント一括作成スクリプト
#
# 【重要】実行前に、このPowerShellウィンドウだけで以下を実行してください（このファイルには書き込まないこと）：
#   $env:SUPABASE_SERVICE_ROLE_KEY = "（Supabaseダッシュボード Settings > API の service_role キーを貼る）"
#
# 使い方：
#   1. accounts-template.csv をコピーして accounts.csv を作り、社内・発注先の一覧を記入する
#   2. 上記のとおり service_role キーを環境変数にセットする
#   3. このスクリプトを実行：  powershell -ExecutionPolicy Bypass -File .\bulk-create-accounts.ps1
#   4. 完了後、accounts-output.csv にログイン情報（メール・パスワード）が出力されるので、各担当者へ安全な方法で連絡する

$SupabaseUrl = "https://uotzxrwtzlpdnpfbaqpi.supabase.co"
$ServiceKey = $env:SUPABASE_SERVICE_ROLE_KEY
if(-not $ServiceKey){
  Write-Error "環境変数 SUPABASE_SERVICE_ROLE_KEY が未設定です。先に `$env:SUPABASE_SERVICE_ROLE_KEY = '...'` を実行してください。"
  exit 1
}

$Headers = @{
  apikey        = $ServiceKey
  Authorization = "Bearer $ServiceKey"
  "Content-Type" = "application/json; charset=utf-8"
}

function New-RandomPassword {
  $chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
  -join (1..12 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
}

function ConvertTo-Utf8JsonBody($obj){
  $obj | ConvertTo-Json
}

function Get-OrCreateSupplierId($name){
  $encoded = [uri]::EscapeDataString($name)
  $existing = Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/suppliers?name=eq.$encoded&select=id" -Headers $Headers -Method Get
  if($existing.Count -gt 0){ return $existing[0].id }
  $body = ConvertTo-Utf8JsonBody @{ name = $name }
  $created = Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/suppliers" -Headers ($Headers + @{Prefer="return=representation"}) -Method Post -Body $body
  return $created[0].id
}

$csvPath = Join-Path $PSScriptRoot "accounts.csv"
if(-not (Test-Path $csvPath)){
  Write-Error "accounts.csv が見つかりません。accounts-template.csv をコピーして作成してください。"
  exit 1
}
$rows = Import-Csv -Path $csvPath -Encoding UTF8
$results = @()

foreach($row in $rows){
  $email = $row.email.Trim()
  $type = $row.type.Trim()
  $displayName = $row.display_name.Trim()
  if(-not $email -or -not $type){ continue }

  Write-Host "作成中: $displayName ($email) ..."
  $password = New-RandomPassword

  try{
    $supplierId = $null
    if($type -eq 'supplier'){
      $supplierId = Get-OrCreateSupplierId $row.supplier_name.Trim()
    }

    $userBody = ConvertTo-Utf8JsonBody @{ email = $email; password = $password; email_confirm = $true }
    $user = Invoke-RestMethod -Uri "$SupabaseUrl/auth/v1/admin/users" -Headers $Headers -Method Post -Body $userBody

    $profileBody = ConvertTo-Utf8JsonBody @{ id = $user.id; role = $type; supplier_id = $supplierId; display_name = $displayName }
    Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/profiles" -Headers ($Headers + @{Prefer="return=minimal"}) -Method Post -Body $profileBody | Out-Null

    $results += [PSCustomObject]@{ display_name=$displayName; type=$type; email=$email; password=$password; status='成功' }
    Write-Host "  -> 成功" -ForegroundColor Green
  } catch {
    $detail = if($_.ErrorDetails.Message){ $_.ErrorDetails.Message } else { $_.Exception.Message }
    $results += [PSCustomObject]@{ display_name=$displayName; type=$type; email=$email; password=''; status="失敗: $detail" }
    Write-Host "  -> 失敗: $detail" -ForegroundColor Red
  }
}

$outPath = Join-Path $PSScriptRoot "accounts-output.csv"
$results | Export-Csv -Path $outPath -NoTypeInformation -Encoding UTF8
Write-Host ""
Write-Host "完了。ログイン情報は $outPath に出力しました。" -ForegroundColor Cyan
Write-Host "このファイルにはパスワードの平文が入っています。各担当者へ渡したら、安全な場所に保管するか削除してください。" -ForegroundColor Yellow
