// Static avatar catalog, generated during every Vercel build (zero API functions).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export async function buildAvatarManifest(projectRoot) {
  const folder = resolve(projectRoot, 'public/avatars');
  const dest = resolve(projectRoot, 'public/avatars.json');
  const entries = await readdir(folder, { withFileTypes: true });
  const names = entries
    .filter(e => e.isFile() && !e.name.startsWith('.') &&
      e.name.length <= 160 && /\.(?:jpe?g|png|webp)$/i.test(e.name))
    .map(e => e.name)
    .sort((a, b) => (a === 'rin-original.jpg' ? -1 : b === 'rin-original.jpg' ? 1 :
      a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' })))
    .slice(0, 200);
  if (!names.length) throw new Error('public/avatars: no JPG, PNG or WebP images. Deployment stopped.');
  const avatars = await Promise.all(names.map(async id => {
    const image = await readFile(resolve(folder, id));
    const digest = createHash('sha256').update(image).digest('hex').slice(0, 12);
    return { id, src: `/avatars/${encodeURIComponent(id)}?v=${digest}` };
  }));
  await writeFile(dest, JSON.stringify({ avatars }, null, 2) + '\n', 'utf8');
  return avatars;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const avatars = await buildAvatarManifest(projectRoot);
    console.log(`Avatar manifest generated: ${avatars.length} images`);
  } catch (error) {
    console.error('Avatar manifest build failed:', error?.message || error);
    process.exitCode = 1;
  }
}
