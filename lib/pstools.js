var edge = require('edge');

exports.copyFileToRemote = edge.func('ps', function () {/*
  # Create Remote Credential in Powershell 
  $username = $inputFromJS.username
  $passwordSec = cat $inputFromJS.passwordFile | ConvertTo-SecureString
  $cred = New-Object -typename System.Management.Automation.PSCredential -argumentlist $username, $passwordSec

  # Mount remote drive as a Temporary local powershell drive
  $UncPath = '\\' + $inputFromJS.host + '\' + $inputFromJS.destination
  $DriveName = [guid]::NewGuid()
  New-PSDrive -Name $DriveName -PSProvider FileSystem -Root $UncPath -Credential $cred | Select-Object Root | Out-String

  # Copy files from local source to remote destination
  if ($inputFromJS.sources -ne $Null) {
    ForEach ($source in $inputFromJS.sources) {
      $localSource = $source
      $remoteDestination = '\\' + $inputFromJS.host + '\' + $inputFromJS.destination
      Copy-Item $localSource -Destination $remoteDestination
    }
  } else {
    $localSource = $inputFromJS.source
    $remoteDestination = '\\' + $inputFromJS.host + '\' + $inputFromJS.destination
    Copy-Item $localSource -Destination $remoteDestination
  }
  Remove-PSDrive $DriveName
*/});

exports.copyFileFromRemote = edge.func('ps', function () {/*
  # Create Remote Credential in Powershell 
  $username = $inputFromJS.username
  $passwordSec = cat $inputFromJS.passwordFile | ConvertTo-SecureString
  $cred = New-Object -typename System.Management.Automation.PSCredential -argumentlist $username, $passwordSec

  # Mount remote drive as a Temporary local powershell drive
  $UncPath = '\\' + $inputFromJS.host + '\' + $inputFromJS.destination
  $DriveName = [guid]::NewGuid()
  New-PSDrive -Name $DriveName -PSProvider FileSystem -Root $UncPath -Credential $cred | Select-Object Root | Out-String

  # Copy files from remote destination to local source
  if ($inputFromJS.sources -ne $Null) {
    ForEach ($source in $inputFromJS.sources) {
      $remoteSource = '\\' + $inputFromJS.host + '\' + $source
      $localDestination = $inputFromJS.destination
      Copy-Item $remoteSource -Destination $localDestination
    }
  } else {
    $remoteSource = '\\' + $inputFromJS.host + '\' + $inputFromJS.source
    $localDestination = $inputFromJS.destination
    Copy-Item $remoteSource -Destination $localDestination
  }
  Remove-PSDrive $DriveName
*/});

exports.execAtRemote = edge.func('ps', function () {/*
  
  function Invoke-Async
  {
    # https://gallery.technet.microsoft.com/scriptcenter/Invoke-Async-Allows-you-to-83b0c9f0
    [CmdletBinding()]
    Param(
      [Parameter(Mandatory=$True)][scriptblock] $scriptBlock,
      [psobject] $in = @{},
      [switch] $wait
    )

    $out = [hashtable]::Synchronized(@{})

    # http://learn-powershell.net/2013/04/19/sharing-variables-and-live-objects-between-powershell-runspaces/
    $runspace = [runspacefactory]::CreateRunspace()
    $runspace.Open()
    # $runspace.SessionStateProxy.SetVariable('in', $in)
    $runspace.SessionStateProxy.SetVariable('out', $out)

    $psThread = [PowerShell]::Create()
    $psThread.Runspace = $runspace
    $Null = $psThread.AddScript($scriptBlock)
    $Null = $psThread.AddParameter('in', $in)

    $asyncRes = $psThread.BeginInvoke()

    if ($wait)
    {
      $Null = $asyncRes.AsyncWaitHandle.WaitOne()
      $Null = $asyncRes.AsyncWaitHandle.Close()

      # This will not work if script is too fast:
      #$Null = Register-ObjectEvent -InputObject $psThread -EventName "InvocationStateChanged" -SourceIdentifier "InvocationStateChanged1"
      #$Null = Wait-Event -SourceIdentifier "InvocationStateChanged1"
    }

    $out; $psThread; $asyncRes
  }

  Function Query-RemoteSession
  {
    Param(
      [Parameter(Mandatory=$True)][string] $hosts,
      [Parameter(Mandatory=$True)][string] $username,
      [Parameter(Mandatory=$True)][string] $password
    )

    # Query remote sessions
    $command = "& { .\bin\PsExec.exe $('\\' + $hosts) -u $username -p $password -s qwinsta } > ${env:TEMP}\pstools-qwinsta-${hosts}.txt"
    Start-Process powershell -ArgumentList '-Command', $command -Wait -WindowStyle Minimized


    # Get session id and state
    $sessionSelect = cat "${env:TEMP}\pstools-qwinsta-${hosts}.txt" | Select-String "([\w-#]*)\s+${username}\s+(\w+)\s+(\w+)"
    $sessionId = $sessionSelect | Foreach {$_.Matches[0].Groups[2].Value}
    $sessionState = $sessionSelect | Foreach {$_.Matches[0].Groups[3].Value}
    $sessionName = $sessionSelect | Foreach {$_.Matches[0].Groups[1].Value}

    $sessionId; $sessionState; $sessionName
  }

  # Temporarily Here
    # Set Path to Binary Tools
    New-Alias psexec .\bin\PsExec -Force
    New-Alias wfreerdp .\bin\wfreerdp -Force

    # Create Remote Credential in Powershell 
    $username = $inputFromJS.username
    $passwordSec = cat $inputFromJS.passwordFile | ConvertTo-SecureString
    $cred = New-Object -typename System.Management.Automation.PSCredential -argumentlist $username, $passwordSec

    # Get Plain Credentials
    $hosts = $inputFromJS.host
    $username = ($cred.GetNetworkCredential()).Username
    $password = ($cred.GetNetworkCredential()).Password

    # Find exisiting remote session
    $sessionId, $sessionState, $sessionName = Query-RemoteSession -hosts $hosts -username $username -password $password
    if ($sessionId -eq $Null) {
      echo $("Starting New Session...")
      psexec \\$hosts -u $username -p $password -s cmd /c 'reg add "hklm\system\currentcontrolset\control\terminal server" /f /v fDenyTSConnections /t REG_DWORD /d 0 && netsh advfirewall firewall set rule group="@FirewallAPI.dll,-28752" new enable=yes'
      wfreerdp /v:$hosts /u:$username /p:$password -themes -wallpaper -grab-keyboard
      Start-Sleep -s 10
      $sessionId, $sessionState, $sessionName = Query-RemoteSession -hosts $hosts -username $username -password $password
      psexec \\$hosts -u $username -p $password -i $sessionId -h tsdiscon.exe
    }

    # Validate session
    if ($sessionId -ne $Null) {
      echo $("Session Id: " + $sessionId)
      echo $("Session State: " + $sessionState)
    } else {
      throw "Error: Could not find existing session nor start a new one."
    }

    # Disconnect session to prevent user inteference
    #if ($sessionState -ne 'Disc') {
    #  echo $("Disconnecting active session: " + $sessionName)
    #  psexec \\$hosts -u $username -p $password -i $sessionId -h tsdiscon.exe
    #}

    # Execute AutoHotkey script for MT
    echo $("Executing command: " + $inputFromJS.cmd)
    echo $("With Parameters: " + $inputFromJS.params)
    $params = $inputFromJS.params | % { '"' + $_ + '"'}
    psexec \\$hosts -u $username -p $password -i $sessionId -h $inputFromJS.cmd (,$params) | Out-String

    # Workaround due to cannot pipe stdout when running interactively
    psexec \\$hosts -u $username -p $password cmd /c type "$($inputFromJS.cmd).log" | Out-String

*/});

