import { app } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

app.setPath('userData', path.join(process.argv[2], 'profile'));
const timeout = setTimeout(() => app.exit(2), 40000);
app.once('browser-window-created', (_, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      await win.loadURL('app://./index.html?window=control-panel');
      await win.webContents.executeJavaScript(`(async () => {
        const waitFor = async find => {
          for (let i = 0; i < 100; i++) {
            const result = find();
            if (result) return result;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          throw Error('Expected SDK UI missing: ' + document.body.innerText.slice(0, 700));
        };
        const button = label => waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes(label)));
        (await button('插件列表')).click();
        const listed = await window.SystemAPI.listPlugins();
        if (listed.some(entry => entry.id === 'live2d.sdk')) throw Error('Shared SDK listed as a plugin');
        (await button('SDK acceptance')).click();
        const open = await button('Open SDK modal');
        if (!open.querySelector('svg')) throw Error('Missing Lucide icon');
        open.click();
        await waitFor(() => document.querySelector('[role=dialog]')?.textContent.includes('Shared content'));
      })()`);
      console.log('SDK acceptance passed: external plugin, Lucide icon and Radix dialog.');
      clearTimeout(timeout);
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
});
await import(pathToFileURL(path.resolve('dist-electron/main.js')));
