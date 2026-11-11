import { describe, expect, it } from 'vitest';
import { runWindowsShell } from './windowsShell.js';

describe('Windows shell lookup', () => {
  it('refuses to run outside Windows', async () => {
    if (process.platform === 'win32') return;
    await expect(runWindowsShell('Get-Location')).rejects.toThrow('仅支持 Windows');
  });
});
