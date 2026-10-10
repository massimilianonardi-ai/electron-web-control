import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (metadata.name !== 'electron-web-control' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(metadata.version)) {
  throw new Error('invalid electron-web-control release identity');
}
const dist = path.join(root, 'dist');
const stageRoot = path.join(dist, 'stage');
const target = path.join(stageRoot, metadata.name);
await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });
for (const entry of ['README.md', 'package.json', 'bin', 'src']) {
  await fs.cp(path.join(root, entry), path.join(target, entry), {
    recursive: true,
    preserveTimestamps: true
  });
}
const archiveName = metadata.name + '-v' + metadata.version + '-all.tar.gz';
const archive = path.join(dist, archiveName);
await new Promise((resolve, reject) => {
  const child = spawn('tar', ['-czf', archive, '-C', stageRoot, metadata.name], {
    stdio: 'inherit'
  });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('tar exited with ' + code)));
});
await fs.writeFile(path.join(dist, 'release-artifact'), archiveName + '\n', 'utf8');
process.stdout.write(archive + '\n');
