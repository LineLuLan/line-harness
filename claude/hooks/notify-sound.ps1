param([int]$Repeat = 1, [double]$Speed = 1.0)

# Claude Code sound hook. Plays Line's notification MP3 through Windows audio
# (works in Warp or any terminal, independent of terminal bell settings).
# Notification event -> 1 play (waiting for input). Stop event -> repeated plays (task done).
#
# MUST be launched with: powershell -Sta ... (WPF MediaPlayer needs STA + a message
# pump; without them it fails silently. WMP COM hangs at playState 9 in scripts.)
$mp3 = 'D:\04_Assets\dragon-studio-new-notification-3-398649.mp3'

function Pump([int]$ms) {
    $end = [DateTime]::UtcNow.AddMilliseconds($ms)
    while ([DateTime]::UtcNow -lt $end) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 50
    }
}

try {
    if (-not (Test-Path -LiteralPath $mp3)) { throw "sound file missing" }
    Add-Type -AssemblyName PresentationCore
    Add-Type -AssemblyName System.Windows.Forms

    $p = New-Object System.Windows.Media.MediaPlayer
    $p.Open([Uri]$mp3)
    $t = 0
    while (-not $p.NaturalDuration.HasTimeSpan -and $t -lt 100) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 50; $t++
    }
    if (-not $p.NaturalDuration.HasTimeSpan) { throw "media never loaded" }

    $durMs = [int]$p.NaturalDuration.TimeSpan.TotalMilliseconds
    $p.Volume = 1.0
    # Do NOT set SpeedRatio: WPF MediaPlayer mutes audio at rates other than 1.0
    # (confirmed on this machine 2026-08-09). $Speed is kept for compatibility and
    # only tightens the gap between repeats.
    $gapMs = if ($Speed -gt 1.0) { 30 } else { 150 }
    $playMs = $durMs + $gapMs

    for ($i = 0; $i -lt $Repeat; $i++) {
        $p.Position = [TimeSpan]::Zero
        $p.Play()
        Pump $playMs
    }
    $p.Close()
} catch {
    # Fallback: plain beeps if the MP3 is missing or playback init fails
    for ($i = 0; $i -lt $Repeat; $i++) {
        try { [console]::beep(880, 200); [console]::beep(1175, 280) } catch {}
        Start-Sleep -Milliseconds 200
    }
}
exit 0
