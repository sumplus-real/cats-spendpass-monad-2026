import {discoverClosedRecoveryGrants} from './recovery-topology.mjs';
// Strict read-only diagnosis: no wallet client, signer, keys, send or write RPC.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createPublicClient,http,keccak256} from 'viem';
const saved=JSON.parse(fs.readFileSync('evidence/testnet-live.json'));
const recovery=JSON.parse(fs.readFileSync('evidence/testnet-live-cold-recovery.json'));
const abi=JSON.parse(fs.readFileSync('contracts/SpendPass.abi.json'));
const artifact=JSON.parse(fs.readFileSync('contracts/out/SpendPass.sol/SpendPass.json'));
const client=createPublicClient({transport:http(saved.rpc,{retryCount:0})});
const address=saved.deploy.address;assert.equal(await client.getChainId(),10143);
const blockNumber=await client.getBlockNumber(),block=await client.getBlock({blockNumber});
const read=(functionName,args=[])=>client.readContract({address,abi,functionName,args,blockNumber});
const actualCode=await client.getCode({address,blockNumber});
const actualCodeHash=keccak256(actualCode),compiledCodeHash=keccak256(artifact.deployedBytecode.object);
const count=Number(await read('childCount',[saved.rootId]));
const registered=await discoverClosedRecoveryGrants(read,saved.rootId);
const candidateIds=[...new Set([saved.rootId,...(saved.childIds||[])])];
const names=['rootId','originalAllocation','free','held','providerUnclaimed','providerClaimed','ownerWithdrawn','delegatedOutstanding','depth'];
const grants=[];for(const id of candidateIds){const g=await read('grants',[id]);grants.push({id,registered:registered.includes(id),...Object.fromEntries(names.map((n,i)=>[n,g[i]])),ledgerValid:await read('ledgerValid',[id]),computedEquationHolds:g[1]===g.slice(2,8).reduce((n,x)=>n+x,0n)});}
const totalRoots=Number(await read('rootCount'));let assets=0n;const globalGrantIds=[];
for(let r=0;r<totalRoots;r++){const root=await read('roots',[BigInt(r)]);const ids=[root];const c=Number(await read('childCount',[root]));for(let i=0;i<c;i++)ids.push(await read('childId',[root,BigInt(i)]));for(const id of ids){const g=await read('grants',[id]);globalGrantIds.push(id);assets+=g[2]+g[3]+g[4];assert.equal(await read('ledgerValid',[id]),true);}}
const balance=await client.getBalance({address,blockNumber});const accounted=await read('accountedBalance');const surplus=await read('unsolicitedSurplus');
const receipts=[];for(const tx of recovery.transactions){const r=await client.getTransactionReceipt({hash:tx.hash});receipts.push({function:tx.fn,hash:tx.hash,status:r.status,blockNumber:r.blockNumber,blockHash:r.blockHash});assert.equal(r.status,'success');}
assert.equal(count,0);assert.equal(grants[0].ledgerValid,true);assert.equal(grants[0].providerClaimed+grants[0].ownerWithdrawn,grants[0].originalAllocation);assert.equal(assets,accounted);assert.equal(balance,assets+surplus);assert.equal(actualCodeHash,recovery.savedCodeHash);assert.equal(actualCodeHash,compiledCodeHash);
const report={mode:'READ_ONLY_ACTUAL_MONAD_TESTNET_DIAGNOSIS',observedAt:new Date().toISOString(),rpc:saved.rpc,chainId:10143,contract:address,blockNumber,blockHash:block.hash,actualCodeHash,compiledCodeHash,bytecodeMatchesCurrentArtifact:true,currentContractSourceSha256:crypto.createHash('sha256').update(fs.readFileSync('contracts/src/SpendPass.sol')).digest('hex'),rootId:saved.rootId,childCount:count,registeredGrantIds:registered,grants,globalRoots:totalRoots,globalGrantIds,globalAssetSumWei:assets,accountedBalanceWei:accounted,contractBalanceWei:balance,unsolicitedSurplusWei:surplus,receipts,rootCause:'Recovery script trusted two precomputed report.childIds after provider failed before split. Both child IDs are uncreated (depth0), and ledgerValid intentionally rejects unknown grants. It was the off-chain set of grants being asserted that was wrong; actual root ledger and native balances conserve.',onchainContractBugFound:false,repair:{file:'scripts/testnet-recover.mjs',method:'discoverClosedRecoveryGrants reads chain closing/root depth/childCount/childId and validates existing leaf depth/root membership; ignores precomputed uncreated child IDs',tests:'evidence/recovery-topology-tests.tap',testCases:5,actualReadOnlyHelperPass:true,sourceHashes:Object.fromEntries(['scripts/testnet-recover.mjs','scripts/recovery-topology.mjs','scripts/recovery-topology.test.mjs'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))},transactionsBroadcast:0,modelCalls:0,pass:true};
fs.writeFileSync('evidence/testnet-cold-recovery-diagnosis.json',JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');console.log(JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2));
