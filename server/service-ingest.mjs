export class ServiceIngestError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

// Machine publishing is separate from browser login and the legacy ingest key.
// A service credential never grants a member session or permission to choose a
// recipient by display name.
export class ServiceIngest {
  constructor({env=process.env, sdk}={}) {
    this.issuer = env.FASTRESEARCH_FASTCAS_INGEST_ISSUER ?? ''
    this.clientId = env.FASTRESEARCH_FASTCAS_INGEST_CLIENT_ID ?? ''
    this.allowedAccountIds = new Set((env.FASTRESEARCH_FASTCAS_INGEST_ALLOWED_ACCOUNT_IDS ?? '').split(',').map(x=>x.trim()).filter(Boolean))
    const values = [this.issuer, this.clientId, this.allowedAccountIds.size]
    if (values.some(Boolean) && !values.every(Boolean)) throw new Error('FastCAS service ingest requires issuer, client ID and explicit allowed account IDs')
    this.enabled = values.every(Boolean)
    this.sdkInstance = sdk
    this.allowLoopbackHTTP = env.FASTRESEARCH_FASTCAS_ALLOW_LOOPBACK_HTTP === 'true'
  }
  async sdk() {
    if (!this.sdkInstance) {
      this.sdkPromise ??= import('@fastrd/fastcas/server').then(({FastCAS}) => new FastCAS({issuer:this.issuer,clientId:this.clientId,redirectUri:this.issuer+'/console/',allowLoopbackHTTP:this.allowLoopbackHTTP}, {put:async()=>{throw Error('service verifier cannot start login')},take:async()=>{throw Error('service verifier cannot finish login')}}))
      try { this.sdkInstance=await this.sdkPromise } catch(error) { this.sdkPromise=undefined;throw error }
    }
    return this.sdkInstance
  }
  async targets(request, body, records, accountStore) {
    const authorization=String(request.headers.authorization??'')
    if (!authorization) return null
    if (request.headers['x-fastinsight-key']) throw new ServiceIngestError(400,'只能使用一种发布凭证')
    if (!this.enabled) throw new ServiceIngestError(401,'此部署未启用 FastCAS 服务投递')
    const match=/^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization)
    if (!match) throw new ServiceIngestError(401,'服务令牌格式无效')
    let claims
    try { claims=await(await this.sdk()).verifyAccessToken(match[1],'research-api',['insight:publish']) }
    catch { throw new ServiceIngestError(401,'服务令牌无效或权限不足') }
    if (claims.service!==true || claims.sub!==this.clientId || claims.client_id!==this.clientId) throw new ServiceIngestError(403,'服务身份不匹配')
    const accountId=String(body.receiver_ref??'').trim()
    if (!accountId || !this.allowedAccountIds.has(accountId)) throw new ServiceIngestError(403,'收件人不在服务授权范围')
    const targets=records.filter(record=>!record.accountDisabledAt&&accountStore.accountIdForKey(record.id)===accountId)
    if(targets.length!==1)throw new ServiceIngestError(404,'收件账号不存在或不可用')
    return {targets,clientId:this.clientId,accountId}
  }
}
