// Local review artifact only. No GitHub/upload/provider/wallet/chain APIs.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),output=path.resolve(process.env.SPENDPASS_SOURCE_CANDIDATE||'materials/source-candidate');
if(fs.existsSync(output))throw Error('candidate directory already exists; preserve user edits and choose a new explicit output');
const sha=b=>createHash('sha256').update(b).digest('hex');const chosen=[];
function add(relative){const source=path.join(root,relative);if(fs.statSync(source).isFile())chosen.push(relative);}
function tree(relative,accept=()=>true){for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){const child=path.join(relative,entry.name);if(entry.isDirectory())tree(child,accept);else if(accept(child))add(child);}}
for(const f of ['README.md','EXECUTION_PROVENANCE.md','LICENSE','sample.env','.gitignore','package.json','package-lock.json','foundry.toml'])add(f);
tree('contracts/src');tree('contracts/test');add('contracts/SpendPass.abi.json');add('contracts/API_AND_VALIDATION.txt');
tree('runtime',p=>p.endsWith('.mjs')||p.endsWith('runtime-evidence.json'));tree('scripts',p=>p.endsWith('.mjs'));tree('THIRD_PARTY_LICENSES');
for(const f of ['app.js','index.html','recovery.html','style.css','abi.json','verify-fee.mjs','verify-read.mjs'])add('web/'+f);tree('web/vendor');
for(const f of ['testnet-provider-failed-record.json','testnet-gas-readonly-audit.json','independent-worker-regression.json','current-node-tests.tap','current-foundry-tests.txt','approved-real-public-evidence.json','approved-real-server-count-readback.json','approved-execution-source-manifest.json','repaired-ws-readonly-probe.json','npm-audit-repaired.json','ws-primary-registry-version.json','executed-dependency-version.json','package-lock-executed-ws8.18.3.json'])add('evidence/'+f);
for(const f of ['foundry-tests.txt','knownbad-must-fail.txt','checkpoint.json'])add('contracts/evidence/'+f);
fs.mkdirSync(output,{recursive:true});const sources=[];
for(const relative of chosen.sort()){
 const source=path.join(root,relative),bytes=fs.readFileSync(source),dest=path.join(output,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);sources.push({path:relative,sha256:sha(bytes),bytes:bytes.length});
}
const example={environment:'monad-testnet',chainId:10143,rpc:'https://testnet-rpc.monad.xyz',contract:'REPLACE_WITH_EXPLICIT_DEPLOYMENT_ADDRESS',codeHash:'REPLACE_WITH_VERIFIED_RUNTIME_BYTECODE_HASH',owner:'REPLACE_WITH_WORKFLOW_OWNER',rootId:'REPLACE_WITH_CREATED_ROOT_ID',grants:[],readOnly:true,localFixture:false,testWalletBridge:false,workerEvidence:'worker-status.json'};
fs.writeFileSync(path.join(output,'web/deployment.example.json'),JSON.stringify(example,null,2)+'\n');
// Hash copied source then recheck original; no mixed snapshot is silently accepted.
for(const source of sources)if(sha(fs.readFileSync(path.join(root,source.path)))!==source.sha256)throw Error(`source changed during copy: ${source.path}; candidate incomplete, inspect`);
const manifest={preparedAt:new Date().toISOString(),state:'SOURCE_SNAPSHOT',sourceFileCount:sources.length,sources,generatedFiles:['web/deployment.example.json'],excluded:['.git','.runtime','node_modules','contracts/out','contracts/cache','wallets','quota/auth evidence','private env files','personal-path historical snapshots','video media','current user deployment configuration'],identity:'Jakob Xu / Sumplus; contact@sumplus.xyz',copyTimeIsNotOriginalDevelopmentTime:true};
fs.writeFileSync(path.join(output,'SOURCE_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({state:manifest.state,output:path.relative(root,output),sourceFileCount:sources.length}));
