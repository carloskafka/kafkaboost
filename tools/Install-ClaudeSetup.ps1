<#
Installs the generic Claude skills and agents (token saving, /orchestrate, Haiku agents) from the private repo
carloskafka/ai-toolkit into ~/.claude so they work in every project. Needs `gh` logged in.
KafkaBoost-specific skills and diff-verifier stay in this repo's .claude/. Never edits settings.json, hooks or CLAUDE.md.
#>
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ai-toolkit-' + [guid]::NewGuid().ToString('N'))
gh repo clone carloskafka/ai-toolkit $tmp -- --depth 1
if ($LASTEXITCODE -ne 0) { throw 'could not clone carloskafka/ai-toolkit (is gh logged in?)' }
try { & (Join-Path $tmp 'install.ps1') -Force:$Force } finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
