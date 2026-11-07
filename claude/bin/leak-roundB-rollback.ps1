# Rollback round B: restore driver start types from backup. Run ELEVATED. Reboot after.
$bak = "$env:USERPROFILE\.claude\logs\roundB-backup.txt"
$map = @{Boot='boot'; System='system'; Auto='auto'; Manual='demand'; Disabled='disabled'}
Import-Csv $bak | ForEach-Object {
    $mode = $map[$_.previous_start]; if (-not $mode) { $mode = 'demand' }
    sc.exe config $_.driver start= $mode | Out-Null
    "  $($_.driver) -> $mode"
}
"Done. Reboot to apply:  shutdown /r /t 0"
