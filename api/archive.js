import { readJsonBody, requirePin } from '../lib/server/http.js';
import { archiveConfigured, archiveAudioConfigured, archiveSql, readArchivePage, writeArchiveMessages } from '../lib/archive/database.js';
import { archiveCursor, archiveMessages, ARCHIVE_PAGE_LIMIT, cloudMessageWithMedia } from '../lib/archive/core.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({code:'METHOD_NOT_ALLOWED'});
  if (!requirePin(req,res)) return;
  if (!archiveConfigured()) return res.status(503).json({code:'ARCHIVE_NOT_CONFIGURED'});
  try {
    if (req.method==='POST') {
      const body=await readJsonBody(req);
      if (body?.action!=='append') return res.status(400).json({code:'INVALID_ACTION'});
      const messages=archiveMessages(body.messages);
      if (!messages) return res.status(400).json({code:'INVALID_ARCHIVE_BATCH'});
      await writeArchiveMessages(messages);
      return res.status(200).json({ok:true,accepted:messages.length});
    }
    const query=req.query || {};
    if (query.mode==='status') {
      // Confirm the schema is installed; don't claim readiness just because env exists.
      const sql=await archiveSql();
      await sql.query('SELECT id FROM rin_archive_messages LIMIT 1');
      return res.status(200).json({ok:true,version:1,audioReady:archiveAudioConfigured()});
    }
    if (query.mode!=='page') return res.status(400).json({code:'INVALID_MODE'});
    const cursor=archiveCursor(query);
    if (cursor===undefined) return res.status(400).json({code:'INVALID_CURSOR'});
    const page=await readArchivePage(cursor,ARCHIVE_PAGE_LIMIT);
    return res.status(200).json({messages:page.rows.map(cloudMessageWithMedia).reverse(),hasMore:page.hasMore,nextCursor:page.nextCursor});
  } catch(error) {
    console.error('Cloud archive error:',error?.message || error);
    return res.status(503).json({code:'ARCHIVE_TEMPORARILY_UNAVAILABLE'});
  }
}
