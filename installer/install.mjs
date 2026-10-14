import {readFile,writeFile,mkdir,rename,stat,rm} from 'node:fs/promises';
import {resolve,dirname,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {PATCHES,ADDED_FILES,BASE_RELEASE,NEXT_RELEASE} from './patches.mjs';
const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const root=resolve(process.argv[2] || '.');
const blobSha=b=>createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`),b])).digest('hex');
const pending=[];
const error=m=>{throw new Error(m)};
async function present(path){try{await stat(path);return true;}catch{return false;}}
try{
  for(const spec of PATCHES){
    const path=join(root,spec.path), bytes=await readFile(path), sha=blobSha(bytes);
    if(sha!==spec.baseSha) error(`${spec.path}: expected pristine 2.6.16 SHA ${spec.baseSha}, got ${sha}. Aborting without changes.`);
    let text=bytes.toString('utf8');
    for(const [before,after] of spec.changes){
      if(text.split(before).length!==2) error(`${spec.path}: patch anchor missing/ambiguous`);
      text=text.replace(before,after);
    }
    pending.push({path,bytes:Buffer.from(text,'utf8'),original:bytes});
  }
  for(const name of ADDED_FILES){
    const dest=join(root,name);
    if(await present(dest)) error(`${name} already exists, refusing to overwrite.`);
    pending.push({path:dest,bytes:await readFile(join(packageRoot,name)),original:null});
  }
  const backup=resolve(dirname(root),`${basename(root)}-rin-2616-backup`);
  if(await present(backup)) error(`Backup folder already exists: ${backup}. Preserve it and use a clean checkout.`);
  await mkdir(backup,{recursive:true});
  for(const f of pending.filter(x=>x.original!==null)) {
    const rel=f.path.slice(root.length+1),dest=join(backup,rel);
    await mkdir(dirname(dest),{recursive:true});await writeFile(dest,f.original);
  }
  await writeFile(join(backup,'README.txt'),`Backup of pristine ${BASE_RELEASE}. To revert, run rollback/rollback.mjs in the rollback package against the app directory. Do not delete the backup before validation.\n`);
  const applied=[];
  try {
    for(const f of pending){
      await mkdir(dirname(f.path),{recursive:true});
      const temp=f.path+'.rin2617.tmp';await writeFile(temp,f.bytes);await rename(temp,f.path);
      applied.push(f);
    }
  } catch(writeError) {
    for(const f of applied.reverse()) {
      if(f.original===null) await rm(f.path,{force:true});
      else await writeFile(f.path,f.original);
    }
    throw writeError;
  }
  process.stdout.write(`Installed ${NEXT_RELEASE} into ${root}. Original files backed up in ${backup}.\nApply db/migrations/004_autobiographical_memory.sql to Neon production main BEFORE deploying app code.\n`);
}catch(e){console.error('Install aborted: '+e.message);process.exitCode=1;}
