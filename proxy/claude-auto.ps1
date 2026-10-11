# claude'u otomatik model/effort yönlendiricisi üzerinden çalıştırır.
# Router kapalıysa gizli bir süreç olarak başlatır, claude kapanınca durdurur (kendisi başlattıysa).
# ANTHROPIC_BASE_URL yalnızca bu çalıştırma süresince ayarlanır, sonra eski değerine döner.
# Kullanım: .\proxy\claude-auto.ps1 [claude argümanları]
# Bilerek param() bloğu yok: [Parameter] betiği "gelişmiş" yapar ve PowerShell `-p` gibi claude
# bayraklarını ortak parametre öneki (-ProgressAction) sanıp reddeder. $args hepsini olduğu gibi alır.
$ClaudeArgs = @($args)

$port = if ($env:PORT) { $env:PORT } else { 8787 }
$router = Join-Path $PSScriptRoot 'router.mjs'
$baslattik = $null

function Dinleniyor { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }

if (-not (Dinleniyor)) {
    $baslattik = Start-Process node -ArgumentList "`"$router`"" -WindowStyle Hidden -PassThru
    for ($i = 0; $i -lt 50 -and -not (Dinleniyor); $i++) { Start-Sleep -Milliseconds 100 }
    if (-not (Dinleniyor)) {
        if ($baslattik) { Stop-Process -Id $baslattik.Id -Force -ErrorAction SilentlyContinue }
        throw "Router $port portunda başlatılamadı."
    }
}

# Router'ın yönlendirdiği model (ROUTE_FROM) ile oturum modeli aynı olmalı; kullanıcı vermediyse sonnet.
if ($ClaudeArgs -notcontains '--model') { $ClaudeArgs = @('--model', 'sonnet') + $ClaudeArgs }

$eskiUrl = $env:ANTHROPIC_BASE_URL
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:$port"
try {
    & claude @ClaudeArgs
}
finally {
    $env:ANTHROPIC_BASE_URL = $eskiUrl
    if ($baslattik) { Stop-Process -Id $baslattik.Id -Force -ErrorAction SilentlyContinue }
}
