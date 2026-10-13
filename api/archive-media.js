import { applySecurityLimit, auditRejectedPin } from '../lib/server/security-gate.js';
import { Readable } from 'node:stream';
import { requirePin } from '../lib/server/http.js';
import { getRinArchivedAudio } from '../lib/archive/media.js';
import { validArchiveId } from '../lib/archive/core.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if (req.method!=='GET') return res.status(405).json({code:'METHOD_NOT_ALLOWED'});
  if (!await applySecurityLimit(req, res, 'api')) return;
  if (!requirePin(req, res)) { auditRejectedPin('archive-media'); return; }
  const id=req.query?.id;
  if (!validArchiveId(id)) return res.status(400).json({code:'INVALID_ID'});
  try {
    const file=await getRinArchivedAudio(id);
    if (!file) return res.status(404).json({code:'ARCHIVED_AUDIO_NOT_FOUND'});
    res.setHeader('Content-Type','audio/mpeg');
    res.setHeader('X-Content-Type-Options','nosniff');
    // Avoid leaking the private blob URL. Audio is fetched with the PIN on the client.
    return await new Promise((resolve,reject)=>{
      const stream=Readable.fromWeb(file.stream);
      stream.on('error',reject);
      res.on?.('close',()=>{stream.destroy();resolve();});
      res.on?.('finish',resolve);
      stream.pipe(res);
    });
  }catch(error){
    console.error('Archive media error:',error?.message || error);
    if (!res.headersSent) return res.status(503).json({code:'ARCHIVE_MEDIA_UNAVAILABLE'});
    res.destroy?.();
  }
}
