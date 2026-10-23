# Renderer plugins

Plugins are bundled renderer extensions registered from this directory. Business plugins live in their own folders and import contracts only from `src/app/core/plugin`; they must not import internal services or other application implementations.

Each plugin exports a default definition from `index.ts`. The host validates its manifest, activates it for the current renderer window, grants only requested host capabilities, tracks disposable subscriptions, and removes UI/command contributions when it stops. UI contributions can be cards in an existing slot or dedicated control-panel pages. Plugin data is namespaced in Electron storage and synchronized between renderer windows.

The public API describes capabilities, not implementation details. Add new host functionality as a typed capability in `src/app/core/plugin`, then register its host-side provider and permission in the core composition root. Keep plugin-specific protocols, configuration views, and business rules in that plugin's folder.

Bundled renderer plugins execute in the application renderer and are trusted application code; manifest permissions limit accidental capability use but are not a sandbox for untrusted third-party code.

All discovered plugins are activated by default. Configure connections through the control panel; no plugin environment variables or enable/disable controls are used yet.
