export function weiAmount(value){if(typeof value==='bigint'&&value>=0n)return value;if(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value))return BigInt(value);throw Error('gas amount must be a nonnegative bigint or decimal integer string');}
export function withinGasBudget(spent,reserved,next,limit){return weiAmount(spent)+weiAmount(reserved)+weiAmount(next)<=weiAmount(limit);}
