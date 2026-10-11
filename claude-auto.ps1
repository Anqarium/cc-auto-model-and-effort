# Artık gerekli değil: auto-model-effort mod'u kalıcı kurulu (claude plugin install auto-model-effort@anqarium)
# ve her modelde yönlendirdiği için düz `claude` yeterli. Bu betik yalnızca başlangıç modelini sonnet yapar
# (kullanıcı --model vermediyse). --plugin-dir verilmez: mod iki kez yüklenirdi.

# Bilerek param() bloğu yok: [Parameter] betiği "gelişmiş" yapar ve PowerShell `-p` gibi claude
# bayraklarını ortak parametre öneki (-ProgressAction) sanıp reddeder. $args hepsini olduğu gibi alır.
$ClaudeArgs = @($args)
if (-not ($ClaudeArgs | Where-Object { $_ -like '--model*' })) { $ClaudeArgs = @('--model', 'sonnet') + $ClaudeArgs }

& claude @ClaudeArgs
