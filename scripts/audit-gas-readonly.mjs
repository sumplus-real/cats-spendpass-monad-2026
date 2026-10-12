// Reads existing hashes only; no wallet/signing/broadcast/provider API exists here.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createPublicClient,http,formatEther} from 'viem';
const inputs=process.argv.slice(2).length?process.argv.slice(2):['evidence/testnet-live.json','evidence/testnet-live-cold-recovery.json'];
const rpc=process.env.SPENDPASS_RPC_URL||'https://testnet-rpc.monad.xyz';
const client=createPublicClient({transport:http(rpc,{retryCount:0,timeout:15000})});
assert.equal(await client.getChainId(),10143);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources=inputs.map(filename=>{const bytes=fs.readFileSync(filename);return {filename,sha256:sha(bytes),journal:JSON.parse(bytes)};});
const entries=sources.flatMap(s=>[...(s.journal.deploy?.hash?[{...s.journal.deploy,fn:'deploy'}]:[]),...(s.journal.transactions||[])].filter(x=>x.hash).map(x=>({...x,input:s.filename})));
assert.ok(entries.length>0,'no known transaction hashes');
const rows=[];
for(const entry of entries){
 const [transaction,receipt]=await Promise.all([client.getTransaction({hash:entry.hash}),client.getTransactionReceipt({hash:entry.hash})]);
 assert.equal(receipt.status,'success');assert.equal(transaction.hash.toLowerCase(),receipt.transactionHash.toLowerCase());assert.equal(transaction.blockHash.toLowerCase(),receipt.blockHash.toLowerCase());
 const charged=transaction.gas*receipt.effectiveGasPrice;
 rows.push({input:entry.input,fn:entry.fn,role:entry.role??'owner',hash:entry.hash,from:transaction.from,to:transaction.to,valueWei:transaction.value.toString(),blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash,gasLimit:transaction.gas.toString(),gasUsed:receipt.gasUsed.toString(),effectiveGasPriceWei:receipt.effectiveGasPrice.toString(),gasChargedWei:charged.toString(),gasChargedMON:formatEther(charged),originalRecordedGasWei:entry.gasWei??entry.gasChargedWei??null,correctionWei:entry.gasWei!==undefined?(charged-BigInt(entry.gasWei)).toString():null});
}
for(const source of sources)assert.equal(sha(fs.readFileSync(source.filename)),source.sha256,'original journal changed; stop');
const total=rows.reduce((sum,r)=>sum+BigInt(r.gasChargedWei),0n);
const report={status:'PASS_READ_ONLY_EXISTING_HASH_AUDIT',checkedAt:new Date().toISOString(),rpc,chainId:10143,transactionsQueried:rows.length,transactionsSent:0,providerCalls:0,feeRule:'transaction.gasLimit * receipt.effectiveGasPrice',officialSource:'https://docs.monad.xyz/developer-essentials/gas-pricing',method:'fresh eth_getTransactionByHash + eth_getTransactionReceipt for each existing hash; no rerun or rewriting execution evidence',sources:sources.map(({filename,sha256})=>({filename,sha256})),rows,totalGasChargedWei:total.toString(),totalGasChargedMON:formatEther(total),oldEvidencePreserved:true,scope:'Network fee according to official charged-limit rule and fresh wire values; historical wallet-balance delta is not newly rechecked.'};
const output='evidence/testnet-gas-readonly-audit.json';
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,count:rows.length,totalGasChargedMON:report.totalGasChargedMON,output}));
