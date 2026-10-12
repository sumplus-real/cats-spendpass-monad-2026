import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256} from 'viem';
import {broadcastTimedTransport,transactionTiming} from './broadcast-timing.mjs';
import {VerifiedGate} from './worker.mjs';
const raw='0x01020304',hash=keccak256(raw);
test('slow estimate knownbad clock fails while exact broadcast clock meets same Verified 5s bound',async()=>{
 let time=1000;let invokedAt;
 const clock=broadcastTimedTransport(()=>({request:async request=>{if(request.method==='eth_estimateGas'){time+=7000;return '0x100';}if(request.method==='eth_sendRawTransaction'){invokedAt=time;time+=25;return hash;}}}),{now:()=>time});
 const rpc=clock.transport({});const prepareStartedAt=time;
 await rpc.request({method:'eth_estimateGas',params:[]});await rpc.request({method:'eth_sendRawTransaction',params:[raw]});
 const timing=transactionTiming(clock,hash,prepareStartedAt);assert.equal(timing.prepareStartedAt,1000);assert.equal(timing.broadcastStartedAt,8000);assert.equal(timing.broadcastStartedAt,invokedAt);
 const verifiedAt=8500;
 assert.ok(verifiedAt-prepareStartedAt>5000,'knownbad pre-estimate timestamp must fail machine threshold');
 assert.ok(verifiedAt-timing.broadcastStartedAt<=5000,'same actual broadcast→Verified passes');
 assert.equal(timing.sentAt,timing.broadcastStartedAt,'sentAt remains broadcast start, never shifted later');
 const gate=new VerifiedGate();gate.ingest({hash,blockId:'proposal',number:'42',commitState:'Verified'},verifiedAt);
 assert.equal(gate.match({blockHash:hash,blockNumber:42n},'proposal').receivedAt-timing.broadcastStartedAt,500);
});
test('RPC completion timestamp is never substituted for broadcast start',async()=>{let time=1;const clock=broadcastTimedTransport(()=>({request:async()=>{time+=4500;return hash;}}),{now:()=>time});await clock.transport({}).request({method:'eth_sendRawTransaction',params:[raw]});assert.equal(clock.get(hash).broadcastStartedAt,1);assert.equal(clock.get(hash).broadcastRpcReturnedAt,4501);});
test('duplicate raw broadcast rejected without additional RPC',async()=>{let calls=0;const clock=broadcastTimedTransport(()=>({request:async()=>{calls++;return hash;}}));const rpc=clock.transport({});await rpc.request({method:'eth_sendRawTransaction',params:[raw]});await assert.rejects(rpc.request({method:'eth_sendRawTransaction',params:[raw]}),/duplicate raw/);assert.equal(calls,1);});
test('ambiguous RPC failure retains original broadcast time/hash and never rebroadcasts',async()=>{let calls=0;const clock=broadcastTimedTransport(()=>({request:async()=>{calls++;throw Error('connection lost');}}),{now:()=>10});const rpc=clock.transport({});await assert.rejects(rpc.request({method:'eth_sendRawTransaction',params:[raw]}),/connection lost/);assert.equal(clock.get(hash).state,'BroadcastOutcomeUnknown');assert.equal(clock.get(hash).broadcastStartedAt,10);await assert.rejects(rpc.request({method:'eth_sendRawTransaction',params:[raw]}),/duplicate raw/);assert.equal(calls,1);});
test('timing lookup rejects absent hashes and dishonest preparation chronology',async()=>{const clock=broadcastTimedTransport(()=>({request:async()=>hash}),{now:()=>10});assert.throws(()=>clock.get(hash),/no captured/);await clock.transport({}).request({method:'eth_sendRawTransaction',params:[raw]});assert.throws(()=>transactionTiming(clock,hash,11),/chronology/);});
test('real viem HTTP transport hook observes sendRaw invocation, after slow preparation RPC',async()=>{
 const {createServer}=await import('node:http');const {timedHttp}=await import('./broadcast-timing.mjs');let serverReceivedSend;
 const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const q=JSON.parse(body);if(q.method==='eth_estimateGas')await new Promise(r=>setTimeout(r,40));if(q.method==='eth_sendRawTransaction')serverReceivedSend=Date.now();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result:q.method==='eth_sendRawTransaction'?hash:'0x100'}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const clock=timedHttp(`http://127.0.0.1:${server.address().port}`,{timeout:1000});const rpc=clock.transport({});const prepare=Date.now();await rpc.request({method:'eth_estimateGas',params:[]});await rpc.request({method:'eth_sendRawTransaction',params:[raw]});const timing=transactionTiming(clock,hash,prepare);assert.ok(timing.preparationMs>=35);assert.ok(timing.broadcastStartedAt<=serverReceivedSend);assert.ok(serverReceivedSend-timing.broadcastStartedAt<1000);assert.equal(timing.sentAt,timing.broadcastStartedAt);}finally{server.close();}
});
