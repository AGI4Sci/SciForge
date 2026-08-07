param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Excel", "Word")]
    [string]$App
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$processName = if ($App -eq "Excel") { "EXCEL" } else { "WINWORD" }
$beforePids = @(Get-Process -Name $processName -ErrorAction SilentlyContinue | ForEach-Object Id)
if ($beforePids.Count -gt 0) {
    throw "$processName already has active processes; refusing to touch user documents"
}

$application = $null
$document = $null
try {
    if ($App -eq "Excel") {
        $application = New-Object -ComObject Excel.Application
        $application.DisplayAlerts = $false
        $document = $application.Workbooks.Add()
    }
    else {
        $application = New-Object -ComObject Word.Application
        $application.DisplayAlerts = 0
        $document = $application.Documents.Add()
    }
    $application.Visible = $true
    Start-Sleep -Seconds 3

    $owned = @(
        Get-Process -Name $processName -ErrorAction Stop |
            Where-Object { $_.Id -notin $beforePids }
    )
    if ($owned.Count -ne 1) {
        throw "expected one test-owned $processName process, found $($owned.Count)"
    }
    $process = $owned[0]
    @{
        app = $App
        pid = $process.Id
        hwnd = [long]$process.MainWindowHandle
        executablePath = $process.Path
        creationTimeFileTime = $process.StartTime.ToUniversalTime().ToFileTimeUtc()
    } | ConvertTo-Json -Compress | Write-Output
    [Console]::Out.Flush()

    $command = [Console]::In.ReadLine()
    if ($command -ne "shutdown") {
        throw "unexpected host command: $command"
    }
}
finally {
    if ($document -ne $null) {
        try {
            if ($App -eq "Excel") { $document.Close($false) }
            else { $document.Close(0) }
        }
        catch {}
    }
    if ($application -ne $null) {
        try {
            if ($App -eq "Excel") { $application.Quit() }
            else { $application.Quit(0) }
        }
        catch {}
    }
    if ($document -ne $null) {
        try { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) }
        catch {}
    }
    if ($application -ne $null) {
        try { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($application) }
        catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
