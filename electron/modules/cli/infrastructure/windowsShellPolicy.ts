// Native cmdlets bind their own arguments. The allowlist describes only which operations
// may discover metadata, read contents, or manipulate path text without resolving it.
const pathCommands = {
  'Get-ChildItem': ['discover', 'Path LiteralPath Directory File Force'],
  'Get-Item': ['discover', 'Path LiteralPath Force'],
  'Test-Path': ['discover', 'Path LiteralPath PathType'],
  'Resolve-Path': ['discover', 'Path LiteralPath'],
  'Get-Content': ['read', 'Path LiteralPath TotalCount Tail Raw Encoding'],
  'Get-FileHash': ['read', 'Path LiteralPath Algorithm'],
  'Select-String': ['read', 'Path LiteralPath Pattern InputObject SimpleMatch CaseSensitive AllMatches List Quiet NotMatch'],
  'Join-Path': ['join', 'Path ChildPath'],
  'Split-Path': ['split', 'Path Parent Leaf Qualifier NoQualifier IsAbsolute'],
} as const;

export const WINDOWS_SHELL_COMMANDS = [...Object.keys(pathCommands),
  'Get-Location', 'Get-PSDrive', 'Get-Date', 'Get-Process', 'Get-Service', 'Select-Object',
  'Where-Object', 'Sort-Object', 'Measure-Object', 'Format-Table', 'Format-List', 'Out-String', 'ConvertTo-Json', 'Write-Output'];
export const SHELL_CONTENT_DENIED = 'shell.run 该路径不在可读目录中';
export interface ShellAccess { roots: string[]; denied: string[] }
const psQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const psList = (values: string[]): string => values.map(psQuote).join(', ');

export const buildWindowsShellScript = (command: string, access: ShellAccess): string => String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
Import-Module Microsoft.PowerShell.Management, Microsoft.PowerShell.Utility
$script:ShellReadRoots = @(${psList(access.roots)})
$script:ShellDenied = @(${psList(access.denied)})
function Test-ShellUnder($full, $roots) {
  foreach ($root in $roots) {
    $base = $root.TrimEnd('\')
    if ($full -ieq $base -or $full.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}
function Get-CheckedPath([string]$value, [bool]$read) {
  $value = $value -replace '^Microsoft\.PowerShell\.Core\\FileSystem::', ''
  if (!$value -or $value -match '[*?\[\]~]|^(?:[/\\]{2}|[a-z]:(?![/\\]))|:(?![/\\])' -or
      @($value -split '[/\\]' | Where-Object { $_ -notin @('.', '..') -and $_ -match '[. ]$' }).Count) {
    throw '${SHELL_CONTENT_DENIED}'
  }
  $provider = $null; $drive = $null
  $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($value, [ref]$provider, [ref]$drive)
  if ($provider.Name -ne 'FileSystem' -or $full -notmatch '^[a-z]:\\' -or $full.Substring(2).Contains(':')) { throw '${SHELL_CONTENT_DENIED}' }
  $full = [IO.Path]::GetFullPath($full).TrimEnd('\')
  if ((Test-ShellUnder $full $script:ShellDenied) -or ($read -and !(Test-ShellUnder $full $script:ShellReadRoots))) { throw '${SHELL_CONTENT_DENIED}' }
  if ($full.Length -eq 2) { $full += '\' }
  for ($item = $full; $item; $item = [IO.Path]::GetDirectoryName($item)) {
    try { $attrs = [IO.File]::GetAttributes($item) }
    catch [IO.FileNotFoundException] { continue }
    catch [IO.DirectoryNotFoundException] { continue }
    if ($attrs -band [IO.FileAttributes]::ReparsePoint) { throw '${SHELL_CONTENT_DENIED}' }
  }
  return $full
}
$script:PathRules = @{
${Object.entries(pathCommands).map(([name, [mode, params]]) => `  '${name}' = @('${mode}', '${params}')`).join('\n')}
}
$script:NativeCommands = @{}
function Invoke-GuardedCommand($name, $bound) {
  $mode, $fields = $script:PathRules[$name]; $native = $script:NativeCommands[$name]; $argsMap = @{}
  foreach ($key in $bound.Keys) {
    if ($key -notin $fields.Split(' ')) { throw ('shell.run parameter not allowed: ' + $key) }
    $argsMap[$key] = $bound[$key]
  }
  if ($argsMap.ContainsKey('InputObject')) {
    if ($argsMap.InputObject -isnot [string]) { throw '${SHELL_CONTENT_DENIED}' }
    & $native @argsMap; return
  }
  $key = if ($argsMap.ContainsKey('LiteralPath')) { 'LiteralPath' } else { 'Path' }
  $paths = if ($argsMap.ContainsKey($key)) { $argsMap[$key] } else { '.' }
  $argsMap.Remove($key)
  foreach ($candidate in $paths) {
    $checked = Get-CheckedPath $candidate ($mode -eq 'read')
    if ($mode -eq 'join' -or $mode -eq 'split') {
      $argsMap.Path = $checked
      if ($mode -eq 'join') { $null = Get-CheckedPath ([IO.Path]::Combine($checked, $argsMap.ChildPath)) $false }
    } else { $argsMap.LiteralPath = $checked }
    if ($name -eq 'Get-ChildItem') {
      & $native @argsMap | Where-Object { !(Test-ShellUnder $_.FullName $script:ShellDenied) -and !($_.Attributes -band [IO.FileAttributes]::ReparsePoint) }
    } else { & $native @argsMap }
  }
}
foreach ($name in $script:PathRules.Keys) {
  $native = if ($name -in @('Get-Content','Get-ChildItem')) { Get-Command $name -ArgumentList $HOME } else { Get-Command $name }
  $script:NativeCommands[$name] = $native
  $meta = [System.Management.Automation.CommandMetadata]::new($native)
  $meta.Parameters.Clear()
  foreach ($key in $script:PathRules[$name][1].Split(' ')) {
    if ($native.Parameters.ContainsKey($key)) { $meta.Parameters.Add($key, $native.Parameters[$key]) }
  }
  $params = [System.Management.Automation.ProxyCommand]::GetParamBlock($meta)
  $binding = [System.Management.Automation.ProxyCommand]::GetCmdletBindingAttribute($meta)
  Set-Item -LiteralPath ('Function:' + $name) -Value ([scriptblock]::Create($binding + 'param(' + $params + ') process { Invoke-GuardedCommand ''' + $name + ''' $PSBoundParameters }'))
}
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
    if ($node -is [System.Management.Automation.Language.CommandParameterAst]) {
      $paramName = $node.ParameterName
      foreach ($reserved in @('OutVariable','ErrorVariable','WarningVariable','InformationVariable','PipelineVariable','ov','ev','wv','iv','pv')) {
        if ($reserved.StartsWith($paramName, [StringComparison]::OrdinalIgnoreCase)) { throw ('shell.run parameter not allowed: ' + $paramName) }
      }
    }
    if ($node -is [System.Management.Automation.Language.CommandAst]) {
      $name = $node.GetCommandName()
      if ($node.InvocationOperator -ne 'Unknown' -or $name -notin $allowed) {
        throw ('shell.run command not allowed: ' + $name)
      }
    }
    if ($node -is [System.Management.Automation.Language.VariableExpressionAst]) {
      $name = $node.VariablePath.UserPath
      if ($node.Splatted -or $name -like 'env:*' -or $name -notin @('HOME', 'PWD', 'Desktop', 'Documents', 'true', 'false', 'null')) {
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
