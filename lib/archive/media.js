import { archiveAudioConfigured, readArchiveAsset, writeArchiveAsset } from './database.js';
import { validArchiveId, ARCHIVE_MAX_AUDIO_BYTES } from './core.js';

export async function preserveRinAudio(messageId, buffer) {
  if (!archiveAudioConfigured() || !validArchiveId(messageId) || !Buffer.isBuffer(buffer) ||
     !buffer.length || buffer.length > ARCHIVE_MAX_AUDIO_BYTES) return false;
  const old=await readArchiveAsset(messageId);
  if (old) return true;
  const { put } = await import('@vercel/blob');
  const result=await put(`rin/voice/${messageId}.mp3`,buffer,{access:'private',contentType:'audio/mpeg',addRandomSuffix:true});
  await writeArchiveAsset(messageId,result.pathname,buffer.length);
  return true;
}

export async function getRinArchivedAudio(messageId) {
  if (!validArchiveId(messageId) || !archiveAudioConfigured()) return null;
  const asset=await readArchiveAsset(messageId);
  if (!asset) return null;
  const { get }=await import('@vercel/blob');
  const file=await get(asset.blob_path,{access:'private'});
  return file?.statusCode===200 && file.stream ? file : null;
}
