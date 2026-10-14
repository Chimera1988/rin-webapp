import { RESETTABLE_STORAGE_KEYS, CHAT_STORAGE_KEY } from './chat_store.js';
import { isWallpaperDataUrl } from './wallpaper_store.js';

export const RIN_BACKUP_FORMAT = 'rin-local-backup';
export const RIN_BACKUP_VERSION = 2;
export const LEGACY_BACKUP_VERSION = 1;
const KDF_ITERATIONS = 310000;
const AAD_PREFIX = 'rin-local-backup-v2:';
const KEYS = Object.freeze([...new Set(RESETTABLE_STORAGE_KEYS.filter(key => key !== 'rin-pin'))].sort());
const MAX_IMPORT_BYTES = 40 * 1024 * 1024; // base64 ciphertext adds ~33% to the v1 envelope
const MAX_PLAINTEXT_BYTES = 24 * 1024 * 1024;

function currentCrypto(cryptoRef) {
  const subtle = cryptoRef?.subtle;
  if (!subtle?.digest) throw new Error('CRYPTO_UNAVAILABLE');
  return subtle;
}

async function sha256(content, cryptoRef) {
  const digest = await currentCrypto(cryptoRef).digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function snapshotKeys(storage) {
  const values = Object.create(null);
  for (const key of KEYS) {
    const value = storage.getItem(key);
    if (value !== null) values[key] = value;
  }
  return values;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('BACKUP_DATA_INVALID');
  if (!payload.storage || typeof payload.storage !== 'object' || Array.isArray(payload.storage)) throw new Error('BACKUP_DATA_INVALID');
  const storage = Object.create(null);
  for (const [key, value] of Object.entries(payload.storage)) {
    if (!KEYS.includes(key) || typeof value !== 'string') throw new Error('BACKUP_STORAGE_INVALID');
    storage[key] = value;
  }
  for (const key of [CHAT_STORAGE_KEY, 'rin-diary-v1', 'rin-profile-v1', 'rin-init-state-v2', 'rin-memory-jobs-v1']) {
    if (!Object.hasOwn(storage, key)) continue;
    let data;
    try { data = JSON.parse(storage[key]); } catch { throw new Error('BACKUP_STORAGE_INVALID'); }
    if (key === CHAT_STORAGE_KEY && !Array.isArray(data)) throw new Error('BACKUP_STORAGE_INVALID');
    if (key !== CHAT_STORAGE_KEY && (!data || typeof data !== 'object')) throw new Error('BACKUP_STORAGE_INVALID');
  }
  if (typeof payload.wallpaper !== 'string' || (payload.wallpaper && !isWallpaperDataUrl(payload.wallpaper))) {
    throw new Error('BACKUP_WALLPAPER_INVALID');
  }
  return { storage, wallpaper: payload.wallpaper };
}

export function backupSummary(payload) {
  let count = 0;
  try {
    const history = JSON.parse(payload?.storage?.[CHAT_STORAGE_KEY] || '[]');
    count = Array.isArray(history) ? history.length : 0;
  } catch { /* validation will raise on import */ }
  return { messages: count, keys: Object.keys(payload?.storage || {}).length, wallpaper: Boolean(payload?.wallpaper) };
}

function bytesToB64(bytes) {
  let raw='';
  for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(raw);
}
function b64ToBytes(raw,expected=0) {
  if(typeof raw!=='string'||raw.length>MAX_IMPORT_BYTES*2||!/^[a-zA-Z0-9+/]*={0,2}$/.test(raw))throw new Error('BACKUP_DATA_INVALID');
  let decoded;
  try {decoded=atob(raw);} catch {throw new Error('BACKUP_DATA_INVALID');}
  if(expected&&decoded.length!==expected)throw new Error('BACKUP_DATA_INVALID');
  return Uint8Array.from(decoded, c=>c.charCodeAt(0));
}
async function deriveEncryptionKey(password,salt,cryptoRef,usage) {
  const subtle=cryptoRef?.subtle;
  if(!subtle?.importKey||!subtle?.deriveKey)throw new Error('CRYPTO_UNAVAILABLE');
  const raw=await subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
  return subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:KDF_ITERATIONS},raw,
    {name:'AES-GCM',length:256},false,[usage]);
}
function encryptionAad(envelope){
  return new TextEncoder().encode(AAD_PREFIX+JSON.stringify({format:envelope.format,version:envelope.version,createdAt:envelope.createdAt,kdf:envelope.kdf}));
}
// All new exports are encrypted before download. Neither password nor plaintext reaches the server.
export async function createBackup({ storage, wallpaperStore, password, cryptoRef = globalThis.crypto, now = Date.now() }) {
  if (!storage || !wallpaperStore) throw new Error('BACKUP_ENVIRONMENT_INVALID');
  if(typeof password!=='string'||password.length<12||password.length>256)throw new Error('BACKUP_PASSWORD_REQUIRED');
  const payload=validatePayload({storage:snapshotKeys(storage),wallpaper:await wallpaperStore.get()||''});
  if(!cryptoRef?.getRandomValues)throw new Error('CRYPTO_UNAVAILABLE');
  const encodedPayload=new TextEncoder().encode(JSON.stringify(payload));
  if(encodedPayload.byteLength>MAX_PLAINTEXT_BYTES)throw new Error('BACKUP_SIZE_INVALID');
  const salt=cryptoRef.getRandomValues(new Uint8Array(16));
  const iv=cryptoRef.getRandomValues(new Uint8Array(12));
  const envelope={format:RIN_BACKUP_FORMAT,version:RIN_BACKUP_VERSION,createdAt:new Date(now).toISOString(),
    kdf:{name:'PBKDF2-SHA256',iterations:KDF_ITERATIONS,salt:bytesToB64(salt)},
    iv:bytesToB64(iv)};
  const key=await deriveEncryptionKey(password,salt,cryptoRef,'encrypt');
  const ciphertext=await cryptoRef.subtle.encrypt({name:'AES-GCM',iv,additionalData:encryptionAad(envelope)},key,
    encodedPayload);
  const doc={...envelope,cipher:'AES-256-GCM',ciphertext:bytesToB64(new Uint8Array(ciphertext))};
  const date=envelope.createdAt;
  return {json:JSON.stringify(doc,null,2),filename:`rin-private-backup-${date.slice(0,10)}-${date.slice(11,16).replace(':','-')}.json`,summary:backupSummary(payload)};
}

export async function parseBackup(raw,{password,cryptoRef=globalThis.crypto}={}) {
  if(typeof raw!=='string'||new Blob([raw]).size>MAX_IMPORT_BYTES)throw new Error('BACKUP_SIZE_INVALID');
  let file;
  try{file=JSON.parse(raw);}catch{throw new Error('BACKUP_JSON_INVALID');}
  if(file?.format!==RIN_BACKUP_FORMAT || typeof file?.createdAt!=='string' || !Number.isFinite(Date.parse(file.createdAt))){
    throw new Error('BACKUP_FORMAT_UNSUPPORTED');
  }
  // Import-only support for the existing unencrypted Safari/PWA backup files.
  if(file.version===LEGACY_BACKUP_VERSION){
    if(!/^[0-9a-f]{64}$/.test(file.digest||''))throw new Error('BACKUP_CHECKSUM_INVALID');
    const payload=validatePayload(file.payload);
    if(await sha256(JSON.stringify(file.payload),cryptoRef)!==file.digest)throw new Error('BACKUP_CHECKSUM_INVALID');
    return {payload,createdAt:file.createdAt,summary:backupSummary(payload),legacy:true};
  }
  if(file.version!==RIN_BACKUP_VERSION)throw new Error('BACKUP_FORMAT_UNSUPPORTED');
  if(typeof password!=='string'||!password)throw new Error('BACKUP_PASSWORD_REQUIRED');
  if(file.cipher!=='AES-256-GCM'||file.kdf?.name!=='PBKDF2-SHA256'||file.kdf?.iterations!==KDF_ITERATIONS){
    throw new Error('BACKUP_FORMAT_UNSUPPORTED');
  }
  const salt=b64ToBytes(file.kdf.salt,16),iv=b64ToBytes(file.iv,12),cipher=b64ToBytes(file.ciphertext);
  const key=await deriveEncryptionKey(password,salt,cryptoRef,'decrypt');
  let plaintext;
  try{
    plaintext=await cryptoRef.subtle.decrypt({name:'AES-GCM',iv,additionalData:encryptionAad(file)},key,cipher);
  }catch{throw new Error('BACKUP_DECRYPT_FAILED');}
  let payload;
  try{payload=validatePayload(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext)));}
  catch{throw new Error('BACKUP_DATA_INVALID');}
  return {payload,createdAt:file.createdAt,summary:backupSummary(payload),legacy:false};
}

export async function restoreBackup(backup, { storage, wallpaperStore }) {
  if (!storage || !wallpaperStore) throw new Error('BACKUP_ENVIRONMENT_INVALID');
  // Import is validated before any write. Recover local data on ordinary write failures.
  const incoming = validatePayload(backup?.payload);
  const previous = snapshotKeys(storage);
  const previousWallpaper = await wallpaperStore.get() || '';
  let changed = false;
  try {
    changed = true;
    for (const key of KEYS) {
      if (Object.hasOwn(incoming.storage, key)) {
        const value = incoming.storage[key];
        storage.setItem(key, value);
        if (storage.getItem(key) !== value) throw new Error('BACKUP_WRITE_FAILED');
      } else storage.removeItem(key);
    }
    const wallpaperOk = incoming.wallpaper
      ? await wallpaperStore.set(incoming.wallpaper)
      : await wallpaperStore.remove();
    if (!wallpaperOk) throw new Error('BACKUP_WALLPAPER_WRITE_FAILED');
  } catch (error) {
    if (changed) {
      let rollbackFailed = false;
      for (const key of KEYS) {
        try {
          if (Object.hasOwn(previous, key)) storage.setItem(key, previous[key]);
          else storage.removeItem(key);
        } catch { rollbackFailed = true; }
      }
      try {
        const reverted = previousWallpaper
          ? await wallpaperStore.set(previousWallpaper)
          : await wallpaperStore.remove();
        if (!reverted) rollbackFailed = true;
      } catch { rollbackFailed = true; }
      if (rollbackFailed) throw new Error('BACKUP_ROLLBACK_FAILED', { cause: error });
    }
    throw error;
  }
  return true;
}

export const MAX_BACKUP_IMPORT_BYTES = MAX_IMPORT_BYTES;
