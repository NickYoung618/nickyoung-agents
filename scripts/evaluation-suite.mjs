// All strategies receive the same seed, goal, configured model pool and external acceptance.
const assertImport = `import assert from 'node:assert/strict';\n`;
export const cases = [
  {
    id: "local",
    type: "局部明确修改",
    goal: "修复 src/math.mjs 的 double，使有限数值乘以二；保持导出不变。",
    files: { "src/math.mjs": "export const double=x=>x;\n" },
    acceptance:
      assertImport +
      `const {double}=await import(process.cwd()+'/src/math.mjs');for(const x of [-4,0,2,2.5])assert.equal(double(x),x*2);`,
  },
  {
    id: "multi",
    type: "普通多文件功能",
    goal: "实现 src/parser.mjs 的 parseNumber：接受有限数字与前后空白，拒绝空白和非数字并抛出 TypeError；增加 src/cli.mjs，读取一个参数输出两倍，错误退出非零。",
    files: { "src/parser.mjs": "export const parseNumber=s=>Number(s);\n" },
    acceptance:
      assertImport +
      `import {execFileSync,spawnSync} from 'node:child_process';const {parseNumber}=await import(process.cwd()+'/src/parser.mjs');assert.equal(parseNumber(' 2.5 '),2.5);for(const s of ['',' ','abc','Infinity'])assert.throws(()=>parseNumber(s),TypeError);assert.equal(execFileSync(process.execPath,['src/cli.mjs','3'],{encoding:'utf8'}).trim(),'6');assert.notEqual(spawnSync(process.execPath,['src/cli.mjs','bad']).status,0);`,
  },
  {
    id: "contract",
    type: "接口契约冲突",
    goal: "修复 normalize 与 consumer 的约定冲突，公共 normalize(s) 返回 {value: 小写且去空白字符串}，consumer(s) 返回该 value。保留公共对象约定；在继续消费者改动前明确验证该约定。",
    files: {
      "src/normalize.mjs":
        "export const normalize=s=>({value:s.trim().toLowerCase()});\n",
      "src/consumer.mjs":
        "import {normalize} from './normalize.mjs';export const consumer=s=>normalize(s).normalized;\n",
    },
    acceptance:
      assertImport +
      `const {normalize}=await import(process.cwd()+'/src/normalize.mjs');const {consumer}=await import(process.cwd()+'/src/consumer.mjs');assert.deepEqual(normalize(' A '),{value:'a'});assert.equal(consumer(' B '),'b');`,
  },
  {
    id: "bug",
    type: "复杂局部 bug",
    goal: "实现可测试的过期缓存 src/cache.mjs：createCache(now) 返回 set(key,value,ttl)、get(key)；now 为注入毫秒时钟，边界 now>=expires 必须过期，缺失返回 undefined，值可以为 0、false，ttl<=0 立即过期。",
    files: {
      "src/cache.mjs": `export function createCache(now){const m=new Map();return {set(k,v,ttl){m.set(k,{v,end:now()+ttl})},get(k){const e=m.get(k);return e&&now()<=e.end?e.v:undefined}}}\n`,
    },
    acceptance:
      assertImport +
      `const {createCache}=await import(process.cwd()+'/src/cache.mjs');let n=0;const c=createCache(()=>n);c.set('a',0,5);c.set('b',false,10);assert.equal(c.get('a'),0);n=5;assert.equal(c.get('a'),undefined);assert.equal(c.get('b'),false);c.set('c',1,0);assert.equal(c.get('c'),undefined);assert.equal(c.get('none'),undefined);`,
  },
  {
    id: "permissions",
    type: "权限与数据高影响修改",
    goal: "修复纯函数 canRead(user,record)：仅非空已认证 id 的所有者或 role=admin 允许访问；缺失 user/record 一律拒绝，不修改记录。不做真实认证配置或部署。",
    files: {
      "src/access.mjs": "export const canRead=(user,record)=>!!user;\n",
    },
    acceptance:
      assertImport +
      `const {canRead}=await import(process.cwd()+'/src/access.mjs');const record=Object.freeze({ownerId:'u1'});assert.equal(canRead({id:'u1'},record),true);assert.equal(canRead({id:'u2'},record),false);assert.equal(canRead({id:'admin',role:'admin'},record),true);for(const u of [null,{}, {id:'',role:'admin'}])assert.equal(canRead(u,record),false);assert.equal(canRead({id:'u1'},null),false);`,
  },
  {
    id: "resume_append",
    type: "暂停恢复与目标追加",
    goal: "实现 src/counter.mjs 的 createCounter，返回 inc/get 方法，初始为 0，每次 inc 增加 1；独立本地库。",
    initialAcceptance:
      assertImport +
      `const {createCounter}=await import(process.cwd()+'/src/counter.mjs');const c=createCounter();assert.equal(c.get(),0);c.inc();c.inc();assert.equal(c.get(),2);`,
    appendGoal: "继续增加 reset() 将同一 counter 重置为 0，保留 inc/get 行为。",
    pause: true,
    files: {
      "src/counter.mjs":
        "export function createCounter(){return {inc(){},get(){return 0}}}\n",
    },
    acceptance:
      assertImport +
      `const {createCounter}=await import(process.cwd()+'/src/counter.mjs');const c=createCounter();assert.equal(c.get(),0);c.inc();c.inc();assert.equal(c.get(),2);c.reset();assert.equal(c.get(),0);c.inc();assert.equal(c.get(),1);`,
  },
];
