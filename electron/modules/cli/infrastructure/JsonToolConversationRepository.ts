import fs from 'node:fs';
import path from 'node:path';
import { writeTextFile } from '../../../utils/file.js';
import type { ToolConversation } from '../domain/toolConversation.js';
import type { ToolConversationRepository } from '../service/ToolConversationService.js';

export class JsonToolConversationRepository implements ToolConversationRepository {
  private readonly directory: string;
  constructor(directory: string) { this.directory = directory; }
  read(key: string): ToolConversation {
    const file = path.join(this.directory, `${key}.json`);
    if (!fs.existsSync(file)) return { revision: 0, summary: '', facts: [], turns: [] };
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ToolConversation;
  }
  write(key: string, state: ToolConversation): void {
    const file = path.join(this.directory, `${key}.json`);
    writeTextFile(file, JSON.stringify(state));
  }
}
