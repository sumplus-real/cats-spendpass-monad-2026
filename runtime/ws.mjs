import WebSocket from 'ws';
// Subscription is Monad WS commitState, never HTTP "verified" block tag.
export function connectVerified(gate,url='wss://testnet-rpc.monad.xyz'){
 const ws=new WebSocket(url);let lastHeaderAt=0;let subscribed=false;const errors=[];
 const ready=new Promise((resolve,reject)=>{
  ws.once('error',reject);ws.on('open',()=>ws.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_subscribe',params:['monadNewHeads']})));
  ws.on('message',bytes=>{try{const x=JSON.parse(bytes.toString());if(x.error){errors.push(x.error);reject(new Error(JSON.stringify(x.error)));return;}if(x.id===1&&x.result){subscribed=true;resolve(x.result);}if(gate.ingest(x))lastHeaderAt=Date.now();}catch(e){errors.push({message:e.message});}});
 });
 return {ws,ready,errors,probe:()=>({subscribed,lastHeaderAt,healthy:errors.length===0&&subscribed&&ws.readyState===WebSocket.OPEN&&Date.now()-lastHeaderAt<3000}),close:()=>ws.close()};
}
