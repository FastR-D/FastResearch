import { randomBytes } from 'node:crypto'

export async function handleFastCAS(request,response,context) {
  const {service,route,sendJson,requireMember,readCookies,getRequestToken,memberCookieHeader}=context
  if(!route.startsWith('/api/auth/fastcas/'))return false
  const send=(status,data,headers={})=>sendJson(response,status,data,headers)
  const secure=service.enabled&&new URL(service.config.redirectUri).protocol==='https:'
  const bindingCookie=(value,age)=>`fr_fastcas_binding=${encodeURIComponent(value)}; Path=/api/auth/fastcas; HttpOnly; SameSite=Lax; Max-Age=${age}${secure?'; Secure':''}`
  const redirect=(location,cookies=[])=>{response.writeHead(302,{Location:location,'Set-Cookie':cookies,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});response.end()}
  try{
    if(route==='/api/auth/fastcas/available'&&request.method==='GET'){send(200,{enabled:service.enabled});return true}
    if(!service.enabled){send(404,{error:'未启用 FastCAS'});return true}
    if(route==='/api/auth/fastcas/events'&&request.method==='POST'){
      if(String(request.headers['content-type']??'').split(';')[0]!=='application/jwt'){send(415,{error:'需要签名事件'});return true}
      await(await service.sdk()).handleNotification(request.rawBody,event=>
        event.type==='account_link.revoked' ? service.store.applyVerifiedEvent(event) :
        event.status==='disabled' ? service.store.applyVerifiedLogout({id:event.id,subject:event.subject}) : undefined)
      send(200,{ok:true});return true
    }
    if(route==='/api/auth/fastcas/backchannel-logout'&&request.method==='POST'){
      if(String(request.headers['content-type']??'').split(';')[0]!=='application/x-www-form-urlencoded'){
        send(415,{error:'需要标准退出通知'});return true
      }
      const form=new URLSearchParams(request.rawBody??'')
      const tokens=form.getAll('logout_token')
      if(tokens.length!==1||form.size!==1||tokens[0].length>65536){send(400,{error:'退出通知格式无效'});return true}
      const notice=await(await service.sdk()).verifyLogout(tokens[0])
      await service.store.applyVerifiedLogout(notice)
      send(200,{ok:true});return true
    }
    if(route==='/api/auth/fastcas/login'&&request.method==='GET'){
      const binding=randomBytes(32).toString('base64url')
      redirect(String(await service.beginLogin(binding)),[bindingCookie(binding,300)]);return true
    }
    if(route==='/api/auth/fastcas/callback'&&request.method==='GET'){
      const callback=new URL(service.config.redirectUri)
      callback.search=new URL(request.url,'http://localhost').search
      try{
        // Binding callbacks use the browser cookie, not an injected bearer header.
        const raw=readCookies(request)[context.cookieName]??''
        const token=await service.finish(callback.href,readCookies(request).fr_fastcas_binding??'',raw)
        const cookies=[bindingCookie('',0)]
        if(token)cookies.push(memberCookieHeader(request,token,service.sessions.get(token).expiresAt)['Set-Cookie'])
        redirect('/?fastcas=complete',cookies)
      }catch{redirect('/?fastcas=failed',[bindingCookie('',0)])}
      return true
    }
    if(request.method==='POST'&&request.headers.origin!==new URL(service.config.redirectUri).origin){send(403,{error:'不允许跨站认证操作'});return true}
    const member=requireMember(request,response)
    if(!member)return true
    const accountId=member.accountId??service.accounts.accountIdForKey(member.keyId)
    if(route==='/api/auth/fastcas/status'&&request.method==='GET'){
      send(200,{enabled:true,link:service.store.current(accountId)});return true
    }
    const raw=getRequestToken(request)
    if(route==='/api/auth/fastcas/link'&&request.method==='POST'){
      const binding=randomBytes(32).toString('base64url')
      const url=await service.beginLink(raw,request.parsedBody?.key,request.socket.remoteAddress??'unknown',binding)
      send(200,{url:String(url)},{'Set-Cookie':bindingCookie(binding,300)});return true
    }
    if(route==='/api/auth/fastcas/reconcile'&&request.method==='POST'){
      await service.reconcile(accountId);send(200,{ok:true});return true
    }
    if(route==='/api/auth/fastcas/revoke'&&request.method==='POST'){
      await service.revoke(raw,request.parsedBody?.key,request.socket.remoteAddress??'unknown');send(200,{ok:true});return true
    }
    send(404,{error:'接口不存在'})
  }catch(error){send([400,401,403,409,429].includes(error.status)?error.status:502,{error:'FastCAS 操作未完成，请重试或使用原 Key 登录'})}
  return true
}
