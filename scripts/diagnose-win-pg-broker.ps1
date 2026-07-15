# FNXC:WindowsDesktopPackaging 2026-07-14-20:55:
# Broker C diagnostic (throwaway). Tests the likely fix mechanism: launch
# postgres.exe as a freshly-created NON-ADMIN local user via Start-Process
# -Credential (CreateProcessWithLogonW), which needs no "Logon as a batch
# job" privilege (the thing that blocked the schtasks approach). Everything
# is staged under a traversable C:\ root so the new user can reach the binary
# and data dir (runneradmin's profile / the repo checkout are not traversable
# by an arbitrary new user). Captures postgres stderr so we can confirm a boot.
$ErrorActionPreference = 'Continue'
function Log($m) { Write-Host "[brokerC] $m" }

# locate source native root
$pg = Get-ChildItem -Path node_modules/.pnpm -Filter postgres.exe -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match 'embedded-postgres\+windows-x64@' } |
  Select-Object -First 1
$srcNative = Split-Path (Split-Path $pg.FullName -Parent) -Parent # .../native
$srcBin = Join-Path $srcNative 'bin'
$initdbExe = Join-Path $srcBin 'initdb.exe'
Log "source native=$srcNative"

# stage under a traversable C:\ root
$root = "C:\pgdiag$(Get-Random)"
$native = Join-Path $root 'native'
$data = Join-Path $root 'data'
New-Item -ItemType Directory -Path $root -Force | Out-Null
Copy-Item -Path $srcNative -Destination $native -Recurse
$binLocal = Join-Path $native 'bin'
$pgExe = Join-Path $binLocal 'postgres.exe'
New-Item -ItemType Directory -Path $data -Force | Out-Null
& $initdbExe -D $data -A trust -U postgres --no-instructions 2>&1 | Out-Null
Log "initdb ok; data=$data"

# create a NON-admin local user
$user = "pgu$(Get-Random)"
# FNXC:WindowsDesktopPackaging 2026-07-14-21:05:
# The password must NOT contain any token of the username (e.g. the random
# number). Windows password complexity rejects a password that contains the
# account name; net user then re-prompts non-interactively ("No valid response
# was provided") and creates NOTHING, which made Start-Process -Credential
# fail downstream with "user name or password is incorrect" — a false negative
# unrelated to whether the dedicated-user mechanism actually boots postgres.
$pass = "Fx9!qW2v#kP7mZ4"
$createOut = net user $user $pass /add /y 2>&1
Log "net user /add exit=$LASTEXITCODE out=$($createOut -join ' | ')"
icacls $root /grant "${user}:(OI)(CI)F" | Out-Null
Log "granted $user (OI)(CI)F on $root"

$port = 57291
$outLog = Join-Path $root 'pg.log'
$bat = Join-Path $root 'run.bat'
@"
@echo off
set "TMP=$root"
set "TEMP=$root"
"$pgExe" -D "$data" -p $port > "$outLog" 2>&1
"@ | Set-Content -Path $bat -Encoding ASCII

$sec = ConvertTo-SecureString $pass -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\$user", $sec)
Log "Start-Process -Credential as $env:COMPUTERNAME\$user ..."
$proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $bat -Credential $cred -WindowStyle Hidden -PassThru
Log "launched pid=$($proc.Id)"

$up = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $ar = $c.BeginConnect('127.0.0.1', $port, $null, $null)
    if ($ar.AsyncWaitHandle.WaitOne(400) -and $c.Connected) { $up = $true }
    $c.Close()
  } catch {}
  if ($up) { break }
}
Log "port $port open (postgres booted): $up"
Start-Sleep -Milliseconds 800
if (Test-Path $outLog) {
  Log "---- pg.log ----"
  Get-Content $outLog -Raw | Out-Host
  Log "---- end ----"
} else { Log "(no pg.log produced)" }

Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
net user $user /delete | Out-Null
Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
Log "DONE up=$up"
