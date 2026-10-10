import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['../**/*.ts', '../**/*.tsx'], { eager: true, query: '?raw', import: 'default' });
const files = Object.keys(sources);
const sourceOf = (file: string) => ts.createSourceFile(file, sources[file], ts.ScriptTarget.Latest, true);
const importsOf = (file: string) => sourceOf(file).statements.flatMap((statement) => {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
  const specifier = statement.moduleSpecifier.text;
  const target = specifier.startsWith('@app/') ? `/src/app/${specifier.slice(5)}`
    : specifier.startsWith('.') ? new URL(specifier, new URL(file, 'file:///src/app/core/')).pathname : specifier;
  return [target];
});

describe('frontend architecture boundaries', () => {
  it('keeps business module registration entries at module roots', () => {
    const entries = files.filter((file) => file.startsWith('../modules/') && file.endsWith('/module.ts'));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry.split('/'), entry).toHaveLength(4);
  });

  it('keeps only service classes in service directories', () => {
    const services = files.filter((file) => /\/services?\//.test(file));
    expect(services.length).toBeGreaterThan(0);
    for (const file of services) {
      const name = file;
      expect(name, name).toMatch(/Service\.ts$/);
      const source = sourceOf(file);
      expect(source.statements.some((statement) => ts.isClassDeclaration(statement)
        && statement.name?.text.endsWith('Service')), name).toBe(true);
      for (const statement of source.statements) {
        expect(ts.isFunctionDeclaration(statement), name).toBe(false);
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          const initializer = declaration.initializer;
          expect(Boolean(initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))), name).toBe(false);
        }
      }
    }
  });

  it('groups subservices by capability before technical layer', () => {
    expect(files.filter((file) => /\/modules\/(ai|live2d)\/(domain|infrastructure|runtime)\//.test(file))).toEqual([]);
    const rootServices = files.filter((file) => /\/modules\/(ai|live2d|control-panel)\/service\//.test(file));
    expect(rootServices.sort()).toEqual([
      '../modules/ai/service/AiService.ts',
      '../modules/control-panel/service/ControlPanelService.ts',
      '../modules/live2d/service/Live2dService.ts',
    ]);
    const capabilities = {
      ai: ['asr', 'llm', 'tts'],
      live2d: ['actions', 'bubble', 'interaction', 'layout', 'model', 'motion'],
      'control-panel': ['interaction', 'chat'],
    };
    for (const [module, names] of Object.entries(capabilities)) {
      expect(files.some((file) => file.startsWith(`../modules/${module}/module/`)), module).toBe(false);
      for (const capability of names) {
        expect(files.some((file) => file.startsWith(`../modules/${module}/modules/${capability}/`)), capability).toBe(true);
        expect(files.some((file) => file.startsWith(`../modules/${module}/${capability}/`)), capability).toBe(false);
      }
    }
    for (const capability of capabilities.ai) {
      for (const layer of ['domain', 'infrastructure', 'service', 'tests']) {
        expect(files.some((file) => file.startsWith(`../modules/ai/modules/${capability}/${layer}/`)), `${capability}/${layer}`).toBe(true);
      }
    }
  });

  it('keeps capability domain rules independent of services and external adapters', () => {
    const domainFiles = files.filter((file) => /\/modules\/(ai|live2d|control-panel)\/modules\/[^/]+\/domain\//.test(file));
    expect(domainFiles.length).toBeGreaterThan(0);
    for (const file of domainFiles) {
      for (const target of importsOf(file)) {
        expect(target, file).not.toMatch(/\/(service|infrastructure|application|runtime|ui)\//);
        expect(target).not.toMatch(/^(react|react-dom|react-hot-toast|livekit-client|openai)$/);
      }
    }
  });

  it('does not make AI adapters depend on business services or presentation', () => {
    const adapters = files.filter((file) => /\/modules\/ai\/modules\/[^/]+\/infrastructure\//.test(file));
    expect(adapters.length).toBeGreaterThan(0);
    for (const file of adapters) {
      for (const target of importsOf(file)) {
        expect(target, file).not.toMatch(/\/modules\/[^\n]+\/(service|ui)\//);
        expect(target).not.toMatch(/^(react|react-dom|react-hot-toast)$/);
      }
    }
  });

  it('makes TTS consumers use its service boundary', () => {
    for (const file of files.filter((file) => /\/modules\/control-panel\//.test(file))) {
      for (const target of importsOf(file)) {
        expect(target, file).not.toMatch(/\/modules\/ai\/modules\/tts\/infrastructure\//);
      }
    }
  });
});
