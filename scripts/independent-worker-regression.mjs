// Independent regression probe. All WS, chain reads and provider results are labelled fixtures.
// The provider is an actual local HTTP server, so counters measure real HTTP dispatches.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import {encodeEventTopics,encodeAbiParameters,keccak256,stringToHex,hashTypedData} from 'viem';
import {DurableWorker,VerifiedGate} from '../runtime/worker.mjs';
import {acceptanceReader} from '../runtime/chain.mjs';
import {canonicalProviderBody,jsonHttpProvider} from '../runtime/binding.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cats-independent-'));
const account=privateKeyToAccount('0x'+crypto.randomBytes(32).toString('hex'));
const address='0x'+ 'ab'.repeat(20),payee='0x'+'cd'.repeat(20),policyHash='0x'+'ef'.repeat(32);
const abi=JSON.parse(fs.readFileSync(new URL('../contracts/SpendPass.abi.json',import.meta.url)));
const types={Quote:[{name:'grantId',type:'bytes32'},{name:'operator',type:'address'},{name:'payee',type:'address'},{name:'taskInputHash',type:'bytes32'},{name:'modelHash',type:'bytes32'},{name:'fee',type:'uint256'},{name:'expiry',type:'uint256'},{name:'nonce',type:'uint256'},{name:'policyHash',type:'bytes32'},{name:'assetNativeMON',type:'address'}]};
let counter=0;const received=[];
const server=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;counter++;received.push(JSON.parse(text));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({fixture:true,choices:[{message:{content:'fixture response'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
const results=[];
async function make(label,mutation={}){
 const input={model:'fixture-model',messages:[{role:'user',content:'bound fixture task'}],temperature:0};
 const grantId=keccak256(stringToHex(label)),blockHash=keccak256(stringToHex('block-'+label)),blockId=keccak256(stringToHex('proposal-'+label)),transactionHash=keccak256(stringToHex('tx-'+label));
 const q={grantId,operator:account.address,payee,taskInputHash:keccak256(stringToHex(canonicalProviderBody(input))),modelHash:keccak256(stringToHex(input.model)),fee:4000000000000000n,expiry:9999999999n,nonce:1n,policyHash};
 const typed={domain:{name:'CATS SpendPass',version:'1',chainId:10143,verifyingContract:address},types,primaryType:'Quote',message:{...q,assetNativeMON:'0x'+'00'.repeat(20)}};
 const sig=await account.signTypedData(typed),qh=hashTypedData(typed);
 const actual={to:address,status:'success',blockNumber:7n,blockHash,transactionHash,logs:[{address,topics:encodeEventTopics({abi,eventName:'Accepted',args:{grantId,payee}}),data:encodeAbiParameters([{type:'uint256'}],[q.fee])}]};
 if(mutation.missingLog)actual.logs=[];if(mutation.wrongActualTo)actual.to=payee;
 const client={getChainId:async()=>10143,getTransactionReceipt:async()=>actual,getBlock:async()=>({hash:blockHash}),readContract:async({functionName})=>functionName==='offers'?[2,account.address,payee,q.fee,q.expiry,mutation.wrongQuoteHash?'0x'+'00'.repeat(32):qh]:functionName==='grants'?[grantId,4000000000000000n,0n,0n,mutation.claimed?q.fee*0n:q.fee,mutation.claimed?q.fee:mutation.excessEntitlement?1n:0n,0n,0n,2]:policyHash};
 const sent=Date.now();const gate=new VerifiedGate();gate.ingest({blockId,hash:blockHash,number:'0x7',commitState:'Verified'},sent+1);if(mutation.conflictingProposal)assert.throws(()=>gate.ingest({blockId:'0x'+'99'.repeat(32),hash:blockHash,number:'0x7',commitState:'Verified'},sent+2));
 const job={id:label,grantId,fee:q.fee,receipt:{...actual,logs:undefined,to:mutation.wrongClaimedTo?payee:address},quote:q,quoteSignature:sig,providerInput:input,acceptSentAt:sent,expectedBlockId:blockId};
 const worker=new DurableWorker({directory:path.join(dir,label),contractAddress:address,operator:account.address,payee,gate,readAcceptance:acceptanceReader(client,address,abi),provider:jsonHttpProvider({url}),maxConfirmationMs:mutation.conflictingProposal?50:5000});
 return {job,worker};
}
try {
 const positive=await make('positive');const start=counter;const first=await positive.worker.runAccepted(positive.job);assert.equal(first.state,'Completed');assert.equal(counter-start,1);
 const alias=await positive.worker.runAccepted({...positive.job,id:'alias_second_job_id'});assert.equal(alias.state,'Completed');assert.equal(counter-start,1);results.push({case:'same Accepted receipt/grant with changed job.id',state:alias.state,httpCalls:counter-start,pass:true});
 const racing=await make('concurrent');const n=counter;await Promise.all([racing.worker.runAccepted(racing.job),racing.worker.runAccepted({...racing.job,id:'racing_alias'})]);assert.equal(counter-n,1);results.push({case:'concurrent aliases share durable lock',httpCalls:counter-n,pass:true});
 for(const [label,mutate] of [['changed_prompt',j=>{j.providerInput.messages[0].content='unsigned task';}],['changed_model',j=>{j.providerInput.model='unsigned model';}]]) {
  const {worker,job}=await make(label);mutate(job);const n=counter;await assert.rejects(worker.runAccepted(job),/prompt\/model binding/);assert.equal(counter-n,0);results.push({case:label,httpCalls:counter-n,pass:true});
 }
 for(const [label,mutation] of [['wrong_claimed_to',{wrongClaimedTo:true}],['wrong_actual_to',{wrongActualTo:true}],['missing_accepted_log',{missingLog:true}],['quote_hash_mismatch',{wrongQuoteHash:true}],['excess_entitlement',{excessEntitlement:true}],['conflicting_verified_proposal',{conflictingProposal:true}]]) {
  const {worker,job}=await make(label,mutation);const n=counter;let state,reason;if(mutation.wrongClaimedTo){await assert.rejects(worker.runAccepted(job),/receipt.to/);state='Rejected';}else{const r=await worker.runAccepted(job);state=r.state;reason=r.reason;assert.equal(state,'AcceptedPaidUndispatched');}
  assert.equal(counter-n,0);results.push({case:label,state,reason,httpCalls:counter-n,pass:true});
 }
 const claimed=await make('claimed_fee_positive',{claimed:true});const cn=counter;const cr=await claimed.worker.runAccepted(claimed.job);assert.equal(cr.state,'Completed');assert.equal(counter-cn,1);results.push({case:'acceptance fee already claimed to fixed payee',state:cr.state,httpCalls:counter-cn,pass:true});
 assert.equal(counter,3);assert.equal(received.length,3);assert.equal(received[0].messages[0].content,'bound fixture task');assert.equal(received[0].model,'fixture-model');
 const report={pass:true,scope:'Actual local HTTP fixture counter; fabricated WS Verified headers and mocked chain adapter reads. No real testnet or model call.',httpCallsTotal:counter,results,sourceHashes:Object.fromEntries(['runtime/worker.mjs','runtime/chain.mjs','runtime/binding.mjs','runtime/quote.mjs'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))};
 fs.writeFileSync('evidence/independent-worker-regression.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
