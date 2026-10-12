import { keccak256, stringToHex } from 'viem';
function canonical(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 throw new Error('provider input must be canonical JSON, no undefined/bigint/nonfinite/prototype values');
}
export function canonicalProviderBody(input){
 if(!input||typeof input!=='object'||typeof input.model!=='string'||!input.model.length||!Array.isArray(input.messages)||!input.messages.length)throw new Error('provider input requires model and nonempty messages');
 return canonical(input);
}
export const providerInputHash=input=>keccak256(stringToHex(canonicalProviderBody(input)));
export const providerModelHash=input=>keccak256(stringToHex(input.model));
export function canonicalJobIdentity(chainId,contractAddress,grantId){
 if(chainId!==10143||!/^0x[0-9a-f]{40}$/i.test(contractAddress)||!/^0x[0-9a-f]{64}$/i.test(grantId))throw new Error('canonical identity requires chain10143/contract/grant bytes32');
 return `${chainId}-${contractAddress.toLowerCase()}-${grantId.toLowerCase()}`;
}
export function deepFreeze(x){if(x&&typeof x==='object'){Object.freeze(x);for(const v of Object.values(x))deepFreeze(v);}return x;}
// Uses precisely the bytes whose hash is in the signed quote. No alternate prompt/model argument.
export function jsonHttpProvider({url,headers={}}){
 return async(job,{signal}={})=>{
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:job.providerBody,signal});
  if(!response.ok){const error=new Error(`provider HTTP ${response.status}`);error.definitiveFailure=true;throw error;}
  return response.json();
 };
}
