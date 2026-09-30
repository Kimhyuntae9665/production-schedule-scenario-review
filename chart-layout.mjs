export function sharedHorizon(base,baseline,changed,changedPlan){
 const values=[10,baseline?.makespan??0,changedPlan?.makespan??0];
 for(const s of [base,changed])if(s){values.push(...s.outages.map(o=>o.end),...s.jobs.filter(j=>j.deadline!==undefined).map(j=>j.deadline));}
 return Math.max(...values);
}
export function chartGeometry(horizon){
 if(!Number.isSafeInteger(horizon)||horizon<1)throw Error('Positive integer chart horizon required.');
 const left=48,right=18,width=Math.max(560,left+right+horizon*38);
 return {width,height:260,left,right,scale:(width-left-right)/horizon};
}
export const JOB_COLORS={J1:'#386394',J2:'#237563',J3:'#b9963d',J4:'#765091'};
export const JOB_TEXT_COLORS={J1:'#ffffff',J2:'#ffffff',J3:'#162e24',J4:'#ffffff'};
