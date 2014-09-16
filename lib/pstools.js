var edge = require('edge');

exports.copyFileToRemote = edge.func('ps', function () {/*
  # Create Remote Credential in Powershell 
  $username = $inputFromJS.username
  $passwordSec = cat $inputFromJS.passwordFile | ConvertTo-SecureString
  $cred = New-Object -typename System.Management.Automation.PSCredential -argumentlist $username, $passwordSec

  # Mount remote drive as a Temporary local powershell drive
  $UncPath = '\\' + $inputFromJS.host + '\' + $inputFromJS.destination
  $DriveName = [guid]::NewGuid()
  New-PSDrive -Name $DriveName -PSProvider FileSystem -Root $UncPath -Credential $cred | Out-String

  # Copy files from local source to remote destination
  $destination = '\\' + $inputFromJS.host + '\' + $inputFromJS.destination
  $destination | Out-String
  if ($inputFromJS.sources -ne $Null) {
    ForEach ($source in $inputFromJS.sources) {
      Copy-Item $source -Destination $destination
    }
  } else {
    Copy-Item $inputFromJS.source -Destination $destination
  }
  Remove-PSDrive $DriveName

  Get-ChildItem $destination | Out-String
*/});

exports.execAtRemote = edge.func('ps', function () {/*
  Function Query-RemoteSession
  {
    Param(
      [Parameter(Mandatory=$True)][string] $hosts,
      [Parameter(Mandatory=$True)][string] $username,
      [Parameter(Mandatory=$True)][string] $password
    )

    # Query remote sessions
    $command = "& { .\bin\PsExec.exe $('\\' + $hosts) -u $username -p $password -s qwinsta } > .\data\sessions-${hosts}.txt"
    Start-Process powershell -ArgumentList '-Command', $command -Wait -WindowStyle Minimized

    # Get session id and state
    $sessionSelect = cat .\data\sessions-${hosts}.txt | Select-String "([\w-#]*)\s+${username}\s+(\w+)\s+(\w+)"
    $sessionId = $sessionSelect | Foreach {$_.Matches[0].Groups[2].Value}
    $sessionState = $sessionSelect | Foreach {$_.Matches[0].Groups[3].Value}
    $sessionName = $sessionSelect | Foreach {$_.Matches[0].Groups[1].Value}

    $sessionId; $sessionState; $sessionName
  }

  
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
    wfreerdp /v:28.139.40.15 /u:$username /p:$password -themes -wallpaper -grab-keyboard
    Start-Sleep -s 10
    $sessionId, $sessionState, $sessionName = Query-RemoteSession -hosts $hosts -username $username -password $password
  }

  # Validate session
  if ($sessionId -ne $Null) {
    echo $("Session Id: " + $sessionId)
    echo $("Session State: " + $sessionState)
  } else {
    echo "Error: Could not find existing session nor start a new one."
    exit
  }

  # Disconnect session to prevent user inteference
  if ($sessionState -ne 'Disc') {
    echo $("Disconnecting active session: " + $sessionName)
    psexec \\$hosts -u $username -p $password -i $sessionId -h tsdiscon.exe
  }

  # Execute AutoHotkey script for MT
  echo $("Executing command: " + $inputFromJS.cmd)
  psexec \\$hosts -u $username -p $password -i $sessionId -h $inputFromJS.cmd
*/});
