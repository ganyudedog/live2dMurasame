export const WINDOWS_SHELL_COMMANDS = [
  'Get-Location', 'Get-ChildItem', 'Get-Item', 'Get-Content', 'Test-Path', 'Resolve-Path',
  'Join-Path', 'Split-Path', 'Get-FileHash', 'Get-PSDrive', 'Get-Date', 'Get-Process',
  'Get-Service', 'Select-Object', 'Where-Object', 'Sort-Object', 'Measure-Object',
  'Select-String', 'Format-Table', 'Format-List', 'Out-String', 'ConvertTo-Json', 'Write-Output',
] as const;

export const SHELL_CONTENT_DENIED = 'shell.run 该路径不在可读目录中';

export interface ShellAccess {
  roots: string[];
  denied: string[];
}

const psQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const psList = (values: string[]): string => values.map(psQuote).join(', ');

/** Validate the whole program before executing any statement. Never interpolate raw command text. */
export const buildWindowsShellScript = (command: string, access: ShellAccess): string => `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$script:ShellReadRoots = @(${psList(access.roots)})
$script:ShellDenied = @(${psList(access.denied)})
function Test-ShellUnder([string]$Path, [string[]]$Roots) {
  $left = $Path.TrimEnd('\\', '/')
  foreach ($root in @($Roots)) {
    if ([string]::IsNullOrWhiteSpace($root)) { continue }
    $base = [System.IO.Path]::GetFullPath($root).TrimEnd('\\', '/')
    if ($left.Equals($base, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    if ($left.StartsWith($base + '\\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}
function Assert-ShellReadable([string]$Candidate) {
  if ([string]::IsNullOrWhiteSpace($Candidate)) { throw '${SHELL_CONTENT_DENIED}' }
  $plain = $Candidate
  $marker = $plain.IndexOf('::')
  if ($marker -ge 0 -and $plain.StartsWith('Microsoft.PowerShell')) { $plain = $plain.Substring($marker + 2) }
  $full = [System.IO.Path]::GetFullPath($plain)
  $target = $full
  if (Test-Path -LiteralPath $full) {
    $item = Get-Item -LiteralPath $full -Force
    $guard = 0
    while ($item.LinkType -and $guard -lt 8) {
      $next = $item.Target
      if ($next -is [System.Array]) { $next = $next[0] }
      if (-not $next) { break }
      if (-not [System.IO.Path]::IsPathRooted([string]$next)) { $next = Join-Path $item.Directory.FullName ([string]$next) }
      $nextFull = [System.IO.Path]::GetFullPath([string]$next)
      if (-not (Test-Path -LiteralPath $nextFull)) { $target = $nextFull; break }
      $item = Get-Item -LiteralPath $nextFull -Force
      $target = $item.FullName
      $guard++
    }
    if (-not $item.LinkType) { $target = $item.FullName }
  }
  if (Test-ShellUnder $target $script:ShellDenied) { throw '${SHELL_CONTENT_DENIED}' }
  $allowed = $false
  foreach ($root in @($script:ShellReadRoots)) { if (Test-ShellUnder $target @($root)) { $allowed = $true } }
  if (-not $allowed) { throw '${SHELL_CONTENT_DENIED}' }
  return $target
}
function Expand-ShellPath([string]$Candidate, [bool]$Literal) {
  if ([string]::IsNullOrWhiteSpace($Candidate)) { throw '${SHELL_CONTENT_DENIED}' }
  if (-not $Literal -and $Candidate -match '[\\*\\?]') {
    $items = @(Get-ChildItem -Path $Candidate -Force -ErrorAction SilentlyContinue)
    if ($items.Count -eq 0) { throw '${SHELL_CONTENT_DENIED}' }
    return @($items | ForEach-Object { $_.FullName })
  }
  return @($Candidate)
}
function Resolve-ShellContent([string[]]$Paths, [bool]$Literal) {
  $checked = New-Object System.Collections.Generic.List[string]
  foreach ($path in @($Paths)) {
    foreach ($expanded in @(Expand-ShellPath $path $Literal)) { [void]$checked.Add((Assert-ShellReadable $expanded)) }
  }
  if ($checked.Count -eq 0) { throw '${SHELL_CONTENT_DENIED}' }
  return $checked.ToArray()
}
function Get-Content {
  [CmdletBinding(DefaultParameterSetName='Path')]
  param(
    [Parameter(ParameterSetName='Path', Position=0, ValueFromPipeline=$true, ValueFromPipelineByPropertyName=$true)]
    [Alias('PSPath')]
    [string[]]$Path,
    [Parameter(ParameterSetName='LiteralPath', Mandatory=$true, ValueFromPipelineByPropertyName=$true)]
    [string[]]$LiteralPath,
    [Alias('First')][long]$TotalCount = -1,
    [int]$Tail = -1,
    [switch]$Raw,
    [string]$Encoding
  )
  begin { $collected = New-Object System.Collections.Generic.List[string] }
  process {
    $incoming = $(if ($PSCmdlet.ParameterSetName -eq 'LiteralPath') { $LiteralPath } else { $Path })
    foreach ($item in @($incoming)) { if ($item) { [void]$collected.Add([string]$item) } }
  }
  end {
    $checked = Resolve-ShellContent $collected.ToArray() ($PSCmdlet.ParameterSetName -eq 'LiteralPath')
    $params = @{ LiteralPath = $checked }
    if ($Raw) { $params.Raw = $true }
    if ($TotalCount -ge 0) { $params.TotalCount = $TotalCount }
    if ($Tail -ge 0) { $params.Tail = $Tail }
    if ($Encoding) { $params.Encoding = $Encoding }
    Microsoft.PowerShell.Management\\Get-Content @params
  }
}
function Select-String {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true, Position=0)][string]$Pattern,
    [Parameter(ValueFromPipeline=$true)][psobject]$InputObject,
    [Parameter(ValueFromPipelineByPropertyName=$true)][Alias('PSPath')][string[]]$Path,
    [string[]]$LiteralPath,
    [switch]$SimpleMatch, [switch]$CaseSensitive, [switch]$AllMatches, [switch]$List, [switch]$Quiet, [switch]$NotMatch
  )
  begin { $texts = New-Object System.Collections.Generic.List[string]; $files = New-Object System.Collections.Generic.List[string] }
  process {
    foreach ($item in @($LiteralPath)) { if ($item) { [void]$files.Add([string]$item) } }
    foreach ($item in @($Path)) { if ($item) { [void]$files.Add([string]$item) } }
    if ($InputObject -is [string]) { [void]$texts.Add($InputObject) }
    elseif ($null -ne $InputObject -and $InputObject.PSObject.Properties['FullName']) { [void]$files.Add([string]$InputObject.FullName) }
  }
  end {
    $common = @{}
    if ($SimpleMatch) { $common.SimpleMatch = $true }
    if ($CaseSensitive) { $common.CaseSensitive = $true }
    if ($AllMatches) { $common.AllMatches = $true }
    if ($List) { $common.List = $true }
    if ($Quiet) { $common.Quiet = $true }
    if ($NotMatch) { $common.NotMatch = $true }
    if ($files.Count -gt 0) {
      $checked = Resolve-ShellContent $files.ToArray() ([bool]$PSBoundParameters.ContainsKey('LiteralPath'))
      Microsoft.PowerShell.Utility\\Select-String -Pattern $Pattern -LiteralPath $checked @common
    }
    if ($texts.Count -gt 0) { $texts.ToArray() | Microsoft.PowerShell.Utility\\Select-String -Pattern $Pattern @common }
    if ($files.Count -eq 0 -and $texts.Count -eq 0) { throw '${SHELL_CONTENT_DENIED}' }
  }
}
function Get-FileHash {
  [CmdletBinding(DefaultParameterSetName='Path')]
  param(
    [Parameter(ParameterSetName='Path', Position=0, ValueFromPipeline=$true, ValueFromPipelineByPropertyName=$true)]
    [Alias('PSPath')][string[]]$Path,
    [Parameter(ParameterSetName='LiteralPath', Mandatory=$true)][string[]]$LiteralPath,
    [string]$Algorithm = 'SHA256'
  )
  begin { $collected = New-Object System.Collections.Generic.List[string] }
  process {
    $incoming = $(if ($PSCmdlet.ParameterSetName -eq 'LiteralPath') { $LiteralPath } else { $Path })
    foreach ($item in @($incoming)) { if ($item) { [void]$collected.Add([string]$item) } }
  }
  end {
    $checked = Resolve-ShellContent $collected.ToArray() ($PSCmdlet.ParameterSetName -eq 'LiteralPath')
    Microsoft.PowerShell.Utility\\Get-FileHash -LiteralPath $checked -Algorithm $Algorithm
  }
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
