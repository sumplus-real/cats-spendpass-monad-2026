import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAbi,encodeEventTopics,encodeAbiParameters} from 'viem';
import {acceptanceReader} from './chain.mjs';
const abi=parseAbi(['event Accepted(bytes32 indexed grantId, address indexed payee, uint256 fee)']);
const address='0x'+'11'.repeat(20),payee='0x'+'22'.repeat(20),grantId='0x'+'aa'.repeat(32),hash='0x'+'bb'.repeat(32),tx='0x'+'cc'.repeat(32);
const header={number:'42',hash};
const job={grantId,quote:{payee},fee:2n,receipt:{transactionHash:tx}};
function client(changes={}){return {getChainId:async()=>10143,getBlock:async()=>({hash}),getTransactionReceipt:async()=>({status:'success',to:address,blockNumber:42n,blockHash:hash,logs:[{address,topics:encodeEventTopics({abi,eventName:'Accepted',args:{grantId,payee}}),data:encodeAbiParameters([{type:'uint256'}],[2n])}]}),readContract:async x=>x.functionName==='offers'?[2,'operator',payee,2n,100n,'quotehash']:x.functionName==='policyHash'?'policyhash':['root',10n,8n,0n,2n,0n,0n,0n,1],...changes};}
test('read adapter verifies fresh tx receipt event and pinned Accepted entitlement',async()=>{const a=await acceptanceReader(client(),address,abi)(job,header);assert.equal(a.offerState,'Accepted');assert.equal(a.providerUnclaimed,2n);assert.equal(a.grantId,grantId);});
test('wrong chain rejected',async()=>{await assert.rejects(acceptanceReader(client({getChainId:async()=>1}),address,abi)(job,header),/wrong chain/);});
test('unrelated receipt event cannot authorize dispatch',async()=>{await assert.rejects(acceptanceReader(client({getTransactionReceipt:async()=>({status:'success',to:address,blockNumber:42n,blockHash:hash,logs:[]})}),address,abi)(job,header),/matching contract Accepted event/);});
test('receipt wrong hash rejected',async()=>{await assert.rejects(acceptanceReader(client({getTransactionReceipt:async()=>({status:'success',to:address,blockNumber:42n,blockHash:'wrong',logs:[]})}),address,abi)(job,header),/receipt mismatch/);});
test('canonical block changes during reads rejected',async()=>{let n=0;await assert.rejects(acceptanceReader(client({getBlock:async()=>({hash:++n===1?hash:'wrong'})}),address,abi)(job,header),/changed during/);});
test('fresh receipt.to wrong contract rejected',async()=>{const c=client();const original=c.getTransactionReceipt;c.getTransactionReceipt=async()=>({...await original(),to:payee});await assert.rejects(acceptanceReader(c,address,abi)(job,header),/receipt.to/);});
test('Accepted event wrong fee rejected',async()=>{const c=client();const original=c.getTransactionReceipt;c.getTransactionReceipt=async()=>{const r=await original();r.logs[0].data=encodeAbiParameters([{type:'uint256'}],[3n]);return r;};await assert.rejects(acceptanceReader(c,address,abi)(job,header),/matching contract Accepted event/);});
test('Accepted event wrong payee rejected',async()=>{const c=client();const original=c.getTransactionReceipt;c.getTransactionReceipt=async()=>{const r=await original();r.logs[0].topics=encodeEventTopics({abi,eventName:'Accepted',args:{grantId,payee:address}});return r;};await assert.rejects(acceptanceReader(c,address,abi)(job,header),/matching contract Accepted event/);});
