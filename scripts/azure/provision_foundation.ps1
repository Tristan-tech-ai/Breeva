# Breeva $0-Azure — Phase 0 foundation provisioner (idempotent, single region southeastasia).
# Thesis: "free tier as architecture, not a coupon." PAYG has NO spending cap (budgets only NOTIFY),
# so $0 comes from SERVICE SELECTION: always-free / scale-to-zero / hard-stop + tiny actual volume.
# Hard rules: NO ACR, NO ML Managed Online Endpoint, NO VNet/Private Endpoint, NO idle public IP, NO GPU SKU.
# az is installed at the path below but not on the non-interactive PATH -> invoke the full path.
# Re-runnable: each step is create-if-absent. Verified live 2026-06-02 (resources already exist).

$ErrorActionPreference = "Stop"
$az  = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
$RG  = "breeva-rg"
$LOC = "southeastasia"
$SA  = "breevavlhe85ce725856e"   # reused StorageV2 acct (was the Valhalla tiles store)

# 0. CLEANUP — delete the redundant Valhalla tiles file share (the only billing item; tiles live
#    locally at D:\breeva-valhalla\valhalla_tiles now that routing is local). DONE 2026-06-02.
& $az storage share-rm delete --storage-account $SA -g $RG -n valhalla-tiles --yes 2>$null

# 1. Log Analytics workspace + HARD daily cap (runaway guard; actual volume is KB-MB/day << cap).
& $az monitor log-analytics workspace create -g $RG -n breeva-logs -l $LOC --only-show-errors
& $az resource update -g $RG -n breeva-logs --resource-type Microsoft.OperationalInsights/workspaces `
    --set properties.workspaceCapping.dailyQuotaGb=0.1 --only-show-errors

# 2. Workspace-based Application Insights (distributed tracing target; first 5 GB/mo free + the cap).
$wsid = (& $az monitor log-analytics workspace show -g $RG -n breeva-logs --query id -o tsv)
& $az extension add -n application-insights --only-show-errors 2>$null
& $az monitor app-insights component create -g $RG -a breeva-insights -l $LOC `
    --workspace "$wsid" --application-type web --only-show-errors

# 3. Container Apps Consumption environment (min-replicas=0 workers => $0 idle; platform logs off).
& $az extension add -n containerapp --only-show-errors 2>$null
& $az containerapp env create -g $RG -n breeva-aca-env -l $LOC --logs-destination none --only-show-errors

# 4. Blob container for versioned ONNX model artifacts (<<5 GB free; reuse the existing acct).
$key = (& $az storage account keys list -g $RG -n $SA --query "[0].value" -o tsv)
& $az storage container create --account-name $SA --account-key "$key" -n ml-artifacts --only-show-errors

# 5. KeyVault provider (AML auto-creates a KV; sub-cent ops). Registered async in Phase 0.
& $az provider register -n Microsoft.KeyVault --only-show-errors

Write-Host "Foundation provisioned. Verify:"
& $az resource list -g $RG --query "[].{name:name,type:type}" -o table

# ── DEFERRED / USER actions (documented; not run here) ───────────────────────────────────────────
# - ADX FREE cluster (the spatiotemporal-AQI centerpiece): claim in a browser at
#     https://dataexplorer.azure.com/freecluster  (Microsoft account; separate $0 entity, NOT in this sub).
# - AML workspace (Task 11): after KeyVault registers ->
#     az ml workspace create -g breeva-rg -n breeva-aml --application-insights <breeva-insights id>
#     (decline ACR; reuse breeva-insights + $SA; auto-creates a KeyVault). NO Managed Online Endpoint.
# - $0.01 budget + cost-anomaly alert (defense-in-depth tripwire): Azure Portal > Cost Management >
#     Budgets (subscription scope, amount 0.01, alert 50/80/100%). CLI budget create is unreliable.
# - Static Web Apps (Task 14): created via the GitHub Actions deploy of the dashboard app.
