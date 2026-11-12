import test from 'node:test';
import assert from 'node:assert/strict';
import {ServiceIngest} from './service-ingest.mjs';

test('service token publishing requires exact client, scope, audience and explicit stable recipient',async()=>{
 const env={FASTRESEARCH_FASTCAS_INGEST_ISSUER:'https://cas.example.test',FASTRESEARCH_FASTCAS_INGEST_CLIENT_ID:'insight-service',FASTRESEARCH_FASTCAS_INGEST_ALLOWED_ACCOUNT_IDS:'account-a'};
 const records=[{id:'key-a',person:'Same Name'},{id:'key-b',person:'Same Name'}];
 const accounts={accountIdForKey:id=>id==='key-a'?'account-a':'account-b'};
 const service=new ServiceIngest({env,sdk:{verifyAccessToken:async (raw,audience,scopes)=>{assert.equal(raw,'signed-service');assert.equal(audience,'research-api');assert.deepEqual(scopes,['insight:publish']);return {service:true,sub:'insight-service',client_id:'insight-service'}}}});
 const result=await service.targets({headers:{authorization:'Bearer signed-service'}},{person:'Same Name',receiver_ref:'account-a'},records,accounts);
 assert.deepEqual(result.targets.map(x=>x.id),['key-a']);
 await assert.rejects(service.targets({headers:{authorization:'Bearer signed-service'}},{person:'Same Name'},records,accounts),error=>error.status===403);
 await assert.rejects(service.targets({headers:{authorization:'Bearer signed-service'}},{receiver_ref:'account-b'},records,accounts),error=>error.status===403);
 await assert.rejects(service.targets({headers:{authorization:'Bearer signed-service','x-fastinsight-key':'legacy'}},{receiver_ref:'account-a'},records,accounts),error=>error.status===400);
 const wrong=new ServiceIngest({env,sdk:{verifyAccessToken:async()=>({service:false,sub:'insight-service',client_id:'insight-service'})}});
 await assert.rejects(wrong.targets({headers:{authorization:'Bearer signed-service'}},{receiver_ref:'account-a'},records,accounts),error=>error.status===403);
 const failClosed=new ServiceIngest({env,sdk:{verifyAccessToken:async()=>{throw Error('network unavailable')}}});
 await assert.rejects(failClosed.targets({headers:{authorization:'Bearer signed-service'}},{receiver_ref:'account-a'},records,accounts),error=>error.status===401);
 assert.equal(await service.targets({headers:{}},{},records,accounts),null);
 assert.throws(()=>new ServiceIngest({env:{FASTRESEARCH_FASTCAS_INGEST_ISSUER:'https://cas.example.test'}}));
});
