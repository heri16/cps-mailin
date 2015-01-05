var edge = require('edge');

exports.execAtRemote = edge.func('ps', function () {/*
  $params = $inputFromJS.params | % { '"' + $_ + '"'}
  # .\bin\psexec \\10.0.5.115 -u Mailin -p ridNuoAsyik@1 -i 5 -h $inputFromJS.cmd (,$params) | Out-String
  .\bin\psexec \\10.0.5.115 -u Mailin -p ridNuoAsyik@1 cmd /c type "$($inputFromJS.cmd).log" | Write-Output
*/});

var payload = { cmd: "C:\\Accurate\\AccXmlExportImport.exe", params: ['10.0.4.10', 'D:\\JAKARTA.GDB', '-i', 'C:\\Accurate\\Data\\Import\\Master_Item_3001.xml'] };
console.dir(payload);
exports.execAtRemote(payload, function(err, res) {
  console.log(err);
  console.log(res);
});