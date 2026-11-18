import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('disables crashpad before readiness independently of GPU settings', () => {
  const source = ts.createSourceFile('main.ts', fs.readFileSync(path.join(process.cwd(), 'electron/main.ts'), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statement = source.statements.find((node) => node.getText(source) === "app.commandLine.appendSwitch('disable-breakpad');");
  expect(statement).toBeDefined();
  expect(statement!.end).toBeLessThan(source.text.indexOf('app.whenReady()'));
});

it('starts CLI and its transports only inside app readiness, after environment initialization', () => {
  const source = ts.createSourceFile('main.ts', fs.readFileSync(path.join(process.cwd(), 'electron/main.ts'), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const ready = calls.find((call) => call.expression.getText(source) === 'app.whenReady().then');
  expect(ready).toBeDefined();
  const callback = ready!.arguments[0];
  const initialize = calls.find((call) => call.expression.getText(source) === 'live2dEnvironmentService.initialize');
  expect(initialize).toBeDefined();
  const enclosingTry = (node: ts.Node): ts.TryStatement | undefined => {
    let ancestor: ts.Node | undefined = node.parent;
    while (ancestor && !ts.isTryStatement(ancestor)) ancestor = ancestor.parent;
    return ancestor as ts.TryStatement | undefined;
  };
  const initializeTry = enclosingTry(initialize!);
  for (const name of ['createCliModule', 'registerCliIpc', 'startCommandServer']) {
    const sites = calls.filter((call) => call.expression.getText(source) === name);
    expect(sites).toHaveLength(1);
    const site = sites[0];
    const cliTry = enclosingTry(site);
    expect(cliTry).not.toBe(initializeTry);
    expect(cliTry?.catchClause?.getText(source)).toContain('cli.start.failed');
    expect(cliTry?.catchClause?.getText(source)).not.toContain('loadedConfig =');
    expect(cliTry?.catchClause?.getText(source)).not.toContain('config.initialize.failed');
    expect(site.pos).toBeGreaterThan(initialize!.end);
    let ancestor: ts.Node | undefined = site;
    while (ancestor && ancestor !== callback) ancestor = ancestor.parent;
    expect(ancestor, `${name} must not run during main-module evaluation`).toBe(callback);
  }
});
