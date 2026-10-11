# auto-model-effort mod'u kalıcı kurulu olduğu için (claude plugin install auto-model-effort@anqarium)
# düz `claude` zaten otomatik model/effort seçer. Bu betik yalnızca oturumu mod'un yönlendirdiği
# sonnet ile başlatır (kullanıcı --model vermediyse). --plugin-dir verilmez: mod iki kez yüklenirdi.

# Bilerek param() bloğu yok: [Parameter] betiği "gelişmiş" yapar ve PowerShell `-p` gibi claude
# bayraklarını ortak parametre öneki (-ProgressAction) sanıp reddeder. $args hepsini olduğu gibi alır.
$ClaudeArgs = @($args)
if (-not ($ClaudeArgs | Where-Object { $_ -like '--model*' })) { $ClaudeArgs = @('--model', 'sonnet') + $ClaudeArgs }

& claude @ClaudeArgs
