import {http,keccak256} from 'viem';
// viem prepares nonce/fees/signature before invoking transport.request(sendRaw).
// Hook that RPC invocation, never writeContract start or receipt completion.
export function broadcastTimedTransport(baseFactory,{now=Date.now,onObservation=()=>{}}={}){
 const records=new Map();
 const transport=options=>{
  const base=baseFactory({...options,retryCount:0});
  return {...base,request:async(request,rpcOptions)=>{
   if(request.method!=='eth_sendRawTransaction')return base.request(request,rpcOptions);
   const raw=request.params?.[0];if(typeof raw!=='string')throw Error('raw transaction bytes required for broadcast clock');
   const hash=keccak256(raw),record={hash,method:'eth_sendRawTransaction',broadcastStartedAt:now(),timingBasis:'transport eth_sendRawTransaction invocation',attempt:1};
   if(records.has(hash))throw Error('duplicate raw transaction broadcast blocked by timing guard');
   records.set(hash,record);
   try{
    // Invoke request immediately after recording timestamp. Observers run after invocation.
    const pending=base.request(request,rpcOptions);onObservation({...record});
    const result=await pending;record.broadcastRpcReturnedAt=now();
    if(typeof result!=='string'||result.toLowerCase()!==hash.toLowerCase())throw Error('RPC returned transaction hash differs from signed bytes');
    record.state='BroadcastHashReturned';onObservation({...record});return result;
   }catch(error){record.state='BroadcastOutcomeUnknown';record.error=error.shortMessage||error.message;record.broadcastRpcReturnedAt=now();onObservation({...record});throw error;}
  }};
 };
 return {transport,records,get:hash=>{const record=records.get(hash.toLowerCase());if(!record)throw Error('transaction has no captured eth_sendRawTransaction broadcast timestamp');return {...record};}};
}
export function timedHttp(url,options={}){const {now,onObservation,...httpOptions}=options;return broadcastTimedTransport(http(url,{...httpOptions,retryCount:0,batch:false}),{now,onObservation});}
export function transactionTiming(clock,hash,prepareStartedAt){
 const record=clock.get(hash);
 if(!Number.isFinite(prepareStartedAt)||prepareStartedAt>record.broadcastStartedAt)throw Error('invalid transaction preparation chronology');
 return {...record,prepareStartedAt,preparationMs:record.broadcastStartedAt-prepareStartedAt,sentAt:record.broadcastStartedAt};
}
