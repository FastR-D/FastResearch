import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { FastCASStore } from './fastcas-store.mjs'

export class CASFailure extends Error {
  constructor(message,status=403){super(message);this.status=status}
}
const hash=value=>createHash('sha256').update(value).digest('hex')
export class FastCASService {
  constructor(accounts,sessions,{sdk,env=process.env}={}) {
    this.accounts=accounts;this.sessions=sessions;this.db=accounts.db
    this.config={issuer:env.FASTRESEARCH_FASTCAS_ISSUER??'',clientId:env.FASTRESEARCH_FASTCAS_CLIENT_ID??'',clientSecret:env.FASTRESEARCH_FASTCAS_CLIENT_SECRET??'',redirectUri:env.FASTRESEARCH_FASTCAS_REDIRECT_URI??'',allowLoopbackHTTP:env.FASTRESEARCH_FASTCAS_ALLOW_LOOPBACK_HTTP==='true'}
    const values=['issuer','clientId','clientSecret','redirectUri'].map(key=>this.config[key])
    if(values.some(Boolean)&&!values.every(Boolean))throw new Error('FastCAS requires all four connection settings')
    this.enabled=values.every(Boolean)
    this.sdkInstance=sdk
    this.store=new FastCASStore(accounts,this.config.issuer,this.config.clientId)
    this.db.exec('CREATE TABLE IF NOT EXISTS auth_limits(id TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires REAL NOT NULL)')
  }
  async sdk(){
    if(!this.enabled)throw new CASFailure('未启用 FastCAS',404)
    if(!this.sdkInstance){
      this.sdkPromise??=import('@fastrd/fastcas/server').then(({FastCAS})=>new FastCAS(this.config,this.store))
      try{this.sdkInstance=await this.sdkPromise}catch(error){this.sdkPromise=null;throw error}
    }
    return this.sdkInstance
  }
  account(id){
    const row=this.db.prepare('SELECT a.*,c.credential FROM accounts a JOIN credentials c ON c.account_id=a.id WHERE a.id=?').get(id)
    return row ? {...JSON.parse(row.content),...JSON.parse(row.credential),accountId:row.id} : null
  }
  session(raw){const session=this.sessions.get(raw);return session?.role==='member'?session:null}
  prove(raw,key,peer){
    const id=hash('cas-proof:'+peer),now=Date.now()
    const row=this.db.prepare(`INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET
      attempts=CASE WHEN auth_limits.expires>? THEN auth_limits.attempts+1 ELSE 1 END,
      expires=CASE WHEN auth_limits.expires>? THEN auth_limits.expires ELSE excluded.expires END RETURNING attempts`).get(id,now+900000,now,now)
    if(row.attempts>12)throw new CASFailure('认证尝试过多，请稍后重试',429)
    const session=this.session(raw),account=session?this.account(session.accountId):null
    if(!account||account.accountDisabledAt||account.revokedAt||(account.expiresAt&&new Date(account.expiresAt).getTime()<=now)||typeof key!=='string'||key.length>256)throw new CASFailure('请使用当前账号的有效 Key 验证')
    const a=Buffer.from(hash(key)),b=Buffer.from(account.keyHash)
    if(a.length!==b.length||!timingSafeEqual(a,b))throw new CASFailure('请使用当前账号的有效 Key 验证')
    if(session.authSource==='key'&&session.credentialVersion!==(account.credentialVersion??1))throw new CASFailure('原会话已失效',401)
    return session
  }
  async beginLogin(binding){return (await this.sdk()).beginLogin({browserBinding:binding})}
  async beginLink(raw,key,peer,binding){
    const session=this.prove(raw,key,peer)
    return (await this.sdk()).beginLink({browserBinding:binding,localAccountRef:session.accountId,localSessionId:hash(raw)})
  }
  sameIdentity(a,b){return ['id','client_id','subject','local_account_ref'].every(key=>a[key]===b[key])}
  async accept(remote){
    if(remote.state==='revoked')await this.store.applyVerifiedEvent({id:'reconcile:'+remote.id+':'+remote.version,type:'account_link.revoked',link:remote})
    else this.store.save(remote)
    const row=this.db.prepare('SELECT state,version FROM fastcas_links WHERE issuer=? AND id=?').get(this.config.issuer,remote.id)
    if(!row||row.state!==remote.state||row.version!==remote.version)throw new CASFailure('认证状态已更改，请重试',409)
  }
  async reconcile(accountId){
    const local=this.store.current(accountId)
    if(!local)throw new CASFailure('没有待处理的认证',404)
    const sdk=await this.sdk();let remote=await sdk.getLink(local.id)
    if(!this.sameIdentity(local,remote))throw new CASFailure('认证关系不匹配')
    if(remote.state==='prepared')remote=await sdk.activateLink(remote.id)
    await this.accept(remote)
    return remote
  }
  async finish(callback,binding,raw){
    const sdk=await this.sdk(),session=this.session(raw)
    const result=await sdk.finishLogin(new URL(callback),{browserBinding:binding,localAccountRef:session?.accountId,localSessionId:session?hash(raw):undefined})
    if(result.transaction.purpose==='link'){
      const link=await sdk.prepareLink(result),current=this.session(raw),account=current?this.account(current.accountId):null
      if(!current||current.accountId!==session?.accountId||link.local_account_ref!==current.accountId||!account||account.accountDisabledAt)throw new CASFailure('原账号会话已失效',401)
      if(current.authSource==='key'&&(account.revokedAt||current.credentialVersion!==(account.credentialVersion??1)))throw new CASFailure('原 Key 已失效',401)
      this.store.save(link)
      await this.accept(await sdk.activateLink(link.id))
      return null
    }
    if(result.transaction.purpose!=='login')throw new CASFailure('请先获取项目账号')
    const local=this.store.bySubject(result.identity.subject)
    if(!local)throw new CASFailure('尚未绑定项目账号，请先用 Key 登录并认证',409)
    if(local.state==='prepared')await this.reconcile(local.local_account_ref)
    return this.issue(await sdk.resolveLink(result.identity.subject),result.identity)
  }
  issue(link,identity){
    this.store.validate(link)
    if(identity.issuer!==this.config.issuer||identity.subject!==link.subject||link.state!=='active')throw new CASFailure('认证关系无效')
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const local=this.store.current(link.local_account_ref),account=this.account(link.local_account_ref)
      if(!local||!this.sameIdentity(local,link)||local.version!==link.version||local.state!=='active'||!account||account.accountDisabledAt)throw new CASFailure('项目账号或认证关系不可用')
      const raw=randomBytes(32).toString('base64url'),now=Date.now()
      this.sessions.set(raw,{role:'member',accountId:account.accountId,keyId:account.id,person:account.person,authSource:'fastcas',authenticatedAt:now,expiresAt:now+8*3600000,casIssuer:this.config.issuer,casSid:identity.sessionId,casLinkId:link.id,casLinkVersion:link.version,casChecked:now})
      this.db.exec('COMMIT');return raw
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  async revoke(raw,key,peer){
    const session=this.prove(raw,key,peer),local=this.store.current(session.accountId)
    if(!local)return
    const sdk=await this.sdk(),remote=await sdk.getLink(local.id)
    if(!this.sameIdentity(local,remote))throw new CASFailure('认证关系不匹配')
    await this.accept(remote.state==='revoked'?remote:await sdk.revokeLink(remote))
  }
  async validateSession(raw){
    const session=this.session(raw)
    if(!session||session.authSource!=='fastcas')return
    const local=this.store.current(session.accountId),account=this.account(session.accountId)
    if(!this.enabled||session.casIssuer!==this.config.issuer||!local||local.id!==session.casLinkId||local.version!==session.casLinkVersion||local.state!=='active'||!account||account.accountDisabledAt)throw new CASFailure('FastCAS 会话已失效，请使用项目登录',401)
    if(session.casChecked+300000>Date.now())return
    let remote
    try{remote=await(await this.sdk()).resolveLink(local.subject)}catch{throw new CASFailure('无法确认 FastCAS 认证，请使用项目登录',401)}
    if(!this.sameIdentity(local,remote)||remote.state!=='active'||remote.version!==local.version)throw new CASFailure('FastCAS 认证关系已更改',401)
    const changed=this.db.prepare(`UPDATE auth_handles SET payload=json_set(payload,'$.casChecked',?) WHERE namespace='session' AND hash=? AND expires>? AND EXISTS(
      SELECT 1 FROM fastcas_links l WHERE l.issuer=? AND l.id=? AND l.state='active' AND l.version=?)`).run(Date.now(),this.sessions.hash(raw),Date.now(),this.config.issuer,local.id,local.version)
    if(!changed.changes)throw new CASFailure('会话已失效',401)
  }
  async delegatedNewsAccount(raw){
    if(!this.enabled||typeof raw!=='string'||!/^Bearer [A-Za-z0-9._~-]+$/.test(raw))throw new CASFailure('需要受限委托令牌',401)
    const token=raw.slice(7),sdk=await this.sdk()
    let claims,live
    try{
      claims=await sdk.verifyAccessToken(token,'research-api',['research:read'])
      live=await sdk.introspectToken(token)
    }catch{throw new CASFailure('委托令牌无效',401)}
    if(!live.active||claims.delegated!==true||claims.service!==false||claims.client_id!=='news'||claims.act?.sub!=='news'||
       live.sub!==claims.sub||live.client_id!=='news'||!Array.isArray(live.aud)||!live.aud.includes('research-api')||
       !String(live.scope??'').split(' ').includes('research:read'))throw new CASFailure('委托令牌权限不足',403)
    const local=this.store.bySubject(claims.sub)
    if(!local||local.state!=='active')throw new CASFailure('Research 账号未绑定',403)
    let remote
    try{remote=await sdk.resolveLink(claims.sub)}catch{throw new CASFailure('无法确认 Research 账号绑定',403)}
    if(!this.sameIdentity(local,remote)||remote.state!=='active'||remote.version!==local.version)throw new CASFailure('Research 账号绑定已更改',403)
    const account=this.account(local.local_account_ref)
    if(!account||account.accountDisabledAt)throw new CASFailure('Research 账号不可用',403)
    return local.local_account_ref
  }
}
