import './app/styles/app.css';
import { mountApplication } from './app/mountApplication';

void mountApplication().catch((bootstrapError) => {
  console.error('[bootstrap] renderer failed', bootstrapError);
});
