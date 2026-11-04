import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface KoffiLibrary {
  load(dll: string): { func(signature: string): (vKey: number) => number };
}

export function createWindowsKeyState(platform: NodeJS.Platform = process.platform): ((key: string) => boolean) | null {
  if (platform !== 'win32') return null;
  const koffi = require('koffi') as KoffiLibrary;
  const getKeyState = koffi.load('user32.dll').func('short __stdcall GetAsyncKeyState(int vKey)');
  const keys: Record<string, number> = { Backquote: 0xc0, ControlRight: 0xa3, F8: 0x77, MouseLeft: 0x01 };
  return (key) => Boolean(getKeyState(keys[key] ?? 0) & 0x8000);
}
