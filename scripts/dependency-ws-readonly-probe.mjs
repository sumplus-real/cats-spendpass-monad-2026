// Read-only dependency regression: no signer, transaction, credential, or model API.
import fs from 'node:fs';import {createHash} from 'node:crypto';import {createPublicClient,http,keccak256} from 'viem';import {VerifiedGate} from '../runtime/worker.mjs';import {connectVerified} from '../runtime/ws.mjs';
const start=Date.now(),gate=new VerifiedGate(),url='wss://testnet-rpc.monad.xyz',wire=connectVerified(gate,url);let timeout;
try{
 await Promise.race([wire.ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('WS subscription timeout')),12000);})]);clearTimeout(timeout);
 await Promise.race([new Promise(resolve=>{if(gate.raw.some(h=>h.commitState==='Verified'))resolve();else gate.on('header',h=>{if(h.commitState==='Verified')resolve();});}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('no actual Verified header')),12000);})]);clearTimeout(timeout);
 const publicEvidence=JSON.parse(fs.readFileSync('evidence/approved-real-public-evidence.json')),client=createPublicClient({transport:http('https://testnet-rpc.monad.xyz',{retryCount:0})}),abi=JSON.parse(fs.readFileSync('contracts/SpendPass.abi.json'));
 if(await client.getChainId()!==10143)throw Error('wrong chain');
 const address=publicEvidence.contract,rootId=publicEvidence.rootId;
 const [code,grant,offer,ledger]=await Promise.all([client.getCode({address}),client.readContract({address,abi,functionName:'grants',args:[rootId]}),client.readContract({address,abi,functionName:'offers',args:[rootId]}),client.readContract({address,abi,functionName:'ledgerValid',args:[rootId]})]);
 if(!code||code==='0x'||Number(offer[0])!==2||grant[5]!==2000000000000000n||ledger!==true)throw Error('existing accepted/claimed contract state mismatch');
 const artifact=JSON.parse(fs.readFileSync('contracts/out/SpendPass.sol/SpendPass.json'));
 const expectedCodeHash=keccak256(artifact.deployedBytecode.object),actualCodeHash=keccak256(code);
 if(actualCodeHash!==expectedCodeHash)throw Error('existing deployed code differs from present compiled artifact');
 const ws=JSON.parse(fs.readFileSync('node_modules/ws/package.json')),lock=fs.readFileSync('package-lock.json');
 const verified=gate.raw.filter(h=>h.commitState==='Verified');
 const report={status:'PASS_REPAIRED_DEPENDENCY_READ_ONLY_WS_AND_CONTRACT',checkedAt:new Date().toISOString(),durationMs:Date.now()-start,wsVersion:ws.version,packageLockSha256:createHash('sha256').update(lock).digest('hex'),rpc:'https://testnet-rpc.monad.xyz',ws:url,chainId:10143,verifiedHeaders:verified.length,actualVerifiedSamples:verified.slice(0,3).map(({blockId,hash,number,receivedAt})=>({blockId,hash,number,receivedAt})),rawHeaderCount:gate.raw.length,errors:wire.errors,contract:address,rootId,actualCodeHash,expectedCodeHash,compiledArtifactMatched:true,offerAccepted:true,providerClaimedWei:grant[5].toString(),ledgerValid:ledger,transactionsSent:0,modelHTTPAttempts:0,scope:'Current repaired ws8.21.0 supports actual WS Verified and reads existing accepted/claimed ledger; historical real model/transactions ran old ws8.18.3. No replay or new paid/model/chain write.'};
 fs.writeFileSync('evidence/repaired-ws-readonly-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,wsVersion:ws.version,verifiedHeaders:verified.length,compiledArtifactMatched:true}));
}finally{clearTimeout(timeout);wire.close();}
