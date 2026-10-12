import {readFile,writeFile} from 'node:fs/promises';
const text=await readFile(new URL('./app.js',import.meta.url),'utf8');
const body=text.match(/async function chargedGas\(receipt,hash\)\{[^\n]+\}/)?.[0];if(!body)throw Error('Charged fee implementation not found');
const receipt={status:0,gasUsed:21000n,gasPrice:30000000000n};
const run=(cfg,rpc)=>new Function('cfg','rpc',body+';return chargedGas;')(cfg,rpc);
const actual=await run({environment:'monad-testnet'},{getTransaction:async()=>({gasLimit:100000n})})(receipt,'0xknownRevert');
const local=await run({environment:'local-simulation'},{getTransaction:async()=>{throw Error('Local must not infer Monad fee');}})(receipt,'0xlocal');
let failClosed=false;try{await run({environment:'monad-testnet'},{getTransaction:async()=>null})(receipt,'0xunknown')}catch{failClosed=true;}
if(actual.wei!==3000000000000000n||actual.wei<=receipt.gasUsed*receipt.gasPrice||local.wei!==630000000000000n||!failClosed)throw Error('Fee guard regression');
const result={time:new Date().toISOString(),pass:true,knownBadCase:'Reverted receipt gasUsed=21000 < submitted gasLimit=100000; actual UI charges full gasLimit',chargedWei:actual.wei.toString(),wrongGasUsedWei:(receipt.gasUsed*receipt.gasPrice).toString(),localAnvilGasUsedBasis:local.wei.toString(),missingTransactionFailsClosed:failClosed,scope:'Function actually extracted from current app.js; wire receipt inputs still require root actual browser verification'};await writeFile(new URL('./ui-fee-verification.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
