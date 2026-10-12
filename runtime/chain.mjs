import { decodeEventLog } from 'viem';
// Read-only viem adapter. Offers mapping is keyed by grantId, not offerId().
export function acceptanceReader(client,address,abi){
 return async (job,header)=>{
  if(await client.getChainId()!==10143)throw new Error('wrong chain');
  const blockNumber=BigInt(header.number);
  if(!job.receipt.transactionHash)throw new Error('accept transaction hash absent');
  const actual=await client.getTransactionReceipt({hash:job.receipt.transactionHash});
  if(actual.to?.toLowerCase()!==address.toLowerCase())throw new Error('actual receipt.to is not pinned contract');
  if(actual.status!=='success'||actual.blockNumber!==blockNumber||actual.blockHash.toLowerCase()!==header.hash.toLowerCase())throw new Error('actual accept receipt mismatch');
  const accepted=actual.logs.some(log=>{
   if(log.address.toLowerCase()!==address.toLowerCase())return false;
   try{const e=decodeEventLog({abi,data:log.data,topics:log.topics});return e.eventName==='Accepted'&&e.args.grantId.toLowerCase()===job.grantId.toLowerCase()&&BigInt(e.args.fee)===BigInt(job.fee)&&e.args.payee.toLowerCase()===job.quote.payee.toLowerCase();}catch{return false;}
  });
  if(!accepted)throw new Error('receipt lacks matching contract Accepted event');
  const before=await client.getBlock({blockNumber});
  if(before.hash.toLowerCase()!==header.hash.toLowerCase())throw new Error('Verified header differs from RPC canonical block');
  const [offer,grant]=await Promise.all([
   client.readContract({address,abi,functionName:'offers',args:[job.grantId],blockNumber}),
   client.readContract({address,abi,functionName:'grants',args:[job.grantId],blockNumber})
  ]);
  const policyHash=await client.readContract({address,abi,functionName:'policyHash',args:[grant[0]],blockNumber});
  const after=await client.getBlock({blockNumber});
  if(after.hash.toLowerCase()!==header.hash.toLowerCase())throw new Error('RPC block changed during entitlement read');
  return {grantId:job.grantId,offerState:Number(offer[0])===2?'Accepted':String(offer[0]),operator:offer[1],payee:offer[2],fee:offer[3],providerUnclaimed:grant[4],providerClaimed:grant[5],quoteHash:offer[5],policyHash,blockHash:after.hash};
 };
}
