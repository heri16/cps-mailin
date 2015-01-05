var edge = require('edge');
var test2 = edge.func('ps', function () {/*

  function Invoke-Executable {
    # Runs the specified executable and captures its exit code, stdout
    # and stderr.
    # Returns: custom object.
    param(
        [Parameter(Mandatory=$true)]
        [ValidateNotNullOrEmpty()]
        [String]$sExeFile,
        [Parameter(Mandatory=$false)]
        [String[]]$cArgs,
        [Parameter(Mandatory=$false)]
        [String]$sVerb
    )

    # Setting process invocation parameters.
    $oPsi = New-Object -TypeName System.Diagnostics.ProcessStartInfo
    $oPsi.CreateNoWindow = $true
    $oPsi.UseShellExecute = $false
    $oPsi.RedirectStandardOutput = $true
    $oPsi.RedirectStandardError = $true
    $oPsi.FileName = $sExeFile
    if (! [String]::IsNullOrEmpty($cArgs)) {
        $oPsi.Arguments = $cArgs
    }
    if (! [String]::IsNullOrEmpty($sVerb)) {
        $oPsi.Verb = $sVerb
    }

    # Creating process object.
    $oProcess = New-Object -TypeName System.Diagnostics.Process
    $oProcess.StartInfo = $oPsi
    $oProcess.EnableRaisingEvents = $true

    # Creating string builders to store stdout and stderr.
    $oStdOutBuilder = New-Object -TypeName System.Text.StringBuilder
    $oStdErrBuilder = New-Object -TypeName System.Text.StringBuilder

    # Adding event handers for stdout and stderr.
    $sScripBlock = {
        if (! [String]::IsNullOrEmpty($EventArgs.Data)) {
            $Event.MessageData.AppendLine($EventArgs.Data)
            $EventArgs.Data | Tee-Object -FilePath test.log -Append
        }
    }
    $oStdOutEvent = Register-ObjectEvent -InputObject $oProcess `
        -Action $sScripBlock -EventName 'OutputDataReceived' `
        -MessageData $oStdOutBuilder
    $oStdErrEvent = Register-ObjectEvent -InputObject $oProcess `
        -Action $sScripBlock -EventName 'ErrorDataReceived' `
        -MessageData $oStdErrBuilder

    # Starting process.
    [Void]$oProcess.Start()
    $oProcess.BeginOutputReadLine()
    $oProcess.BeginErrorReadLine()
    [Void]$oProcess.WaitForExit()

    # Unregistering events to retrieve process output.
    Unregister-Event -SourceIdentifier $oStdOutEvent.Name
    Unregister-Event -SourceIdentifier $oStdErrEvent.Name

    $oResult = New-Object -TypeName PSObject -Property ([Ordered]@{
        "ExeFile"  = $sExeFile;
        "Args"     = $cArgs -join " ";
        "ExitCode" = $oProcess.ExitCode;
        "StdOut"   = $oStdOutBuilder.ToString().Trim();
        "StdErr"   = $oStdErrBuilder.ToString().Trim()
    })

    return $oResult
  }

  # $oResult = Invoke-Executable -sExeFile ".\\bin\\paexec.exe" -cArgs @("-accepteula", "\\30.139.40.15", "-u", "Mailin", "-p", "ridNuoAsyik@1", "-s", "C:\Windows\Sysnative\cmd.exe", "/c", "type D:\RENE\XmlImport\ReneXmlImport.exe.log")
  #$oResult = Invoke-Executable -sExeFile ".\\bin\\paexec.exe" -cArgs @("-accepteula", "\\30.139.40.15", "-u", "Mailin", "-p", "ridNuoAsyik@1", "-s", "C:\Windows\Sysnative\cmd.exe", "/c", "qwinsta")  
  #$oResult = Invoke-Executable -sExeFile ".\\bin\\paexec.exe" -cArgs @("-accepteula", "\\30.139.40.15", "-u", "Mailin", "-p", "ridNuoAsyik@1", "-s", "C:\Windows\Sysnative\qwinsta.exe")  
  #$oResult.StdOut

  & .\bin\PaExec.exe -accepteula \\30.139.40.15 -u Mailin -p ridNuoAsyik@1 -s "C:\Windows\Sysnative\qwinsta.exe" | Tee-Object -Variable arr
  $arr
  
*/});

var test = edge.func('ps', function () {/*

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

  $out, $psThread, $asyncRes = Invoke-Async -Wait -In $inputFromJS -ScriptBlock {
    param($in)

    $out.test = "OK"
    echo "OK"

    $hosts = $in.host
    $username = $in.username
    $password = $in.password

    # & { ping localhost } *>&1 | Tee-Object -Variable arr
    # & .\bin\PaExec.exe -accepteula \\30.139.40.15 -u Mailin -p ridNuoAsyik@1 -s "C:\Windows\Sysnative\qwinsta.exe" | Tee-Object -Variable arr | Tee-Object -FilePath test.log -Append
    & .\bin\PaExec.exe -accepteula \\$hosts -u $username -p $password cmd /c type D:\RENE\XmlImport\ReneXmlImport.exe.log | Tee-Object -Variable arr
    $out.result = [array]::AsReadOnly($arr)
    Break

    $username = "Kasir"
    $sessionSelect = $out.result | Select-String "([\w-#]*)\s+${username}\s+(\w+)\s+(\w+)"
    $out.sessionId = $sessionSelect | Foreach {$_.Matches[0].Groups[2].Value}
    $out.sessionState = $sessionSelect | Foreach {$_.Matches[0].Groups[3].Value}
    $out.sessionName = $sessionSelect | Foreach {$_.Matches[0].Groups[1].Value}
  }

  $out
  
*/});

test({
    host: "30.139.40.15",
    username: "Mailin",
    passwordFile: "data\\3001.pem",
    password: "ridNuoAsyik@1"
  }, function(err, res) {
  if (err) console.log(err);
  console.dir(res);
});