param(
  [string]$AppPath = ""
)

$ErrorActionPreference = "Stop"

$TaskName = "PreFlight Unlock Gate"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

if ([string]::IsNullOrWhiteSpace($AppPath)) {
  $Candidate = Join-Path $RepoRoot "release\win-unpacked\PreFlight.exe"
  if (Test-Path $Candidate) {
    $AppPath = $Candidate
  }
}

if ([string]::IsNullOrWhiteSpace($AppPath) -or -not (Test-Path $AppPath)) {
  throw "PreFlight.exe was not found. Run npm run package first, or pass -AppPath ""C:\Path\To\PreFlight.exe""."
}

$ResolvedAppPath = (Resolve-Path $AppPath).Path
$User = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$UserId = $User.Name

$Xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Launch PreFlight when the current user unlocks Windows.</Description>
  </RegistrationInfo>
  <Triggers>
    <SessionStateChangeTrigger>
      <Enabled>true</Enabled>
      <StateChange>SessionUnlock</StateChange>
      <UserId>$UserId</UserId>
    </SessionStateChangeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$UserId</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$ResolvedAppPath</Command>
    </Exec>
  </Actions>
</Task>
"@

Register-ScheduledTask -TaskName $TaskName -Xml $Xml -Force | Out-Null
Write-Host "Installed scheduled task '$TaskName' for $UserId."
Write-Host "Action: $ResolvedAppPath"
