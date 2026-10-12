import { DurableWorker, VerifiedGate } from './worker.mjs';
// Launch adapter module is supplied by caller; only per-operator DB lives here.
// Parent sends header and accepted jobs via IPC. A/B are distinct fork processes.
const adapterPath=process.argv[2];
if(!adapterPath)throw new Error('usage: node process.mjs <adapter-module-url>');
const {createAdapters}=await import(adapterPath);const adapters=await createAdapters();
const gate=adapters.gate??new VerifiedGate();
const worker=new DurableWorker({...adapters,gate});
process.on('message',async message=>{
 try{
  if(message.type==='header'){gate.ingest(message.header,message.receivedAt);return;}
  if(message.type==='accepted'){const result=await worker.runAccepted(message.job);process.send?.({id:message.job.id,result});}
 }catch(e){process.send?.({id:message.job?.id,error:e.message});}
});
process.send?.({type:'ready',pid:process.pid,directory:adapters.directory});
