import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { engineFixture } from './workflow-engine-fixture.mjs';
import { packs } from './workflow-fixture.mjs';
import { createCommandPipeline } from '../dist/commands/pipeline.js';
import { createRuleHandlers } from '../dist/automation/ruleCommands.js';
import { createWorkflowHandlers } from '../dist/workflow/commands.js';
import { artifactsTransitionHandler, withKnowledgeEffects } from '../dist/knowledge/commands.js';
import { tasksTransitionHandler } from '../dist/work/service.js';
import { tickRules } from '../dist/automation/rules.js';
export function eventFixture(t){const f=engineFixture(t);f.start();
 const pipeline=createCommandPipeline({storage:f.storage,hub:f.hub,clock:f.clock,handlers:{...createRuleHandlers({packs}),...createWorkflowHandlers({packs}),'artifacts.transition':artifactsTransitionHandler,'tasks.transition':withKnowledgeEffects(tasksTransitionHandler)}});
 const execute=(type,payload)=>{const result=pipeline.execute({apiVersion:1,commandId:randomUUID(),projectId:f.projectId,type,payload});assert.equal(result.status,200,JSON.stringify(result.body));return result;};
 const create=(eventType,condition)=>{const id=randomUUID();execute('rules.create',{ruleId:id,name:'Events',eventType,condition,action:{kind:'start-workflow',definitionKey:'software-delivery',packKey:'software-team'}});return id;};
 const source=type=>{if(type==='task.status-changed'){f.move('author','active');const task=f.tasks('author')[0];execute('tasks.transition',{taskId:task.id,expectedRevision:task.revision,to:'cancelled'});return {taskCode:task.code,to:'cancelled'};}
 const artifact=f.artifact('author','other','draft');execute('artifacts.transition',{...artifact,to:'in-review',comment:''});return {artifactKind:'other',to:'in-review'};};
 return {...f,execute,create,source,tick:()=>tickRules({raw:f.raw,hub:f.hub,packs,pipeline},f.clock()),fires:id=>f.raw.prepare('SELECT * FROM rule_fires WHERE rule_id=? AND event_sequence>0 ORDER BY event_sequence').all(id)};
}
