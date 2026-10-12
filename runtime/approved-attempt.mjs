import {canonicalProviderBody,providerInputHash,providerModelHash,deepFreeze} from './binding.mjs';
import {verifyQuote} from './quote.mjs';
import {recordSingleAttempt} from './config.mjs';
function exactKeys(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error(`approved ${label} fields mismatch`);}
export function validateApprovedBody(input){
 exactKeys(input,['model','max_tokens','stream','thinking','saferouter','messages'],'body');
 if(input.model!=='deepseek-v4-flash'||input.max_tokens!==160||input.stream!==false)throw Error('approved model/output/stream bound mismatch');
 exactKeys(input.thinking,['type'],'thinking');if(input.thinking.type!=='disabled')throw Error('approved thinking must be disabled');
 exactKeys(input.saferouter,['provider','fallback'],'routing');if(input.saferouter.provider!=='deepseek'||input.saferouter.fallback!==false)throw Error('approved provider/fallback bound mismatch');
 if(!Array.isArray(input.messages)||input.messages.length!==1)throw Error('approved request needs exactly one user message');
 const message=input.messages[0];exactKeys(message,['role','content'],'message');
 if(message.role!=='user'||typeof message.content!=='string'||message.content.length===0||!/^[\x00-\x7f]+$/.test(message.content)||Buffer.byteLength(message.content,'utf8')>200)throw Error('approved user content must be nonempty ASCII, at most 200 bytes');
 return canonicalProviderBody(input);
}
export function boundedProvider(send,{guard,onTerminal=()=>{}}){
 if(typeof guard!=='string'||!guard.length)throw Error('approved permanent guard required');
 return async(inputJob,options)=>{
  const job=deepFreeze(structuredClone(inputJob));
  const emit=record=>{try{onTerminal(record);}catch{/* notification cannot change provider outcome; root finally revokes independently */}};
  let attempted=false;
  try{
   const body=validateApprovedBody(job.providerInput);
   if(body!==job.providerBody)throw Error('approved exact canonical HTTP body mismatch');
   if(job.chainId!==10143||!/^0x[0-9a-f]{40}$/i.test(job.contractAddress)||job.receipt?.to?.toLowerCase()!==job.contractAddress.toLowerCase()||job.quote?.grantId?.toLowerCase()!==job.grantId?.toLowerCase())throw Error('approved job chain/contract/grant receipt binding mismatch');
   if(job.quote.taskInputHash.toLowerCase()!==providerInputHash(job.providerInput).toLowerCase()||job.quote.modelHash.toLowerCase()!==providerModelHash(job.providerInput).toLowerCase()||!await verifyQuote(job.contractAddress,job.quote,job.quoteSignature))throw Error('approved signed input/model/domain binding mismatch');
   recordSingleAttempt(guard,{at:new Date().toISOString(),grantId:job.grantId,contract:job.contractAddress,chainId:10143,inputHash:job.quote.taskInputHash,model:job.providerInput.model,exactHttpBody:body,maxOutputTokens:160,thinking:'disabled',fallback:false});
   attempted=true;
   const response=await send(job,options);
   emit({type:'approved-provider-terminal',outcome:'ProviderResponseReceived',attempted:true,grantId:job.grantId});
   return response;
  }catch(error){
   if(!attempted)error.definitiveFailure=true;
   emit({type:'approved-provider-terminal',outcome:error.definitiveFailure?'ProviderFailed':'ProviderUnknown',attempted,grantId:job.grantId,reason:error.message});
   throw error;
  }
 };
}
