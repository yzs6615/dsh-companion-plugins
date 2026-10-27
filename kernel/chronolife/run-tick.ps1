$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskData = if ($env:BRIDGE_DATA) { $env:BRIDGE_DATA } else { Join-Path $taskRoot 'data' }
$taskLogDir = Join-Path $taskData 'chronolife'
New-Item -ItemType Directory -Force -Path $taskLogDir | Out-Null
Push-Location $taskRoot
try {
  $taskNode = (Get-Command node -ErrorAction Stop).Source
  $taskScript = Join-Path $PSScriptRoot 'worker.mjs'
  $taskProcess = Start-Process -FilePath $taskNode -ArgumentList ('"{0}"' -f $taskScript) -WorkingDirectory $taskRoot -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $taskLogDir 'last-tick.log') -RedirectStandardError (Join-Path $taskLogDir 'last-tick.err')
  exit $taskProcess.ExitCode
} finally { Pop-Location }
