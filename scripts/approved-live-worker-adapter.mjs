import fs from 'node:fs';
import {createPublicClient,http} from 'viem';
import {acceptanceReader} from '../runtime/chain.mjs';
import {jsonHttpProvider} from '../runtime/binding.mjs';
import {requiredEnv,quotaKey} from '../runtime/config.mjs';
import {boundedProvider} from '../runtime/approved-attempt.mjs';
export async function createAdapters(){
 if(requiredEnv('SPENDPASS_WORKER_ROLE')!=='operatorA')throw Error('restricted approval only allows the new operator A task');
 const cfg=JSON.parse(fs.readFileSync(requiredEnv('SPENDPASS_CONTEXT_FILE')));if(cfg.chainId!==10143)throw Error('approved context must be Monad testnet chain10143');
 const guard=requiredEnv('SPENDPASS_APPROVED_ATTEMPT_GUARD');if(fs.existsSync(guard))throw Error('approved permanent attempt guard already exists; no new HTTP/retry');
 // Only restricted approved key file is read. No owner or legacy quota file is accessed.
 const key=quotaKey({fileVariable:'SPENDPASS_APPROVED_QUOTA_ENV_FILE',keyName:'SPENDPASS_API_KEY'});
 const url=requiredEnv('SPENDPASS_PROVIDER_URL');if(!url.startsWith('https://'))throw Error('approved provider URL must use HTTPS');
 const abi=JSON.parse(fs.readFileSync('contracts/SpendPass.abi.json'));
 const chain={id:10143,name:'Monad Testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:[cfg.rpc]}}};const client=createPublicClient({chain,transport:http(cfg.rpc,{retryCount:0,timeout:15000})});
 const send=jsonHttpProvider({url,headers:{Authorization:'Bearer '+key}});
 const provider=boundedProvider(send,{guard,onTerminal:record=>{if(process.connected)process.send?.(record,()=>{});}});
 return {directory:requiredEnv('SPENDPASS_RUNTIME_DIRECTORY'),contractAddress:cfg.contract,operator:cfg.operatorA,payee:cfg.operatorA,readAcceptance:acceptanceReader(client,cfg.contract,abi),provider,providerTimeoutMs:60000};
}
