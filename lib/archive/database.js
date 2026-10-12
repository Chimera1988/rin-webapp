// Lazily imported: local/offline chat works without cloud configuration.
let client;
export function archiveConfigured() { return Boolean(process.env.DATABASE_URL); }
export function archiveAudioConfigured() { return archiveConfigured() && Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN)); }
export async function archiveSql() {
  if (!archiveConfigured()) throw new Error('ARCHIVE_DB_NOT_CONFIGURED');
  if (!client) {
    const {neon} = await import('@neondatabase/serverless');
    client = neon(process.env.DATABASE_URL);
  }
  return client;
}

export async function writeArchiveMessages(messages) {
  const sql = await archiveSql();
  // JSONB projected into fixed columns by PostgreSQL. Never rewrite archived content.
  const value = JSON.stringify(messages.map(x => ({id:x.id, ts:x.ts, role:x.role, kind:x.kind, status:x.status, payload:x})));
  const rows = await sql.query(`
    INSERT INTO rin_archive_messages (id, ts, role, kind, status, payload)
    SELECT m.id, m.ts, m.role, m.kind, m.status, m.payload
    FROM jsonb_to_recordset($1::jsonb)
      AS m(id text, ts bigint, role text, kind text, status text, payload jsonb)
    ON CONFLICT (id) DO NOTHING
    RETURNING id`, [value]);
  return rows.length;
}

export async function readArchivePage(cursor, limit=80) {
  const sql = await archiveSql();
  const rows = await sql.query(`
    SELECT m.payload, m.ts, m.id, (a.message_id IS NOT NULL) AS has_audio
    FROM rin_archive_messages m LEFT JOIN rin_archive_assets a ON a.message_id=m.id
    WHERE ($1::bigint IS NULL OR (m.ts,m.id)<($1::bigint,$2::text))
    ORDER BY m.ts DESC, m.id DESC LIMIT $3::integer`,
    [cursor?.ts ?? null, cursor?.id ?? null, limit+1]);
  const hasMore = rows.length>limit;
  const page=rows.slice(0,limit);
  const last=page.at(-1);
  return {rows:page, hasMore, nextCursor: last ? {beforeTs:Number(last.ts),beforeId:last.id} : null};
}

export async function archiveMessageExists(messageId) {
  const sql=await archiveSql();
  const rows=await sql.query('SELECT 1 FROM rin_archive_messages WHERE id=$1 LIMIT 1', [messageId]);
  return rows.length>0;
}
export async function readArchiveAsset(messageId) {
  const sql=await archiveSql();
  const rows=await sql.query('SELECT blob_path, mime, bytes FROM rin_archive_assets WHERE message_id=$1 LIMIT 1',[messageId]);
  return rows[0] || null;
}
export async function writeArchiveAsset(messageId, path, bytes) {
  const sql=await archiveSql();
  await sql.query(`INSERT INTO rin_archive_assets (message_id,blob_path,mime,bytes)
    VALUES ($1,$2,'audio/mpeg',$3) ON CONFLICT (message_id) DO NOTHING`,[messageId,path,bytes]);
}
