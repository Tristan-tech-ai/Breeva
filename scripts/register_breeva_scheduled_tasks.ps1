# Tier 3 Phase 3.6 + 3.0b — Windows Task Scheduler registration.
#
# Registers four tasks:
#   1. Breeva-Station-Snapshots-Hourly  — vayu/jobs/snapshot_stations.py  (every hour)
#   2. Breeva-GCN-Precompute-Nightly    — vayu/ml/precompute_gcn.py       (daily 02:00 WIB)
#   3. Breeva-GCN-Retrain-Weekly        — vayu/ml/train_gcn.py            (Sun 03:00 WIB, warm-start)
#   4. Breeva-Graph-Export-Daily        — vayu/jobs/export_graph_snapshot.py (daily 01:30 WIB)
#
# Run from an elevated PowerShell. Re-running is idempotent (Register-ScheduledTask -Force).

$repo = "C:\Users\Tristan\Downloads\breeva"
$py = "$repo\vayu\.venv\Scripts\python.exe"

if (-not (Test-Path $py)) {
  Write-Error "Python venv not found at $py — run: python -m venv vayu/.venv && pip install -r vayu/requirements.txt"
  exit 1
}

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$longSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6) `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 15)
$shortSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)

# 1. Hourly station snapshot
$snapAction = New-ScheduledTaskAction -Execute $py `
  -Argument "vayu/jobs/snapshot_stations.py" -WorkingDirectory $repo
$snapTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date "00:15") `
  -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 1825)
Register-ScheduledTask -TaskName "Breeva-Station-Snapshots-Hourly" `
  -Action $snapAction -Trigger $snapTrigger -Principal $principal -Settings $shortSettings `
  -Description "Tier 3 Phase 3.0b: hourly WAQI + IQAir poller -> station_snapshots + attach_station_ground_truth()" `
  -Force | Out-Null

# 2. Nightly precompute 02:00 WIB
$precomputeAction = New-ScheduledTaskAction -Execute $py `
  -Argument "vayu/ml/precompute_gcn.py" -WorkingDirectory $repo
$precomputeTrigger = New-ScheduledTaskTrigger -Daily -At 02:00
Register-ScheduledTask -TaskName "Breeva-GCN-Precompute-Nightly" `
  -Action $precomputeAction -Trigger $precomputeTrigger -Principal $principal -Settings $longSettings `
  -Description "Tier 3 Phase 3.6: nightly precompute of 24-hour GCN predictions per road" `
  -Force | Out-Null

# 3. Weekly GCN retrain Sunday 03:00 WIB (warm-start from latest checkpoint)
$retrainAction = New-ScheduledTaskAction -Execute $py `
  -Argument "vayu/ml/train_gcn.py --epochs 30 --batch-size 4096 --warm-start D:/breeva-ml-models/gcn/best.pt" `
  -WorkingDirectory $repo
$retrainTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 03:00
Register-ScheduledTask -TaskName "Breeva-GCN-Retrain-Weekly" `
  -Action $retrainAction -Trigger $retrainTrigger -Principal $principal -Settings $longSettings `
  -Description "Tier 3 Phase 3.6: weekly GraphSAGE retrain with warm-start from previous best" `
  -Force | Out-Null

# 4. Daily parquet export 01:30 WIB (refresh MV + dump fresh graph snapshot for next day's training)
$exportAction = New-ScheduledTaskAction -Execute $py `
  -Argument "vayu/jobs/export_graph_snapshot.py --refresh-mv" -WorkingDirectory $repo
$exportTrigger = New-ScheduledTaskTrigger -Daily -At 01:30
Register-ScheduledTask -TaskName "Breeva-Graph-Export-Daily" `
  -Action $exportAction -Trigger $exportTrigger -Principal $principal -Settings $shortSettings `
  -Description "Tier 3 Phase 3.0.3: nightly REFRESH mv_road_graph_nodes + parquet export to D:/breeva-ml-data/graph/" `
  -Force | Out-Null

# 5. Tier 4 Phase 4.5 — drift monitor, daily 06:00 WIB
$driftAction = New-ScheduledTaskAction -Execute $py `
  -Argument "vayu/ml/drift_monitor.py" -WorkingDirectory $repo
$driftTrigger = New-ScheduledTaskTrigger -Daily -At 06:00
Register-ScheduledTask -TaskName "Breeva-Drift-Monitor-Daily" `
  -Action $driftAction -Trigger $driftTrigger -Principal $principal -Settings $shortSettings `
  -Description "Tier 4 Phase 4.5: per-region MAE + PI95 drift alerting against active GCN" `
  -Force | Out-Null

# 6. Tier 4 Phase 4.2 — shadow promote/demote, daily 07:00 WIB
$promoteAction = New-ScheduledTaskAction -Execute $py `
  -Argument "vayu/ml/promote_shadow.py --model-name gcn_road" -WorkingDirectory $repo
$promoteTrigger = New-ScheduledTaskTrigger -Daily -At 07:00
Register-ScheduledTask -TaskName "Breeva-Shadow-Promote-Daily" `
  -Action $promoteAction -Trigger $promoteTrigger -Principal $principal -Settings $shortSettings `
  -Description "Tier 4 Phase 4.2: champion/challenger gate for shadow gcn_road model" `
  -Force | Out-Null

Get-ScheduledTask | Where-Object { $_.TaskName -like "Breeva-*" } | Select-Object TaskName, State
Write-Host "Registered 6 Tier 3/4 scheduled tasks. Run Get-ScheduledTaskInfo <name> to see next run time."
