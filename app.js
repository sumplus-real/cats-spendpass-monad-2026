import {Contract,JsonRpcProvider,Interface,keccak256,formatEther,getAddress} from './vendor/ethers-6.17.0.min.mjs';
const $=id=>document.getElementById(id), mode=document.body.dataset.mode;
let cfg, abi, rpc, contract, wallet, account, policy, nodes=[], closing=false, busy=false, deploymentVerified=false;
const MON=x=>Number(formatEther(x??0n)).toFixed(6), addr=x=>String(x??''), same=(a,b)=>a&&b&&a.toLowerCase()===b.toLowerCase();
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
const recordsKey=()=>`spendpass:tx:${cfg.chainId}:${cfg.contract}:${cfg.rootId}`;
let records=[];
const bridgeEnabled=()=>cfg.environment==='local-simulation'&&cfg.localFixture===true||cfg.environment==='monad-testnet'&&cfg.testWalletBridge===true&&['127.0.0.1','localhost'].includes(location.hostname);
const testBridge=()=>cfg.environment==='monad-testnet'&&cfg.testWalletBridge===true;
async function chargedGas(receipt,hash){const local=cfg.environment==='local-simulation';const tx=local?null:await rpc.getTransaction(hash);if(!local&&!tx)throw Error('Actual charged gas unknown: transaction gasLimit unavailable');const units=local?receipt.gasUsed:tx.gasLimit;const price=receipt.gasPrice??receipt.effectiveGasPrice;if(price==null)throw Error('Actual charged gas unknown: effectiveGasPrice unavailable');return {wei:units*price,units,price,gasUsed:receipt.gasUsed,basis:local?'Anvil receipt gasUsed':'Monad submitted transaction gasLimit (full limit charged, including reverted receipts)'};}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function status(s,bad=false){$('status').textContent=s;$('status').className=bad?'bad':'';}
async function readJSON(path){const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error(`${path}: HTTP ${r.status}`);return r.json();}
function putRecord(r){records.push({...r,time:new Date().toISOString()});localStorage.setItem(recordsKey(),json(records));$('transactions').textContent=json(records);}
async function verifyDeployment(){
 const network=await rpc.getNetwork();if(Number(network.chainId)!==Number(cfg.chainId))throw Error('RPC chain does not match frozen deployment');
 if(Number(cfg.chainId)!==10143 && !(Number(cfg.chainId)===31337&&cfg.localFixture===true))throw Error('Only Monad testnet 10143 or explicitly labeled local fixture is supported');
 const code=await rpc.getCode(cfg.contract);if(code==='0x')throw Error('No deployed contract bytecode');
 if(!cfg.codeHash||!same(keccak256(code),cfg.codeHash))throw Error('Bytecode hash differs from saved deployment');
 const p=await contract.policies(cfg.rootId);if(!same(p.owner,cfg.owner))throw Error('On-chain owner differs from frozen deployment');
 deploymentVerified=true;return p;
}
async function connect(){
 if(cfg.readOnly)throw Error("Public explorer is read-only. No signing or provider calls.");
 if(bridgeEnabled()){wallet={request:async({method,params})=>{const selected=document.getElementById('fixture-account')?.value;if(!selected)throw Error('Select an explicit controlled test signer');if(method==='eth_requestAccounts'||method==='eth_accounts')return [selected];if(method==='eth_chainId')return '0x'+Number(cfg.chainId).toString(16);if(method!=='eth_sendTransaction')throw Error('Unsupported controlled test wallet request');const response=await fetch(testBridge()?'/test-wallet':'/fixture-wallet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})});const data=await response.json();if(!response.ok||data.error)throw Error(data.error?.message||'Fixture signer failed');return data.result;}};}else{if(!window.ethereum)throw Error('An EIP-1193 wallet is required. This static page never reads private keys.');wallet=window.ethereum;}const accounts=await wallet.request({method:'eth_requestAccounts'});account=getAddress(accounts[0]);
 const chain=Number(BigInt(await wallet.request({method:'eth_chainId'})));if(chain!==Number(cfg.chainId))throw Error(`Wallet chain ${chain}; select ${cfg.chainId} before sending.`);
 $('connect').textContent=`${account.slice(0,6)}…${account.slice(-4)}`;await refresh();
 if(wallet.on){wallet.on('accountsChanged',()=>{account=null;status('Wallet account changed. Reconnect before writing.',true);disableActions();});wallet.on('chainChanged',()=>{account=null;status('Wallet chain changed. Reconnect before writing.',true);disableActions();});}
}
function disableActions(){document.querySelectorAll('[data-action],#close').forEach(x=>x.disabled=true);}
async function send(name,grantId,role){
 if(cfg.readOnly)throw Error("Public explorer is read-only. No transaction can be sent.");
 if(busy)throw Error('Another transaction is pending. Refresh or inspect its retained hash; never auto-retry.');
 busy=true;disableActions();let hash,receiptKnown=false,knownGas=null;
 try{
  policy=await verifyDeployment();
  const accounts=await wallet.request({method:'eth_accounts'});if(!same(accounts[0],account))throw Error('Wallet account changed');
  if(Number(BigInt(await wallet.request({method:'eth_chainId'})))!==Number(cfg.chainId))throw Error('Wrong wallet chain');
  const fixed=role==='owner'?policy.owner:(nodes.find(x=>same(x.id,grantId))?.offer.payee);
  if(!same(account,fixed))throw Error(`Action requires fixed ${role} ${fixed}`);
  const iface=new Interface(abi),data=iface.encodeFunctionData(name,[grantId]);
  // No recipient override is supplied. Contract sends funds to its stored owner/payee.
  hash=await wallet.request({method:'eth_sendTransaction',params:[{from:account,to:cfg.contract,data,value:'0x0'}]});
  putRecord({action:name,grantId,hash,state:'Submitted',sender:account});status(`Submitted ${name}: ${hash}. Waiting for receipt. No automatic rebroadcast.`);
  const receipt=await rpc.waitForTransaction(hash,1,60000);
  if(!receipt)throw Error('Receipt unknown');
  receiptKnown=true;knownGas=await chargedGas(receipt,hash);putRecord({action:name,grantId,hash,state:receipt.status===1?'ReceiptSuccess':'ReceiptReverted',blockNumber:receipt.blockNumber,gasWei:knownGas.wei.toString(),chargedGasUnits:knownGas.units.toString(),gasUsed:knownGas.gasUsed.toString(),effectiveGasPrice:knownGas.price.toString(),gasBasis:knownGas.basis});
  if(receipt.status!==1)throw Error('Transaction reverted');
  status(`${name} receipt confirmed. Gas ${formatEther(knownGas.wei)} test MON, separate from workflow. This receipt is not a model dispatch gate.`);
 }catch(e){if(hash&&!receiptKnown)putRecord({action:name,grantId,hash,state:'UnknownOrFailed',reason:e.message});status(`${e.message}${knownGas?' Gas charged '+formatEther(knownGas.wei)+' test MON ('+knownGas.basis+').':''}${hash?' Retained transaction hash; no automatic retry.':''}`,true);}
 finally{busy=false;await refresh().catch(e=>status(e.message,true));}
}
function normalizeGrant(g){return Object.fromEntries(['rootId','originalAllocation','free','held','providerUnclaimed','providerClaimed','ownerWithdrawn','delegatedOutstanding','depth'].map(k=>[k,g[k]]));}
function normalizeOffer(o){return Object.fromEntries(['state','operator','payee','fee','expiry','quoteHash'].map(k=>[k,o[k]]));}
async function refresh(){
 await verifyDeployment();const block=await rpc.getBlock('latest'),at={blockTag:block.number};policy=await contract.policies(cfg.rootId,at);closing=await contract.closing(cfg.rootId,at);const ids=[cfg.rootId,await contract.childId(cfg.rootId,0),await contract.childId(cfg.rootId,1)];
 nodes=await Promise.all(ids.map(async(id,i)=>({id,label:i===0?'Root · operator A':`Child ${i} · operator B`,grant:normalizeGrant(await contract.grants(id,at)),offer:normalizeOffer(await contract.offers(id,at))})));
 const active=nodes.filter(n=>n.grant.originalAllocation>0n), sum=k=>active.reduce((a,n)=>a+n.grant[k],0n);
 const budget=policy.totalBudget, provider=sum('providerUnclaimed')+sum('providerClaimed'), owner=sum('ownerWithdrawn');
 $('metrics').innerHTML=[['Budget cap',budget,'Exact deposited test MON'],['Accepted entitlement',provider,'Unclaimed + already claimed'],['Free + Offered',sum('free')+sum('held'),'Unaccepted balance'],['Owner withdrawn',owner,'Wallet gas excluded']].map(([t,v,n])=>`<div class="metric"><span>${t}</span><strong>${MON(v)}</strong><small>${n}</small></div>`).join('');
 const expired=BigInt(block.timestamp)>=policy.expiry, isOwner=same(account,policy.owner);
 $('tree').innerHTML=nodes.map((n,i)=>{const g=n.grant,o=n.offer,s=Number(o.state),exists=g.originalAllocation>0n,labels=['NONE','Offered','Accepted · fee irreversible','Cancelled','Expired'];
 return `<article class="node ${i===0?'root':''}"><h3>${n.label}<span class="state">${exists?labels[s]:'Not allocated'}</span></h3><p class="address">${n.id}</p><dl>${[['Allocation',g.originalAllocation],['Free',g.free],['Held / Offered',g.held],['Accepted, unclaimed',g.providerUnclaimed],['Provider claimed',g.providerClaimed],['Owner withdrawn',g.ownerWithdrawn],['Delegated history',g.delegatedOutstanding]].map(([l,v])=>`<dt>${l}</dt><dd>${MON(v)} MON</dd>`).join('')}</dl><p class="address">Fixed payee: ${esc(o.payee)}</p>${s===2?'<p class="semantics">Acceptance fee paid. No proof of work or quality. Non-refundable even if undispatched or failed.</p>':''}${mode==='recovery'?`<div class="actions"><button data-action="release" data-id="${n.id}" ${!(account&&exists&&s===1&&(closing||expired))?'disabled':''}>Release Offered</button><button data-action="withdraw" data-id="${n.id}" ${!(isOwner&&exists&&(closing||expired)&&g.free>0n)?'disabled':''}>Withdraw free</button><button class="secondary" data-action="claim" data-id="${n.id}" ${!(same(account,o.payee)&&g.providerUnclaimed>0n)?'disabled':''}>Payee claim</button></div>`:''}</article>`;}).join('');
 document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>send(b.dataset.action,b.dataset.id,b.dataset.action==='claim'?'payee':'owner'));
 if($('close')){$('close').disabled=!isOwner||closing||busy;$('wallet-info').textContent=`Root ${closing?'Closing':expired?'Expired':'Active'}. Owner ${policy.owner}. Connected ${account||'none'}. Wallet gas is not subtracted from the budget.`;}
 const equations=active.map(n=>{const g=n.grant,rhs=g.free+g.held+g.providerUnclaimed+g.providerClaimed+g.ownerWithdrawn+g.delegatedOutstanding;return {node:n.label,originalAllocation:g.originalAllocation.toString(),ledgerTotal:rhs.toString(),pass:g.originalAllocation===rhs};});
 const assets=sum('free')+sum('held')+sum('providerUnclaimed'),native=await rpc.getBalance(cfg.contract,block.number);
 const rootCount=Number(await contract.rootCount(at));if(!Number.isSafeInteger(rootCount)||rootCount>10000)throw Error('Root inventory too large for this observer; no partial invariant claim.');
 const allRoots=await Promise.all(Array.from({length:rootCount},(_,i)=>contract.roots(i,at)));
 let totalAssets=0n;for(const rid of allRoots){for(const gid of [rid,await contract.childId(rid,0),await contract.childId(rid,1)]){const g=await contract.grants(gid,at);totalAssets+=g.free+g.held+g.providerUnclaimed;}}
 const accounting={observedBlock:block.number,perGrant:equations,workflowAssetsWei:assets.toString(),contractNativeWei:native.toString(),registeredRootsChecked:allRoots.length,totalCheckedAssetsWei:totalAssets.toString(),unsolicitedSurplusWei:(native-totalAssets).toString(),balanceCoversRegisteredAssets:native>=totalAssets,registeredFundingWei:(await contract.registeredFunding(at)).toString(),paidOutWei:(await contract.paidOut(at)).toString(),globalAccountedBalanceWei:(await contract.accountedBalance(at)).toString(),globalMatchesTree:totalAssets===await contract.accountedBalance(at),budgetConservation:budget===sum('free')+sum('held')+sum('providerUnclaimed')+sum('providerClaimed')+sum('ownerWithdrawn')};
 $('accounting').textContent=json(accounting);$('accounting').className=equations.every(x=>x.pass)&&accounting.budgetConservation&&accounting.globalMatchesTree&&native>=totalAssets?'good':'bad';
 $('policy').textContent=json({chainId:cfg.chainId,contract:cfg.contract,codeHash:cfg.codeHash,owner:cfg.owner,rootId:cfg.rootId,closing,expiry:policy.expiry.toString(),policy:Object.fromEntries(['owner','delegate','rootOperator','rootPayee','childOperator','childPayee','totalBudget','rootFeeMax','perChildMax','childrenTotalMax','expiry'].map(k=>[k,policy[k]]))});
 $('transactions').textContent=json(records);
 if(mode==='dashboard')await showRuntime();
}
async function showRuntime(){
 // This optional persisted evidence is never fetched by recovery; no gateway is required for funds.
 const path=cfg.runtimeEvidence||cfg.workerEvidence||'runtime-evidence.json';let data;try{data=await readJSON(path);}catch{return;}
 const items=Array.isArray(data)?data:(Array.isArray(data.tasks)?data.tasks:Object.entries(data).filter(([k,v])=>v&&typeof v==='object'&&v.state).map(([k,v])=>({label:k,...v})));
 $('runtime').innerHTML=items.map(t=>{const persisted=t.responsePersisted===true||(t.state==='Completed'&&t.result!=null);const usage=t.actualUsage??t.result?.usage;const complete=t.state==='Completed'&&persisted&&usage!=null;const state=t.state==='Completed'&&!complete?'Unknown':t.state;return `<div class="runtime-row"><b>${esc(t.label||t.grantId)}: ${esc(state)}</b><p class="muted">${esc(t.model||t.result?.model||'No verified model response')} · ${esc((t.fixture||t.result?.fixture)?'FIXTURE — no real provider call':'actual response evidence only if present')}</p><pre>${esc(json(t))}</pre></div>`;}).join('')||'<p class="muted">No persisted dispatch events. Accepted on-chain alone is not Completed.</p>';
}
async function init(){
 cfg=await readJSON('deployment.json');abi=await readJSON(cfg.abiFile||'abi.json');if(abi.abi)abi=abi.abi;
 if(cfg.syntheticModel){const notice=document.createElement('aside');notice.className='notice';notice.textContent='ACTUAL MONAD CHAIN / SYNTHETIC MODEL FIXTURE. Zero provider HTTP calls in this tree. Operator A is PaidUndispatched; split inputs use a synthetic plan, not A model output. Operator B completion is fixture output. This is a separate run from the actual HTTP401 task.';document.querySelector('.intro').after(notice);}
 rpc=new JsonRpcProvider(cfg.rpc,undefined,{cacheTimeout:0});contract=new Contract(cfg.contract,abi,rpc);
 records=JSON.parse(localStorage.getItem(recordsKey())||'[]');if($('recovery-link')&&cfg.recoveryUrl)$('recovery-link').href=cfg.recoveryUrl;
 $('deployment').textContent=`${cfg.environment==='local-simulation'?'LOCAL SIMULATION · Anvil, not actual Monad':Number(cfg.chainId)===10143?'Monad TESTNET':'LOCAL FIXTURE'} · chain ${cfg.chainId} · ${cfg.contract} · saved code hash ${cfg.codeHash}`;
 if(bridgeEnabled()){document.querySelector('.pill').textContent=testBridge()?'MONAD TESTNET · TEST WALLET BRIDGE':'LOCAL SIMULATION · ANVIL';const note=document.createElement('p');note.className='notice';note.textContent=testBridge()?'TEST WALLET BRIDGE — controlled test EOAs, signed by this origin’s independent loopback service. This is not an installed wallet extension. No browser private keys. Free test MON only.':'LOCAL FIXTURE signer — not an installed wallet extension.';$('deployment').parentElement.before(note);const select=document.createElement('select');select.id='fixture-account';select.setAttribute('aria-label','Controlled test signer');for(const w of cfg.bridgeWalletAccounts||cfg.fixtureWalletAccounts||[]){const option=document.createElement('option');option.value=w.address;option.textContent=`${testBridge()?'TEST BRIDGE':'FIXTURE'} ${w.role}: ${w.address.slice(0,8)}…`;select.appendChild(option);}select.onchange=()=>{account=null;disableActions();status('Controlled test signer changed. Reconnect.');};$('connect').before(select);}
 $('connect').onclick=()=>connect().catch(e=>status(e.message,true));$('refresh').onclick=()=>refresh().catch(e=>status(e.message,true));if($('close'))$('close').onclick=()=>send('close',cfg.rootId,'owner');
 await refresh();if(cfg.readOnly){$('connect').disabled=true;disableActions();status('LIVE RPC: deployed bytecode and completed ledger verified. READ-ONLY explorer; no transactions or model calls.');}else status('Saved deployment and bytecode verified. Read-only until wallet connection.');
}
init().catch(e=>{status(`Cannot verify deployment: ${e.message}. Writes remain disabled.`,true);disableActions();});
