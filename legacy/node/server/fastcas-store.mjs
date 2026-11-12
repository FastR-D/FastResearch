/** SDK transaction and binding adapter. Event callers must verify JWTs first. */
export class FastCASStore {
  constructor(store, issuer, clientId) {
    this.db = store.db; this.issuer = issuer; this.clientId = clientId
    this.db.exec(`CREATE TABLE IF NOT EXISTS fastcas_transactions(state TEXT PRIMARY KEY,payload TEXT NOT NULL,expires REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS fastcas_links(issuer TEXT NOT NULL,id TEXT NOT NULL,client_id TEXT NOT NULL,account_id TEXT NOT NULL REFERENCES accounts(id),subject TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('prepared','active','revoked')),version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(issuer,id));
      CREATE UNIQUE INDEX IF NOT EXISTS fastcas_local_live ON fastcas_links(issuer,client_id,account_id) WHERE state!='revoked';
      CREATE UNIQUE INDEX IF NOT EXISTS fastcas_subject_live ON fastcas_links(issuer,client_id,subject) WHERE state!='revoked';
      CREATE TABLE IF NOT EXISTS fastcas_events(issuer TEXT NOT NULL,id TEXT NOT NULL,created REAL NOT NULL,PRIMARY KEY(issuer,id));`)
  }
  async put(tx) {
    this.db.prepare('DELETE FROM fastcas_transactions WHERE expires<?').run(Date.now())
    this.db.prepare('INSERT INTO fastcas_transactions VALUES(?,?,?)').run(tx.state,JSON.stringify(tx),tx.expiresAt)
  }
  async take(state) {
    const row=this.db.prepare('DELETE FROM fastcas_transactions WHERE state=? RETURNING payload').get(state)
    return row ? JSON.parse(row.payload) : undefined
  }
  current(accountId) {
    const row=this.db.prepare("SELECT payload FROM fastcas_links WHERE issuer=? AND client_id=? AND account_id=? AND state!='revoked'").get(this.issuer,this.clientId,accountId)
    return row ? JSON.parse(row.payload) : null
  }
  bySubject(subject) {
    const row=this.db.prepare("SELECT payload FROM fastcas_links WHERE issuer=? AND client_id=? AND subject=? AND state!='revoked'").get(this.issuer,this.clientId,subject)
    return row ? JSON.parse(row.payload) : null
  }
  validate(link) {
    if(link.client_id!==this.clientId || !['prepared','active','revoked'].includes(link.state) || !Number.isSafeInteger(link.version) || link.version<1 || ['id','subject','local_account_ref'].some(key=>typeof link[key]!=='string'||!link[key])) throw new Error('Invalid FastCAS link')
  }
  saveInsideTransaction(link) {
    this.validate(link)
    const previous=this.db.prepare('SELECT * FROM fastcas_links WHERE issuer=? AND id=?').get(this.issuer,link.id)
    if(previous){
      if(previous.account_id!==link.local_account_ref || previous.subject!==link.subject || previous.client_id!==link.client_id) throw new Error('FastCAS link identity changed')
      if(previous.version>=link.version || previous.state==='revoked') return
    }
    this.db.prepare('INSERT INTO fastcas_links VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(issuer,id) DO UPDATE SET state=excluded.state,version=excluded.version,payload=excluded.payload').run(this.issuer,link.id,this.clientId,link.local_account_ref,link.subject,link.state,link.version,JSON.stringify(link))
  }
  save(link) {
    this.db.exec('BEGIN IMMEDIATE')
    try{this.saveInsideTransaction(link);this.db.exec('COMMIT')}
    catch(error){this.db.exec('ROLLBACK');throw error}
  }
  async applyVerifiedEvent(event) {
    this.validate(event.link)
    if(event.type!=='account_link.revoked'||event.link.state!=='revoked'||typeof event.id!=='string'||!event.id) throw new Error('Unsupported FastCAS event')
    this.db.exec('BEGIN IMMEDIATE')
    try{
      if(!this.db.prepare('SELECT 1 FROM fastcas_events WHERE issuer=? AND id=?').get(this.issuer,event.id)){
        const link=event.link
        if(this.db.prepare('SELECT 1 FROM accounts WHERE id=?').get(link.local_account_ref)){
          this.saveInsideTransaction(link)
          this.db.prepare(`DELETE FROM auth_handles WHERE namespace='session'
            AND json_extract(payload,'$.authSource')='fastcas'
            AND json_extract(payload,'$.casIssuer')=? AND json_extract(payload,'$.casLinkId')=?
            AND json_extract(payload,'$.casLinkVersion')<=?`).run(this.issuer,link.id,link.version)
        }
        this.db.prepare('INSERT INTO fastcas_events VALUES(?,?,?)').run(this.issuer,event.id,Date.now())
      }
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  async applyVerifiedLogout(notice) {
    if(typeof notice?.id!=='string'||!notice.id||typeof notice.subject!=='string'||!notice.subject||
       (notice.sessionId!==undefined&&typeof notice.sessionId!=='string')) throw new Error('Invalid FastCAS logout')
    this.db.exec('BEGIN IMMEDIATE')
    try{
      if(!this.db.prepare('SELECT 1 FROM fastcas_events WHERE issuer=? AND id=?').get(this.issuer,notice.id)){
        this.db.prepare(`DELETE FROM auth_handles WHERE namespace='session'
          AND json_extract(payload,'$.authSource')='fastcas'
          AND json_extract(payload,'$.casIssuer')=?
          AND json_extract(payload,'$.casLinkId') IN
            (SELECT id FROM fastcas_links WHERE issuer=? AND client_id=? AND subject=?)
          AND (? IS NULL OR json_extract(payload,'$.casSid')=?)`).run(
            this.issuer,this.issuer,this.clientId,notice.subject,notice.sessionId??null,notice.sessionId??null)
        this.db.prepare('INSERT INTO fastcas_events VALUES(?,?,?)').run(this.issuer,notice.id,Date.now())
      }
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
}
