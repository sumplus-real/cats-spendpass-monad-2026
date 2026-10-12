import fs from 'node:fs';
import path from 'node:path';
export function requiredEnv(name){const value=process.env[name];if(!value||/CHOOSE_|REPLACE_|YOUR_/.test(value))throw new Error(`${name} must be explicitly configured; default is disabled`);return value;}
export function protectedFile(variable){const filename=requiredEnv(variable),stat=fs.statSync(filename);if(!stat.isFile()||(stat.mode&0o077)!==0)throw new Error(`${variable} must reference a private owner-only regular file`);return filename;}
export function readWallets(){return JSON.parse(fs.readFileSync(protectedFile('SPENDPASS_WALLETS_FILE'),'utf8'));}
export function quotaKey({fileVariable='SPENDPASS_QUOTA_ENV_FILE',keyName}={}){const filename=protectedFile(fileVariable);const name=keyName||process.env.SPENDPASS_QUOTA_KEY_NAME||'SPENDPASS_API_KEY';if(!/^[A-Z][A-Z0-9_]*$/.test(name))throw new Error('invalid quota variable name');const matcher=new RegExp(`^(?:export\\s+)?${name}\\s*=\\s*(.*)$`);for(const line of fs.readFileSync(filename,'utf8').split(/\r?\n/)){const match=line.match(matcher);if(match){const key=match[1].trim().replace(/^(['"])(.*)\1$/,'$2');if(!key||key.includes('\n'))throw new Error('quota key empty');return key;}}throw new Error('configured quota key unavailable');}
export function recordSingleAttempt(guard,record){
 // Exact caller-configured existing permanent guard is never removed or replaced.
 const fd=fs.openSync(guard,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify({attempts:1,...record}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const directory=fs.openSync(path.dirname(guard),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
}
