import assert from 'node:assert/strict';
// Discover only grants actually created onchain, after close has stopped new splits.
// Deterministic IDs in an input report can name children that were never created.
export async function discoverClosedRecoveryGrants(read,rootId){
 assert.equal(await read('closing',[rootId]),true,'close must be confirmed before discovering a stable recovery tree');
 const root=await read('grants',[rootId]);assert.equal(Number(root[8]),1,'registered root required');assert.equal(root[0].toLowerCase(),rootId.toLowerCase(),'root domain mismatch');
 const count=Number(await read('childCount',[rootId]));assert.ok(Number.isInteger(count)&&count>=0&&count<=2,'bounded child count');
 const ids=[rootId];for(let i=0;i<count;i++){const id=await read('childId',[rootId,BigInt(i)]);assert.ok(!ids.some(x=>x.toLowerCase()===id.toLowerCase()),'duplicate child');const g=await read('grants',[id]);assert.equal(Number(g[8]),2,'registered child required');assert.equal(g[0].toLowerCase(),rootId.toLowerCase(),'child belongs to another root');ids.push(id);}
 return ids;
}
