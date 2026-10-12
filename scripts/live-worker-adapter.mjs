import fs from 'node:fs';
import {createPublicClient,http} from 'viem';
import {acceptanceReader} from '../runtime/chain.mjs';
import {jsonHttpProvider} from '../runtime/binding.mjs';
import {requiredEnv,quotaKey,recordSingleAttempt} from '../runtime/config.mjs';
export async function createAdapters(){
 const role=requiredEnv('SPENDPASS_WORKER_ROLE');
 if(!['operatorA','operatorB'].includes(role))throw Error('worker role must be operatorA or operatorB');
 const cfg=JSON.parse(fs.readFileSync(requiredEnv('SPENDPASS_CONTEXT_FILE')));
 if(cfg.chainId!==10143)throw Error('saved deployment must specify chain10143');
 const abi=JSON.parse(fs.readFileSync('contracts/SpendPass.abi.json'));
 const chain={id:10143,name:'Monad Testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:[cfg.rpc]}}};
 const client=createPublicClient({chain,transport:http(cfg.rpc,{retryCount:0,timeout:15000})});
 let provider;
 if(role==='operatorA'&&process.env.SPENDPASS_FIXTURE_A==='1'){
  // Local deterministic response, NOT a real model call. No key or attempt guard is read.
  provider=async()=>({fixture:true,model:'FIXTURE_NO_REAL_A_MODEL_CALL',choices:[{message:{content:JSON.stringify({tasks:['Explain bounded task acceptance fees','Explain recovery of unaccepted funds']})}}],usage:{total_tokens:0}});
 }else if(role==='operatorA'){
  const guard=requiredEnv('SPENDPASS_ATTEMPT_GUARD');
  if(fs.existsSync(guard))throw Error('Permanent real-provider attempt guard exists; inspect Failed/Unknown state, never retry or replace guard');
  const key=quotaKey();const url=requiredEnv('SPENDPASS_PROVIDER_URL');
  if(!url.startsWith('https://'))throw Error('real provider URL must use HTTPS');
  const send=jsonHttpProvider({url,headers:{Authorization:'Bearer '+key}});
  provider=async(job,options)=>{recordSingleAttempt(guard,{at:new Date().toISOString(),grantId:job.grantId,contract:cfg.contract,inputHash:job.quote.taskInputHash});return send(job,options);};
 }else{
  provider=async()=>({fixture:true,model:'FIXTURE_NO_REAL_B_MODEL_CALL',content:'Local simulated B task. Not third-party service proof.',usage:{total_tokens:0}});
 }
 return {directory:requiredEnv('SPENDPASS_RUNTIME_DIRECTORY'),contractAddress:cfg.contract,operator:cfg[role],payee:cfg[role],readAcceptance:acceptanceReader(client,cfg.contract,abi),provider,providerTimeoutMs:60000};
}
