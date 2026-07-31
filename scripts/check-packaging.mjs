import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = ['apps/desktop/package.json', 'integrations/vscode/package.json', 'integrations/obsidian/manifest.json', 'scripts/install-pcs-autostart.ps1', 'scripts/install-pcs-launchagent.sh', 'scripts/personal-context-studio.service'];
for (const relative of files) {
  const content = await readFile(resolve(root, relative), 'utf8');
  if (!content.trim()) throw new Error(`${relative} is empty`);
  if (relative.endsWith('.json')) JSON.parse(content);
}
const desktop = JSON.parse(await readFile(resolve(root, 'apps/desktop/package.json'), 'utf8'));
if (desktop.build?.appId !== 'com.personalcontextstudio.app') throw new Error('desktop appId is missing');
console.log(`Packaging configuration OK (${files.length} files)`);
