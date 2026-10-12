import test from 'node:test';import assert from 'node:assert/strict';import {discoverClosedRecoveryGrants} from './recovery-topology.mjs';
const root='0x'+'11'.repeat(32),c0='0x'+'22'.repeat(32),c1='0x'+'33'.repeat(32);
const grant=(id,depth)=>[id,0n,0n,0n,0n,0n,0n,0n,depth];
function reader({closing=true,count=0,depth=2}={}){return async(fn,args)=>fn==='closing'?closing:fn==='childCount'?count:fn==='childId'?[c0,c1][Number(args[1])]:args[0]===root?grant(root,1):grant(root,depth);}
test('failed provider before split: only root is registered; future child IDs never probed',async()=>{const read=reader();const guard=async(fn,args)=>{assert.notEqual(fn,'childId','no split means no created leaves');if(fn==='grants')assert.equal(args[0],root);return read(fn,args);};assert.deepEqual(await discoverClosedRecoveryGrants(guard,root),[root]);});
test('actual two created leaves included',async()=>assert.deepEqual(await discoverClosedRecoveryGrants(reader({count:2}),root),[root,c0,c1]));
test('uncreated depth0 child is a known bad topology and rejected',async()=>assert.rejects(discoverClosedRecoveryGrants(reader({count:1,depth:0}),root),/registered child/));
test('active tree is not stable enough for cold traversal',async()=>assert.rejects(discoverClosedRecoveryGrants(reader({closing:false}),root),/close must be confirmed/));
test('count over frozen bound rejected',async()=>assert.rejects(discoverClosedRecoveryGrants(reader({count:3}),root),/bounded child count/));
