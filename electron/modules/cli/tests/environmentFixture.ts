import fs from 'node:fs';
import { Live2dEnvironmentService } from '../../live2denv/application/Live2dEnvironmentService.js';
import { normalizeLive2denvConfig } from '../../../dao/globalConfig.js';
import { writeJsonFile } from '../../../utils/file.js';

export const environmentFixture = (file: string) => new Live2dEnvironmentService({
  repository: {
    load: () => normalizeLive2denvConfig(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}),
    save: (value) => { const next = normalizeLive2denvConfig(value); writeJsonFile(file, next); return next; },
  },
});
