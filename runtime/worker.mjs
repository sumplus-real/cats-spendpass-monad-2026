import {canonicalProviderBody,providerInputHash,providerModelHash,canonicalJobIdentity,deepFreeze} from './binding.mjs';
import {quoteDigest,verifyQuote} from './quote.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
export class VerifiedGate extends EventEmitter {
 constructor(){super();this.headers=new Map();this.raw=[];this.invalidated=new Set();}
 ingest(message,receivedAt=Date.now()){
  const parsed=typeof message==='string'?JSON.parse(message):message;
  const h=parsed?.params?.result??parsed;
  if(!h || !h.blockId || !h.hash || !h.number || !h.commitState)return false;
  const key=h.hash.toLowerCase();const prior=this.headers.get(key);
  if(prior&&!same(prior.blockId,h.blockId)){this.invalidated.add(key);this.emit('header',h);throw new Error('proposal blockId changed for same hash; proof invalidated');}
  const record={...h,receivedAt};this.raw.push(record);
  if(h.commitState==='Verified'||!prior)this.headers.set(key,record);
  this.emit('header',record);return true;
 }
 match(receipt,expectedBlockId){
  const key=receipt.blockHash?.toLowerCase();if(this.invalidated.has(key))return null;
  const h=this.headers.get(key);
  if(!h||h.commitState!=='Verified'||BigInt(h.number)!==BigInt(receipt.blockNumber))return null;
  if(expectedBlockId&&!same(h.blockId,expectedBlockId))return null;
  return h;
 }
 wait(receipt,{timeoutMs=5000,expectedBlockId}={}){
  const found=this.match(receipt,expectedBlockId);if(found)return Promise.resolve(found);
  return new Promise((resolve,reject)=>{
   const listener=()=>{const h=this.match(receipt,expectedBlockId);if(h){clearTimeout(timer);this.off('header',listener);resolve(h);}};
   const timer=setTimeout(()=>{this.off('header',listener);reject(new Error('WS Verified timeout; no dispatch'));},Math.max(0,timeoutMs));this.on('header',listener);
  });
 }
}
export class DurableWorker {
 constructor({directory,contractAddress,chainId=10143,operator,payee,gate,readAcceptance,provider,maxConfirmationMs=5000,providerTimeoutMs=60000}){
  if(chainId!==10143||!/^0x[0-9a-f]{40}$/i.test(contractAddress))throw new Error('pinned deployment chain10143/contract required');
  fs.mkdirSync(directory,{recursive:true});Object.assign(this,{directory,contractAddress,chainId,operator,payee,gate,readAcceptance,provider,maxConfirmationMs,providerTimeoutMs});
 }
 file(id){if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new Error('invalid job id');return path.join(this.directory,id+'.json');}
 load(id){const f=this.file(id);return fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):null;}
 save(id,value){const f=this.file(id),tmp=f+'.tmp';const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,json(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,f);const d=fs.openSync(this.directory,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}return value;}
 async runAccepted(inputJob){
  const job=structuredClone(inputJob);
  const {receipt,fee,acceptSentAt=Date.now(),expectedBlockId}=job;
  if(!Number.isFinite(acceptSentAt))throw Error('accept start time required');
  if(job.broadcastStartedAt!==undefined&&(job.broadcastStartedAt!==acceptSentAt||job.prepareStartedAt>job.broadcastStartedAt))throw Error('broadcast clock chronology mismatch');
  const id=canonicalJobIdentity(this.chainId,this.contractAddress,job.grantId);
  if(job.contractAddress&&!same(job.contractAddress,this.contractAddress)||job.chainId!==undefined&&job.chainId!==this.chainId)throw new Error('job deployment domain mismatch');
  if(!same(receipt.to,this.contractAddress))throw new Error('accept receipt.to is not pinned contract');
  const q=job.quote;
  if(!q||!same(q.grantId,job.grantId)||!same(q.operator,this.operator)||!same(q.payee,this.payee)||BigInt(q.fee)!==BigInt(fee))throw new Error('quote grant/operator/payee/fee binding mismatch');
  job.providerBody=canonicalProviderBody(job.providerInput);
  if(!same(q.taskInputHash,providerInputHash(job.providerInput))||!same(q.modelHash,providerModelHash(job.providerInput)))throw new Error('signed quote prompt/model binding mismatch');
  if(!await verifyQuote(this.contractAddress,q,job.quoteSignature))throw new Error('invalid signed operator quote');
  const expectedQuoteHash=quoteDigest(this.contractAddress,q);
  job.providerInput=JSON.parse(job.providerBody);deepFreeze(job);
  const lock=this.file(id)+'.lock';let fd;
  try{fd=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')return {state:'Unknown',reason:'worker lock exists; inspect manually, never redispatch'};throw e;}
  try{
   let old=this.load(id);
   if(!old){
    for(const filename of fs.readdirSync(this.directory).filter(x=>x.endsWith('.json')&&x!==id+'.json')){
     let prior;try{prior=JSON.parse(fs.readFileSync(path.join(this.directory,filename),'utf8'));}catch{throw new Error('unreadable legacy worker record; fail closed');}
     if(same(prior.grantId,job.grantId)){
      old=this.save(id,{...prior,id,legacyRecord:filename,reason:'legacy same-grant record migrated; no redispatch'});break;
     }
    }
   }
   if(old){if(['DispatchIntent','InFlight'].includes(old.state))return this.save(id,{...old,state:'Unknown',reason:'process ended after dispatch intent; provider result uncertain',updatedAt:Date.now()});return old;}
   let record={id,displayJobId:job.id,contractAddress:this.contractAddress,chainId:this.chainId,quoteHash:expectedQuoteHash,taskInputHash:q.taskInputHash,modelHash:q.modelHash,grantId:job.grantId,receipt,state:'AcceptedPaidUndispatched',fee:String(fee),operator:this.operator,payee:this.payee,acceptSentAt,broadcastStartedAt:job.broadcastStartedAt??null,prepareStartedAt:job.prepareStartedAt??null,timingBasis:job.broadcastStartedAt!==undefined?'transport eth_sendRawTransaction invocation':'legacy caller-supplied time; not exact broadcast proof',createdAt:Date.now(),events:[]};
   if(!['success',1,'0x1',1n].includes(receipt.status))throw new Error('accept receipt status is not success');
   this.save(id,record);
   try{
    const remaining=this.maxConfirmationMs-(Date.now()-acceptSentAt);
    const h=await this.gate.wait(receipt,{timeoutMs:remaining,expectedBlockId});
    if(h.receivedAt<acceptSentAt||h.receivedAt-acceptSentAt>this.maxConfirmationMs)throw new Error('accept-to-Verified exceeds frozen confirmation margin');
    const a=await this.readAcceptance(job,h);
    if(a.offerState!=='Accepted'||!same(a.operator,this.operator)||!same(a.payee,this.payee)||BigInt(a.fee)!==BigInt(fee)||BigInt(a.providerUnclaimed)+BigInt(a.providerClaimed??0)!==BigInt(fee)||!same(a.grantId,job.grantId)||!same(a.quoteHash,expectedQuoteHash)||!same(a.policyHash,q.policyHash))throw new Error('Accepted state/payee entitlement mismatch');
    record={...record,verified:{blockId:h.blockId,hash:h.hash,number:h.number,receivedAt:h.receivedAt},events:[...record.events,{state:'VerifiedAcceptedEntitlement',at:Date.now()}]};
   }catch(e){return this.save(id,{...record,state:'AcceptedPaidUndispatched',reason:e.message,updatedAt:Date.now()});}
   record=this.save(id,{...record,state:'DispatchIntent',events:[...record.events,{state:'DispatchIntent',at:Date.now()}]});
   record=this.save(id,{...record,state:'InFlight',events:[...record.events,{state:'InFlight',at:Date.now()}]});
   try{
    let timeout;
    const controller=new AbortController();
    let result;
    try{result=await Promise.race([
     this.provider(job,{signal:controller.signal}),
     new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('provider timeout; outcome unknown; never redispatch'));},this.providerTimeoutMs);})
    ]);}finally{clearTimeout(timeout);}
    if(!result || typeof result!=='object' || !result.usage || typeof result.usage!=='object')throw new Error('provider response/actual usage missing; cannot mark Completed');
    return this.save(id,{...record,state:'Completed',result,updatedAt:Date.now(),events:[...record.events,{state:'Completed',at:Date.now()}]});
   }catch(e){return this.save(id,{...record,state:e.definitiveFailure===true?'Failed':'Unknown',reason:e.message,updatedAt:Date.now()});}
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
 }
}
