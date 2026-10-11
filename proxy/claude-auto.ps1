# claude'u otomatik model/effort yönlendiricisi üzerinden çalıştırır.
# Her çalıştırma kendi boş portunda kendi router'ını başlatır ve claude kapanınca onu durdurur;
# böylece aynı anda açık pencereler birbirinin router'ını kapatmaz.
# ANTHROPIC_BASE_URL ve CLAUDE_CODE_GATEWAY_HINT_HEADERS yalnızca bu çalıştırma süresince ayarlanır.
# Kullanım: .\proxy\claude-auto.ps1 [claude argümanları]

# Bilerek param() bloğu yok: [Parameter] betiği "gelişmiş" yapar ve PowerShell `-p` gibi claude
# bayraklarını ortak parametre öneki (-ProgressAction) sanıp reddeder. $args hepsini olduğu gibi alır.
$ClaudeArgs = @($args)
$router = Join-Path $PSScriptRoot 'router.mjs'

$dinleyici = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$dinleyici.Start()
$port = $dinleyici.LocalEndpoint.Port
$dinleyici.Stop()

function Saglikli {
    try { (Invoke-RestMethod "http://127.0.0.1:$port/__router" -TimeoutSec 1).router -eq 'cc-auto-model-and-effort' }
    catch { $false }
}

$hataDosyasi = Join-Path ([IO.Path]::GetTempPath()) "claude-auto-router-$port.err"
$eski = @{ PORT = $env:PORT; URL = $env:ANTHROPIC_BASE_URL; HINT = $env:CLAUDE_CODE_GATEWAY_HINT_HEADERS; EBEVEYN = $env:CLAUDE_AUTO_EBEVEYN }
$env:PORT = "$port"
# Pencere X ile kapatılırsa finally çalışmaz; router bu PID'i izleyip kendini kapatır.
$env:CLAUDE_AUTO_EBEVEYN = "$PID"
$surec = Start-Process node -ArgumentList "`"$router`"" -WindowStyle Hidden -PassThru -RedirectStandardError $hataDosyasi
$env:PORT = $eski.PORT
$env:CLAUDE_AUTO_EBEVEYN = $eski.EBEVEYN

for ($i = 0; $i -lt 50 -and -not $surec.HasExited -and -not (Saglikli); $i++) { Start-Sleep -Milliseconds 100 }
if (-not (Saglikli)) {
    Stop-Process -Id $surec.Id -Force -ErrorAction SilentlyContinue
    $ayrinti = Get-Content $hataDosyasi -Raw -ErrorAction SilentlyContinue
    throw "Router $port portunda başlatılamadı. $ayrinti"
}

# Router yalnızca ROUTE_FROM modelini (varsayılan sonnet) yönlendirir; kullanıcı model vermediyse sonnet ile başla.
if (-not ($ClaudeArgs | Where-Object { $_ -like '--model*' })) { $ClaudeArgs = @('--model', 'sonnet') + $ClaudeArgs }

# Statusline yalnızca bu oturuma eklenir (--settings); router'ın gerçek kararını gösterir.
# JSON'u argüman olarak geçirmek tırnak kaçışı yüzünden kırılgan, bu yüzden geçici dosya.
$ayarDosyasi = Join-Path ([IO.Path]::GetTempPath()) "claude-auto-ayar-$port.json"
$statusline = (Join-Path $PSScriptRoot 'statusline.mjs') -replace '\\', '/'
@{ statusLine = @{ type = 'command'; command = "node `"$statusline`"" } } | ConvertTo-Json | Set-Content $ayarDosyasi -Encoding utf8
$ClaudeArgs = @('--settings', $ayarDosyasi) + $ClaudeArgs

$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:$port"
# İstek sınıfı / prompt kimliği başlıkları; özel base URL'de varsayılan kapalı.
$env:CLAUDE_CODE_GATEWAY_HINT_HEADERS = '1'
try {
    & claude @ClaudeArgs
}
finally {
    $env:ANTHROPIC_BASE_URL = $eski.URL
    $env:CLAUDE_CODE_GATEWAY_HINT_HEADERS = $eski.HINT
    Stop-Process -Id $surec.Id -Force -ErrorAction SilentlyContinue
    Remove-Item $ayarDosyasi -ErrorAction SilentlyContinue
    if ((Get-Item $hataDosyasi -ErrorAction SilentlyContinue).Length -eq 0) { Remove-Item $hataDosyasi -ErrorAction SilentlyContinue }
}
