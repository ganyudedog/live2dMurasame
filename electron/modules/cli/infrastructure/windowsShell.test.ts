import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWindowsShell } from './windowsShell.js';

const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";

describe.skipIf(process.platform !== 'win32')('Windows host shell', () => {
  let root: string;
  let directory: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-review-'));
    directory = path.join(root, '中文项目');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(root, 'large.txt'), 'x'.repeat(80000));
  });
  afterAll(() => { fs.unlinkSync(path.join(root, 'large.txt')); fs.rmdirSync(directory); fs.rmdirSync(root); });

  it('returns successful queries without throwing and preserves Chinese paths', async () => {
    const result = await runWindowsShell(`Get-ChildItem -LiteralPath ${quote(root)} -Directory | Select-Object -ExpandProperty FullName`);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(directory);
    expect(fs.statSync(result.stdout.trim()).isDirectory()).toBe(true);
  });

  it('flushes formatted object output before exiting', async () => {
    const result = await runWindowsShell('Get-Location');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(os.homedir());
  });

  it('returns a normal command failure with its diagnostic instead of a timeout', async () => {
    const result = await runWindowsShell(`Get-Item -LiteralPath ${quote(path.join(root, '不存在'))}`);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('不存在');
    expect(result.stderr).not.toContain('超时');
  });

  it('supports environment variables, known folders and property-based filtering', async () => {
    const result = await runWindowsShell('Write-Output $HOME $Desktop $Documents | Where-Object Length -gt 0 | ConvertTo-Json');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toContain(os.homedir());
  });

  it('reports excessive output distinctly from a timeout', async () => {
    await expect(runWindowsShell(`Get-Content -LiteralPath ${quote(path.join(root, 'large.txt'))} -Raw`))
      .rejects.toThrow('输出超过限制');
  });

  it.each([
    'Remove-Item -LiteralPath PLACEHOLDER',
    'Write-Output ok; Remove-Item -LiteralPath PLACEHOLDER',
    'Write-Output $(Remove-Item -LiteralPath PLACEHOLDER)',
    'Write-Output "$(Remove-Item -LiteralPath PLACEHOLDER)"',
    '& "Remove-Item" -LiteralPath PLACEHOLDER',
    '[System.IO.Directory]::Delete(PLACEHOLDER)',
    'Write-Output bad > PLACEHOLDER',
    'Write-Output ok | ForEach-Object { Remove-Item -LiteralPath PLACEHOLDER }',
    'cmd.exe /c echo forbidden',
    'Set-Item env:PATH bad',
    '#requires -Modules UntrustedModule\nGet-Location',
    'Microsoft.PowerShell.Management\\Remove-Item -LiteralPath PLACEHOLDER',
  ])('rejects the entire program before executing disallowed syntax: %s', async (command) => {
    const result = await runWindowsShell(command.replaceAll('PLACEHOLDER', quote(directory)));
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/not allowed|blocked syntax/);
    expect(fs.statSync(directory).isDirectory()).toBe(true);
  });
});

describe.skipIf(process.platform === 'win32')('non-Windows shell', () => {
  it('refuses to execute', async () => {
    await expect(runWindowsShell('Get-Location')).rejects.toThrow('仅支持 Windows');
  });
});
