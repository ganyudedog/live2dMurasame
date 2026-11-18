import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { CliPolicyCard } from './CliPolicyCard';

vi.mock('@app/core/useService', () => ({
  useService: () => ({ plugins: new Map([['notes', { manifest: { id: 'notes', name: 'Notes' } }]]) }),
}));

it('renders host shell policy and plugin permissions without an agent task list', () => {
  const markup = renderToStaticMarkup(createElement(CliPolicyCard));
  expect(markup).toContain('CLI');
  expect(markup).toContain('shell.run');
  expect(markup).toContain('Notes');
  expect(markup).not.toContain('Agent');
});
