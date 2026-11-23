import {runMaintenance} from '<home>/projects/cucumber-mcp-study/scripts/cumulative-runner.mjs';
import {createMaintenanceState} from '<home>/projects/cucumber-mcp-study/scripts/maintenance.mjs';
import {acquireLock,reset} from '<home>/projects/cucumber-mcp-study/scripts/fixture.mjs';
const unlock=acquireLock();const state=createMaintenanceState();const ev=[];
try{
  const m=await runMaintenance({revision:'v1',from:'v0',state,emit:e=>{ev.push(e)},wallMs:Number(process.argv[2]||240000),absoluteDeadline:Date.parse('2026-11-01T21:00:00Z')});
  console.log('ERROR',m.error,'elapsed',m.elapsedMs,'quiescent',m.quiescent,'budget',m.budgetExpired);
  const counts={};for(const e of ev)counts[e.type]=(counts[e.type]||0)+1;console.log(JSON.stringify(counts));
  for(const e of ev){
    if(e.type==='validation-case-error'||e.type==='validation-private-infrastructure'||e.type==='maintenance-error'){
      const b=e.baseline;
      console.log(JSON.stringify({type:e.type,caseId:e.caseId,error:e.error,code:e.errorCode,b:b&&{keys:Object.keys(b),stepFailures:b.stepFailures,scenarioCount:b.scenarioCount,timedOut:b.timedOut,cap:b.privateCaptureFailed,stderr:String(b.stderr||'').slice(-500)}}).slice(0,1700));
    }
    if(e.type==='validation-case')console.log(e.validation,e.caseId,JSON.stringify({f:e.baseline.stepFailures?.map(s=>String(s.step||'').slice(0,60)),ok:e.observation?.valid}).slice(0,170));
  }
  if(m.agent)console.log('AGENT',JSON.stringify({model:m.agent.actualModels,mv:m.agent.modelVerified,usage:m.agent.usage,final:String(m.agent.rawResponse||'').slice(0,400),timedOut:m.agent.timedOut}));
  const tools={};for(const e of ev){const n=e?.event?.item?.tool;if(n&&e.event.type==='item.completed')tools[n]=(tools[n]||0)+1;}console.log('TOOLS',JSON.stringify(tools));
  if(m.frozen)console.log('FROZEN',JSON.stringify({sha:m.frozen.implementation?.sha256,edits:m.frozen.edits,reason:m.frozen.reason}).slice(0,300));
}finally{await reset();unlock()}

