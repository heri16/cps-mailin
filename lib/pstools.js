var edge = require('edge');

exports.copyFileToRemote = edge.func('ps', function () {/*
  Set-StrictMode -Version 2.0
  $ErrorActionPreference = "Stop"

  try
  {
    # Create Remote Credential in Powershell 
    $username = $inputFromJS.username
    $passwordSec = cat $inputFromJS.passwordFile | ConvertTo-SecureString
    $cred = New-Object -typename System.Management.Automation.PSCredential -argumentlist ($username, $passwordSec)

    # Copy files from local source to remote destination
    if (($inputFromJS.sources -is [string]) -Or ($inputFromJS.sources -is [array])) {
      $localSources = $inputFromJS.sources
      $destination = $inputFromJS.destination | ForEach-Object { Join-Path -Path ((Split-Path $_ -Qualifier).ToLower().Replace(':', '$')) -ChildPath (Split-Path $_ -NoQualifier) }
      $remoteDestination = Join-Path -Path ('\\' + $inputFromJS.computerName) -ChildPath $destination

      ForEach ($localSource in $localSources) {      
        $UncPath = Split-Path $remoteDestination -Parent
        $DriveName = $Null
        if (-not(Test-Path "FileSystem::$UncPath")) {
          $DriveName = [guid]::NewGuid()
          New-PSDrive -Name $DriveName -PSProvider FileSystem -Root $UncPath -Credential $cred | Select-Object Root | Out-String
        }

        Copy-Item $localSource -Destination $remoteDestination
        if ($DriveName -ne $Null) { Remove-PSDrive $DriveName -ErrorAction SilentlyContinue }
      }

    } else {
      throw "Please specify sources"
    }
  }
  catch
  {
    throw $_.Exception
  }

*/});

exports.copyFileFromRemote = edge.func('ps', function () {/*
  Set-StrictMode -Version 2.0
  $ErrorActionPreference = "Stop"

  try
  {
    # Create Remote Credential in Powershell 
    $username = $inputFromJS.username
    $passwordSec = cat $inputFromJS.passwordFile | ConvertTo-SecureString
    $cred = New-Object -typename System.Management.Automation.PSCredential -argumentlist ($username, $passwordSec)

    # Copy files from remote destination to local source
    if (($inputFromJS.sources -is [string]) -Or ($inputFromJS.sources -is [array])) {
      $sources = $inputFromJS.sources | ForEach-Object { Join-Path -Path ((Split-Path $_ -Qualifier).ToLower().Replace(':', '$')) -ChildPath (Split-Path $_ -NoQualifier) }
      $remoteSources = $sources | ForEach-Object { Join-Path -Path ('\\' + $inputFromJS.computerName) -ChildPath $_ }
      $localDestination = $inputFromJS.destination

      ForEach ($remoteSource in $remoteSources) {
        $UncPath = Split-Path $remoteSource -Parent
        $DriveName = $Null
        if (-not(Test-Path "FileSystem::$UncPath")) {
          $DriveName = [guid]::NewGuid()
          New-PSDrive -Name $DriveName -PSProvider FileSystem -Root $UncPath -Credential $cred | Select-Object Root | Out-String
        }

        Copy-Item $remoteSource -Destination $localDestination
        if ($DriveName -ne $Null) { Remove-PSDrive $DriveName -ErrorAction SilentlyContinue }
      }

    } else {
      throw "Please specify sources"
    }
  }
  catch
  {
    throw $_.Exception
  }

*/});

exports.enablePowershellRemoting = edge.func('ps', function () {/*
  Set-StrictMode -Version 2.0
  $ErrorActionPreference = "Stop"

  function Test-PsRemoting {
    param (
      [Parameter(Mandatory = $True)] $computername,
      [Parameter(Mandatory = $False)] $credential
    )
         
    try {
      $ErrorActionPreference = "Stop"
      $result = Invoke-Command -ComputerName $computername -Credential $credential { 1 }
    } catch {
      Write-Verbose $_
      return $false
    }
         
    ## I’ve never seen this happen, but if you want to be
    ## thorough….
    if ($result -ne 1) {
      Write-Verbose "Remoting to $computername returned an unexpected result."
      return $false
    }

    $true
  }

  try
  {
    Start-Process .\bin\psexec.exe -ArgumentList ('-accepteula') -Wait -WindowStyle Minimized

    # Create Remote Credential in Powershell
    $computerNames = $inputFromJS.computerName 
    $username = $inputFromJS.username
    $passwordSec = Get-Content $inputFromJS.passwordFile | ConvertTo-SecureString
    $cred = New-Object -typename System.Management.Automation.PSCredential -argumentlist ($username, $passwordSec)

    # Get Plain Credentials for fallback
    $username = ($cred.GetNetworkCredential()).Username
    $password = ($cred.GetNetworkCredential()).Password

    if (Test-PsRemoting -ComputerName $computerNames -Credential $cred) {
      Write-Warning "Remoting already enabled on $computerNames"
    } else {
      Write-Verbose "Attempting to enable remoting on $computerNames..."

      $p = Start-Process .\bin\psexec.exe -ArgumentList ("\\$computerNames", '-u', $username, '-p', $password, '-s', 'powershell.exe', '-Command', '"& {Enable-PSRemoting -SkipNetworkProfileCheck -Force; if($?) { Set-ItemProperty –Path HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System –Name ConsentPromptBehaviorAdmin –Value 0 –Type DWord } }"') -PassThru -WindowStyle Minimized
      if (-Not $?) {
        throw "PS Remoting was not enabled. StatusCode: $?"
      }
      $p.WaitForExit()
      if ($p.ExitCode -ne 0) {
        throw "PSRemoting was not enabled correctly. ExitCode: $($p.ExitCode)"
      }
    }
  }
  catch
  {
    throw $_.Exception
  }

*/});

exports.execAtRemote = edge.func('ps', function () {/*
  Set-StrictMode -Version 2.0
  $ErrorActionPreference = "Stop"

  get-pssession | remove-pssession

  Function Query-RemoteSession
  {
    [CmdletBinding()]

    Param(
      [Parameter(Mandatory=$True)][string] $computerNames,
      [Parameter(Mandatory=$False)][string] $username,
      [Parameter(Mandatory=$False)][string] $password,
      [Parameter(Mandatory=$False)] $psSession
    )

    # Query remote winlogon sessions
    $qwinstaOutput = Invoke-Command -Session $psSession -ScriptBlock { qwinsta.exe }
    if ($?) {
      $rExitCode = Invoke-Command -Session $psSession -ScriptBlock { $LastExitCode }
      if ($rExitCode -ne 0) {
        throw "Could not correctly query for interactive winlogon sessions on remote host. ExitCode: $($rExitCode)"
      }
    } else {
      $command = "& { .\bin\psexec.exe $('\\' + $computerNames) -u $username -p $password -s qwinsta.exe } > ${env:TEMP}\pstools-qwinsta-${hosts}.txt"
      $p = Start-Process powershell.exe -ArgumentList ('-Command', $command) -PassThru -WindowStyle Minimized
      if (-Not $?) {
        throw "Could not query for interactive winlogon sessions on remote host. StatusCode: $?"
      }
      $p.WaitForExit()
      if ($p.ExitCode -ne 0) {
        throw "Could not correctly query for interactive winlogon sessions on remote host. ExitCode: $($p.ExitCode)"
      }
      $qwinstaOutput = Get-Content "${env:TEMP}\pstools-qwinsta-${hosts}.txt"
    }

    $qwinstaOutput
  }

  Function Parse-RemoteSession
  {
    Param(
      [Parameter(Mandatory=$True, ValueFromPipeline=$True)][string] $qwinstaOutput
    )

    Process {
      # Get session id and state
      $sessionSelect = $qwinstaOutput | Select-String "([\w-#]*)\s+${username}\s+(\w+)\s+(\w+)"
      $sessionId = $sessionSelect | Foreach {$_.Matches[0].Groups[2].Value}
      $sessionState = $sessionSelect | Foreach {$_.Matches[0].Groups[3].Value}
      $sessionName = $sessionSelect | Foreach {$_.Matches[0].Groups[1].Value}

      $sessionId; $sessionState; $sessionName
    }
  }


  try
  {
    # Declare Finally Variables here
    $psSession = $Null

    # Set Path to Binary Tools
    # New-Alias wfreerdp .\bin\wfreerdp -Force
    Start-Process .\bin\psexec.exe -ArgumentList ('-accepteula') -Wait -WindowStyle Minimized

    # Create Remote Credential in Powershell
    $computerNames = $inputFromJS.computerName
    $username = $inputFromJS.username
    $passwordSec = Get-Content $inputFromJS.passwordFile | ConvertTo-SecureString
    $cred = New-Object -typename System.Management.Automation.PSCredential -argumentlist ($username, $passwordSec)

    # Remote PSSession for high-speed invoke
    $psSession = New-PSSession -ComputerName $computerNames -Credential $cred

    # Get Plain Credentials for fallback
    $username = ($cred.GetNetworkCredential()).Username
    $password = ($cred.GetNetworkCredential()).Password
    
    # Find exisiting remote session
    #$sessionId, $sessionState, $sessionName = Query-RemoteSession -hosts $computerNames -username $username -password $password -psSession $psSession | Parse-RemoteSession
    $sessionId, $sessionState, $sessionName = Invoke-Command -Session $psSession -ScriptBlock { qwinsta.exe } | Parse-RemoteSession
    if ($sessionId -eq $Null) {
      echo $("Starting New Interactive Terminal Session...")

      Invoke-Command -Session $psSession -ScriptBlock { Set-ItemProperty –Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' –Name fDenyTSConnections –Value 0 –Type DWord; if($?) { Enable-NetFirewallRule –Group "@FirewallAPI.dll,-28752" } }
      if ($?) {
        $rExitCode = Invoke-Command -Session $psSession -ScriptBlock { $LastExitCode }
        if ($rExitCode -ne 0) {
          throw "RDP Terminal service was not enabled correctly. ExitCode: $($rExitCode)"
        }
      } else {
        $p = Start-Process .\bin\psexec.exe -ArgumentList ("\\$computerNames", '-u', $username, '-p', $password, '-s', 'cmd', '/c', 'reg add "HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server" /f /v fDenyTSConnections /t REG_DWORD /d 0 && netsh advfirewall firewall set rule group="@FirewallAPI.dll,-28752" new enable=yes') -PassThru -WindowStyle Minimized
        if (-Not $?) {
          throw "RDP Terminal service was not enabled. StatusCode: $?"
        }
        $p.WaitForExit()
        if ($p.ExitCode -ne 0) {
          throw "RDP Terminal service was not enabled correctly. ExitCode: $($p.ExitCode)"
        }
      }

      $p = Start-Process .\bin\wfreerdp.exe -ArgumentList ("/v:$computerNames", "/u:$username", "/p:$password", '-themes', '-wallpaper', '-grab-keyboard') -PassThru -WindowStyle Minimized
      if (-Not $?) {
        throw "RDP Terminal session was not created. StatusCode: $?"
      }

      Start-Sleep -s 10
      #$sessionId, $sessionState, $sessionName = Query-RemoteSession -hosts $computerNames -username $username -password $password -psSession $psSession
      $sessionId, $sessionState, $sessionName = Invoke-Command -Session $psSession -ScriptBlock { qwinsta.exe } | Parse-RemoteSession
      $p.CloseMainWindow()
      $p.WaitForExit(2000)
      if (-Not $p.HasExited) {
        $p.Kill()
        $p.WaitForExit()
      }

    }

    # Validate session
    if ($sessionId -ne $Null) {
      echo $("Session Id: " + $sessionId)
      echo $("Session State: " + $sessionState)
    } else {
      throw "Could not find an existing RDP Terminal session nor start a new one."
    }

    # Disconnect session to prevent user inteference
    if ($sessionState -ne 'Disc') {
      #echo $("Disconnecting active session: " + $sessionName)

      #Invoke-Command -Session $psSession -ScriptBlock { if (Get-Command psexec.exe -ErrorAction SilentlyContinue) { psexec.exe -accepteula \\$using:computerNames -u $using:username -p $using:password -i $using:sessionId -h tsdiscon.exe 2>&1 | %{ "$_" } } }
      #if ($?) {
      #  $rExitCode = Invoke-Command -Session $psSession -ScriptBlock { $LastExitCode }
      #  if ($rExitCode -ne 0) {
      #    throw "Active RDP Rerminal session was not disconnected correctly. ExitCode: $($rExitCode)"
      #  }
      #} else {
      #  $p = Start-Process .\bin\psexec.exe -ArgumentList ("\\$computerNames", '-u', $username, '-p', $password, '-i', $sessionId, '-h', 'tsdiscon.exe') -PassThru -WindowStyle Minimized
      #  if (-Not $?) {
      #    throw "Active RDP Terminal session was not disconnected. StatusCode: $?"
      #  }
      #  $p.WaitForExit()
      #  if ($p.ExitCode -ne 0) {
      #    throw "Active RDP Rerminal session was not disconnected correctly. ExitCode: $($p.ExitCode)"
      #  }
      #}
    }

    # Execute AutoHotkey script for MT
    echo $("Executing command: " + $inputFromJS.cmd)
    echo $("With Parameters: " + $inputFromJS.params)
    $params = $inputFromJS.params | % { '"' + $_ + '"'}
    $argumentList = "\\$computerNames", '-u', $username, '-p', $password, '-i', $sessionId, '-h', $inputFromJS.cmd

    # http://stackoverflow.com/questions/10666101/powershell-lastexitcode-0-but-false-redirecting-stderr-to-stdout-gives-nat/
    Invoke-Command -Session $psSession -ScriptBlock { if (Get-Command psexec.exe -ErrorAction SilentlyContinue) { psexec.exe -accepteula ($using:argumentList + $using:params) 2>&1 | %{ "$_" } } }
    if ($?) {
      $rExitCode = Invoke-Command -Session $psSession -ScriptBlock { $LastExitCode }
      if ($rExitCode -ne 0) {
        throw "Remote executable ran but did not execute correctly. ExitCode: $($rExitCode)"
      }
    } else {
      # http://stackoverflow.com/questions/10262231/obtaining-exitcode-using-start-process-and-waitforexit-instead-of-wait
      $p = Start-Process .\bin\psexec.exe -ArgumentList ($argumentList + $params) -PassThru -WindowStyle Minimized
      if (-Not $?) {
        throw "Remote executable did not execute. StatusCode: $?"
      }
      $p.WaitForExit()
      if ($p.ExitCode -ne 0) {
        throw "Remote executable ran but did not execute correctly. ExitCode: $($p.ExitCode)"
      }
    }

  }
  catch
  {
    throw $_.Exception
  }
  finally {
    if ($psSession) { Remove-PSSession $psSession }
  }

*/});

