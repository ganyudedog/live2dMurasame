import { expect, it } from 'vitest';
import { parseExternalUrl } from './externalUrl';

it('accepts only http and https links', () => {
  expect(parseExternalUrl(' https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1');
  expect(parseExternalUrl('http://example.com')).toBe('http://example.com/');
  for (const value of ['file:///C:/Windows', 'javascript:alert(1)', 'app://index.html', 'plugin://runtime/x', 'not a url', '', 42, null]) {
    expect(parseExternalUrl(value)).toBeNull();
  }
  expect(parseExternalUrl(`https://example.com/${'a'.repeat(2100)}`)).toBeNull();
});
