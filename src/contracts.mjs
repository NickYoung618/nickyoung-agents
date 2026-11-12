const string = { type: 'string' };
const strings = { type: 'array', items: string };
export const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = items => ({ type: 'array', items });
export const planSchema = object({
  goal: string, scope: strings, conventions: strings,
  criteria: array(object({ id: string, text: string })),
  tasks: array(object({ id: string, title: string, description: string, executorId: string, dependsOn: strings, gateIds: strings, waitsForQuestions: strings, scope: strings })),
  gates: array(object({ id: string, kind: {type:'string',enum:['check','model']}, phase: {type:'string',enum:['checkpoint','final','recheck']}, scope: strings, afterTasks: strings, criteriaIds: strings, commands: strings, reviewerId: string, assumption: string, deterministic: {type:'boolean'}, outputs: strings })),
  policy: {type:'string',enum:['checks_only','final_review','checkpoint_plus_final']},
  reason: string, facts: strings,
});
export const executorSchema = object({ message: string, completion: {type:'string',enum:['complete','blocked']}, summary: string, files: strings, selfTests: strings, blockers: string, handoff: string });
const issue = object({ issueId:string, taskId:string, criterionId:string, location:string, evidence:string, expected:string, checkIds:strings, semantic:{type:'boolean'} });
export const reviewerSchema = object({ message:string, reviewedCommit:string, criteriaIds:strings, blockingIssues:array(issue), advisories:strings, needsVerification:array(issue) });
export const plannerSchema = object({ message:string, recruits:array(object({ name:string,role:string,tier:string })), plan:planSchema });
export const actionProperties = Object.fromEntries(['type','name','role','tier','member','reviewer','title','description','text','question','yes','no','task','advice','reason','replacement'].map(k=>[k,string]));
for (const k of ['commands','participants']) actionProperties[k]=strings;
export const adaptiveActionProperties = {...actionProperties, plan:planSchema, taskIds:strings, gateIds:strings};

export function validateRoleResult(role, result) {
  const shape = { planner:plannerSchema, executor:executorSchema, reviewer:reviewerSchema }[role];
  const walk = (schema,value,path) => {
    if(schema.type==='object') {
      if(!value || typeof value!=='object' || Array.isArray(value)) throw Error(`${path}: expected object`);
      for(const key of schema.required) if(!(key in value)) throw Error(`${path}.${key}: required`);
      for(const key of Object.keys(value)) { if(!schema.properties[key]) throw Error(`${path}.${key}: unexpected`);walk(schema.properties[key],value[key],`${path}.${key}`); }
    } else if(schema.type==='array') {
      if(!Array.isArray(value)) throw Error(`${path}: expected array`);
      value.forEach((v,i)=>walk(schema.items,v,`${path}[${i}]`));
    } else if(typeof value!==schema.type || (schema.enum && !schema.enum.includes(value))) throw Error(`${path}: invalid ${schema.type}`);
  };
  if(shape) walk(shape,result,role);
  return result;
}
