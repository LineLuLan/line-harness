# Round B: boot-disable OEM kernel drivers (NOT Vanguard). Run ELEVATED. Reboot after.
$drivers = 'Nahimic_Mirroring','NahimicBTLink','NahimicXVAD','FBNetFilter','pwdrvio'
$bak = "$env:USERPROFILE\.claude\logs\roundB-backup.txt"
"driver,previous_start" | Out-File $bak -Encoding utf8
foreach ($d in $drivers) {
    $cur = (Get-CimInstance Win32_SystemDriver -Filter "Name='$d'").StartMode
    if (-not $cur) { "  $d : not found, skip"; continue }
    "$d,$cur" | Add-Content $bak
    sc.exe config $d start= disabled | Out-Null
    "  $d : $cur -> disabled"
}
"Backup saved: $bak"
"Now reboot:  shutdown /r /t 0"
