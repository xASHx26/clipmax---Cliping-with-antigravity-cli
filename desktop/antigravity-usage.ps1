param([Parameter(Mandatory=$true)][string]$SettingsFile,[Parameter(Mandatory=$true)][string]$AgyPath)
Write-Host 'Clipmax profile sync: sign in through Antigravity if prompted. Open /usage to refresh quota.'
Write-Host 'Account changes use Antigravity controls. Clipmax does not copy your sign-in credentials.'
& $AgyPath --settings $SettingsFile --prompt-interactive '/usage'
