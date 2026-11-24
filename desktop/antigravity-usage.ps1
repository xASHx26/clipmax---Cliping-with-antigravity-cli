param([Parameter(Mandatory=$true)][string]$SettingsFile,[Parameter(Mandatory=$true)][string]$AgyPath)
Write-Host 'Clipmax profile sync: sign in through Antigravity if prompted. Open /usage to refresh quota.'
Write-Host 'Account changes use Antigravity controls. Clipmax does not copy your sign-in credentials.'
Write-Host 'First launch: finish the welcome theme and Terms & Data Use choices, then enter /usage.'
& $AgyPath --settings $SettingsFile --prompt-interactive '/usage'
