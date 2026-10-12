import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {privateKeyToAccount} from 'viem/accounts';
import {signQuote,verifyQuote,quoteDigest} from './quote.mjs';
import {providerInputHash,providerModelHash,canonicalJobIdentity} from './binding.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
function awaitMessage(child,predicate){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('IPC timeout')),5000);const on=x=>{if(predicate(x)){clearTimeout(timer);child.off('message',on);resolve(x);}};child.on('message',on);});}
test('two independent worker processes and DB directories complete fixture jobs',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spendpass-process-'));const children=[];
 try{
  const configs=[];
  const account=privateKeyToAccount('0x'+'00'.repeat(31)+'01'),contractAddress='0x'+'33'.repeat(20),grantId='0x'+'aa'.repeat(32),policyHash='0x'+'dd'.repeat(32);
  const providerInput={model:'fixture',messages:[{role:'user',content:'same fixture task'}]};
  const quote={grantId,operator:account.address,payee:'0x2222222222222222222222222222222222222222',taskInputHash:providerInputHash(providerInput),modelHash:providerModelHash(providerInput),fee:'2',expiry:'9999999999',nonce:'1',policyHash};
  const quoteSignature=await signQuote(account,contractAddress,quote),quoteHash=quoteDigest(contractAddress,quote),identity=canonicalJobIdentity(10143,contractAddress,grantId);

  for(const who of ['A','B']){
   const db=path.join(dir,who);const adapter=path.join(dir,who+'.mjs');
   fs.writeFileSync(adapter,`export async function createAdapters(){return {directory:${JSON.stringify(db)},contractAddress:'${contractAddress}',operator:'${account.address}',payee:'0x2222222222222222222222222222222222222222',readAcceptance:async()=>({grantId:'${grantId}',quoteHash:'${quoteHash}',policyHash:'${policyHash}',offerState:'Accepted',operator:'${account.address}',payee:'0x2222222222222222222222222222222222222222',fee:2,providerUnclaimed:2}),provider:async()=>({usage:{fixtureTokens:1},output:'${who} fixture',fixture:true})}}`);
   const c=fork(path.join(root,'process.mjs'),[pathToFileURL(adapter).href],{stdio:['ignore','ignore','inherit','ipc']});children.push(c);const ready=await awaitMessage(c,x=>x.type==='ready');configs.push(ready);
   const result=awaitMessage(c,x=>x.id==='same-id');
   const at=Date.now();c.send({type:'accepted',job:{id:'same-id',grantId,quote,quoteSignature,providerInput,fee:'2',acceptSentAt:at,expectedBlockId:'id',receipt:{status:'success',to:contractAddress,blockHash:'hash',blockNumber:'42'}}});
   c.send({type:'header',header:{blockId:'id',hash:'hash',number:'42',commitState:'Verified'},receivedAt:Date.now()});
   assert.equal((await result).result.state,'Completed');
  }
  assert.notEqual(configs[0].pid,configs[1].pid);assert.notEqual(configs[0].directory,configs[1].directory);
  const a=JSON.parse(fs.readFileSync(path.join(dir,'A',identity+'.json'))),b=JSON.parse(fs.readFileSync(path.join(dir,'B',identity+'.json')));
  assert.equal(a.result.output,'A fixture');assert.equal(b.result.output,'B fixture');
 }finally{for(const c of children)c.kill();}
});
test('exact fixed native-MON EIP712 quote signing rejects changed payload and domain',async()=>{
 // Deliberately public fixture scalar; never funded or used in testnet scenario.
 const account=privateKeyToAccount('0x'+'00'.repeat(31)+'01');const address='0x'+'33'.repeat(20);const quote={grantId:'0x'+'aa'.repeat(32),operator:account.address,payee:'0x'+'22'.repeat(20),taskInputHash:'0x'+'bb'.repeat(32),modelHash:'0x'+'cc'.repeat(32),fee:2n,expiry:9999999999n,nonce:1n,policyHash:'0x'+'dd'.repeat(32)};
 const signature=await signQuote(account,address,quote);assert.equal(await verifyQuote(address,quote,signature),true);assert.equal(await verifyQuote(address,{...quote,fee:3n},signature),false);assert.equal(await verifyQuote('0x'+'44'.repeat(20),quote,signature),false);assert.match(quoteDigest(address,quote),/^0x[0-9a-f]{64}$/);
});
