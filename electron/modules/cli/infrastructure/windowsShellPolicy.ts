/** Explicit capabilities for the host shell, independent of Codex workspace execution. */
export const WINDOWS_SHELL_COMMANDS = [
  'Get-Location', 'Get-ChildItem', 'Get-Item', 'Get-Content', 'Test-Path', 'Resolve-Path',
  'Join-Path', 'Split-Path', 'Get-FileHash', 'Get-PSDrive', 'Get-Date', 'Get-Process',
  'Get-Service', 'Select-Object', 'Where-Object', 'Sort-Object', 'Measure-Object',
  'Select-String', 'Format-Table', 'Format-List', 'Out-String', 'ConvertTo-Json', 'Write-Output',
] as const;

/** Validate the whole program before executing any statement. Never interpolate raw command text. */
export const buildWindowsShellScript = (command: string): string => `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$source = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(command, 'utf8').toString('base64')}'))
$allowed = @(${WINDOWS_SHELL_COMMANDS.map((name) => `'${name}'`).join(', ')})
$allowedNodes = @('ScriptBlockAst', 'NamedBlockAst', 'PipelineAst', 'CommandAst', 'CommandParameterAst',
  'StringConstantExpressionAst', 'ConstantExpressionAst', 'ExpandableStringExpressionAst',
  'VariableExpressionAst', 'ArrayLiteralAst')
try {
  $parseErrors = $null
  $tokens = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count) { throw ('Invalid PowerShell syntax: ' + $parseErrors[0].Message) }
  if ($ast.ScriptRequirements) { throw 'shell.run blocked syntax: #requires' }
  foreach ($node in $ast.FindAll({ param($n) $true }, $true)) {
    if ($node.GetType().Name -notin $allowedNodes) { throw ('shell.run blocked syntax: ' + $node.GetType().Name) }
    if ($node -is [System.Management.Automation.Language.CommandAst]) {
      $name = $node.GetCommandName()
      if ($node.InvocationOperator -ne 'Unknown' -or $name -notin $allowed) {
        throw ('shell.run command not allowed: ' + $name)
      }
    }
    if ($node -is [System.Management.Automation.Language.VariableExpressionAst]) {
      $name = $node.VariablePath.UserPath
      if ($node.Splatted -or ($name -notlike 'env:*' -and $name -notin @('HOME', 'PWD', 'Desktop', 'Documents', 'true', 'false', 'null'))) {
        throw ('shell.run variable not allowed: ' + $name)
      }
    }
  }
  $Desktop = [Environment]::GetFolderPath('DesktopDirectory')
  $Documents = [Environment]::GetFolderPath('MyDocuments')
  & ([scriptblock]::Create($source)) | Out-String -Width 240 | Write-Output
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;
