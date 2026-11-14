export const labels = {
  implemented: '已实现', planning:'规划', executing:'实现', validating:'运行检查', repairing:'修复', delivered:'已交付', blocked:'等待处理',
  waiting_user:'等待用户处理文件冲突', idle: '待开始', working: '进行中', paused: '已暂停', interrupted: '等待恢复',
  done: '已交付', error: '遇到问题', queued: '待执行', running: '实现中',
  review: '待审查', reviewing: '审查中', repair: '返修中', consultation: '待处理方案',
  passed: '已通过', deferred: '遗留', stopped: '已停止', cancelled: '已取消',
  resolved: '遗留已解决', rate_wait: '等待额度恢复', rate_limited: '额度受限', waiting_setup: '等你决定',
};
export const memberName = (s, id) => s.members.find(m => m.id === id)?.name || id || '尚未分配';
export function progress(s) {
  if (s.workflowVersion === 'adaptive_v1' && s.cycle) {
    const x=s.cycle, waiting=s.questions.filter(q=>!q.answered&&(!q.cycleId||q.cycleId===x.cycleId)).length;
    const checks=x.gates.filter(g=>g.kind==='check'), reviews=x.gates.filter(g=>g.kind==='model');
    const implemented=x.tasks.filter(t=>t.status==='implemented').length;
    const checked=checks.filter(g=>['passed','reused'].includes(g.status)).length;
    const reviewState=x.policy==='checks_only'?'按策略无需模型审查':reviews.some(g=>g.status==='changes_requested')?'局部修复 / 待复查':reviews.every(g=>g.status==='passed')&&reviews.length?'独立审查及补丁证据已满足':'等待整体独立审查';
    const active=x.tasks.find(t=>t.status==='running');
    const denied=s.questions.filter(q=>q.cycleId===x.cycleId&&q.authorization&&q.answer===false).length;
    const reason=s.status==='paused'?'点击继续恢复当前阶段':x.phase==='blocked'?x.blockedReason:denied?`${denied} 项授权已拒绝，关联任务不会执行；可调整目标`:waiting?`${waiting} 项决定等待答复；无关任务继续排队`:active?`${memberName(s,active.member)} · ${active.title}`:x.phase==='validating'?'程序正在验证固定提交':x.phase==='reviewing'?'审查者核对已有证据和验收标准':x.reason;
    return { action: s.status==='paused'?'工作流已暂停':`${labels[x.phase]||x.phase}${active?' · '+active.title:''}`, next:`${reason||'等待依赖或检查点'} · ${reviewState}`,waiting,passed:implemented,implemented,checked,checkTotal:checks.length,reviewState,policy:x.policy,reason:x.reason,last:s.events.at(-1),total:x.tasks.length };
  }
  const waiting = s.questions.filter(q => !q.answered).length;
  const active = s.tasks.filter(t => ['running','reviewing','repair','consultation'].includes(t.status));
  const busy = s.members.filter(m => m.status === 'running');
  let action = '暂无正在运行的成员；等待下一次调度。', next = '可以补充要求。';
  if (s.status === 'paused') { action = '工作流已暂停' + (busy.length ? '，正在停止当前进程。' : '。'); next = '点击继续恢复任务。'; }
  else if (['error','interrupted'].includes(s.status)) { action = labels[s.status]; next = '查看运行问题后，点击继续恢复。'; }
  else if (s.status === 'done') { action = '本次任务已交付'; next = '查看交付成果和验收证据，或补充修改要求。'; }
  else if (active.length) {
    action = active.map(t => `${memberName(s, ['reviewing'].includes(t.status) ? t.reviewer : t.member)} · ${t.title} · ${labels[t.status]}`).join('；');
    next = waiting ? `${waiting} 项决定需要你答复，其余工作按实际状态推进。` : '等待当前工作结果；可查看任务清单和证据。';
  } else if (busy.length) action = busy.map(m => `${m.name}正在处理需求`).join('；');
  else if (waiting) { action = `${waiting} 项决定等待答复`; next = '打开待你决定，查看各选项后果。'; }
  const resourceWait=s.events.findLast(e=>e.type==='resource_wait'),resourceReady=s.events.findLast(e=>e.type==='resource_ready');
  if(s.status==='working'&&resourceWait&&resourceWait.id>(resourceReady?.id||0)){action='等待资源 · '+resourceWait.data.reason;next='资源释放后自动继续，可以停止闲置预览释放预算。';}
  const activity=s.events.findLast(e=>['process','message','check','review','run_start','artifact','preview'].includes(e.type));
  const process=s.events.findLast(e=>e.type==='process');
  const command=process?.data.event?.item?.command || process?.data.event?.command;
  if(command && busy.length && s.status==='working') {
    const phase=/\b(test|pytest|jest|vitest|playwright)\b|--test/.test(command)?'测试':/apply_patch|\b(sed|tee)\b.*(>|-i)/.test(command)?'修改文件':/\b(cat|rg|head|tail|ls)\b/.test(command)?'读取文件':null;
    if(phase)action+=' · '+phase;
  }
  const last = activity || s.events.at(-1);
  return { action, next, waiting, passed: s.tasks.filter(t => t.status === 'passed').length, last };
}
const important = new Set(['message','task','task_update','review','check','error','report','question','answer','decision','interrupted','question_closed','cycle_phase','cycle_review_start','cycle_review','cycle_repair','workflow_blocked','planner_trigger','workflow_status']);
export function timeline(events, limit = 8) {
  return events.filter(e => important.has(e.type)).slice(-limit);
}
export function eventText(s, e) {
  const d = e.data, task = s.tasks.find(t => t.id === (d.task || d.id));
  switch(e.type) {
    case 'cycle_phase': return `批次${labels[d.phase]||d.phase}${d.reason?' · '+d.reason:''}`;
    case 'cycle_review_start': return '提交固定快照，开始整体审查或范围复查';
    case 'cycle_review': return `审查记录 · 阻塞 ${d.blockingIssues?.length||0} 项 · 建议 ${d.advisories?.length||0} 项 · 待验证 ${d.needsVerification?.length||0} 项`;
    case 'cycle_repair': return `局部修复 · ${d.issueIds.join('、')}`;
    case 'workflow_blocked': return `等待处理 · ${d.reason}`;
    case 'planner_trigger': return `有证据升级 · ${d.reason}`;
    case 'task': return `${memberName(s, 'leader')} → ${memberName(s, d.member)} · ${d.title}`;
    case 'task_update': return `${task?.title || '任务'} · ${labels[d.status] || d.status}`;
    case 'review': return `${task?.title || '任务'} · 审查${d.verdict === 'pass' ? '通过' : '退回'} · ${d.message || ''}`;
    case 'check': return `${task?.title || '任务'} · 机器验收${d.passed ? '通过' : '未通过'}`;
    case 'report': return '交付报告已记录，前往交付成果核验。';
    case 'question': return `待你决定 · ${d.question}`;
    case 'answer': return `你的回答 · ${d.answer ? '是' : '否'}`;
    case 'model_change': case 'member': return '模型配置已更新';
    case 'question_closed': return `请示已结束 · ${d.reason}`;
    default: return d.text || d.message || labels[d.status] || e.type;
  }
}
export function deliveryEvidence(s, report) {
  if (report.data.cycleId) {
    const d=report.data, checks=d.checks||[], coverage=d.reviewCoverage||[];
    const reviews=s.events.filter(e=>e.type==='cycle_review'&&e.data.cycleId===d.cycleId&&e.id<=report.id).map(e=>({id:e.id,commit:e.data.reviewedCommit,verdict:e.data.blockingIssues?.length||e.data.needsVerification?.length?'return':'pass'}));
    return {cycleId:d.cycleId,finalCommit:d.finalCommit,reviewedCommit:d.reviewedCommit,policy:d.policy,
      reviewLabel:d.policy==='checks_only'?'按策略无需模型审查':coverage.some(g=>g.coverage==='reviewed_plus_checked_patch')?'原提交已审查＋后续补丁经指定检查':coverage.some(g=>g.phase==='recheck')?'整体审查＋范围复查':'整体独立审查',
      usage:d.usage||'',incomplete:(d.tasks||[]).filter(t=>t.status!=='implemented'),passed:checks.filter(e=>e.result==='passed').length,failed:checks.filter(e=>e.result==='failed').length,reviews,unresolvedIssues:d.unresolvedIssues||[],summary:String(d.text||'').slice(0,320)};
  }
  const previous = s.events.findLast(e => e.type === 'report' && e.id < report.id)?.id || 0;
  const events = s.events.filter(e => e.id > previous && e.id <= report.id);
  const checks = events.filter(e => e.type === 'check');
  const reviews = events.filter(e => e.type === 'review');
  const tasks = new Map();
  for (const e of s.events.filter(e => e.id <= report.id)) {
    if (e.type === 'task') tasks.set(e.data.id, {...e.data});
    if (e.type === 'task_update' && tasks.has(e.data.id)) Object.assign(tasks.get(e.data.id), e.data);
  }
  const incomplete = [...tasks.values()].filter(t => t.status !== 'passed' && t.status !== 'resolved');
  const reportText = String(report.data.text || '');
  const usage = ""; // Only structured, program-verified artifacts provide usage entries.
  return { usage, incomplete, reviewFailed: reviews.filter(e => e.data.verdict !== "pass" || e.data.issues?.length).length, runtimeFailed: events.filter(e => ["run_failed", "error", "artifact_error"].includes(e.type)).length, passed: checks.filter(e => e.data.passed).length, failed: checks.filter(e => !e.data.passed).length,
    reviews: reviews.map(e => ({ id: e.id, verdict: e.data.verdict, commit: e.data.commit })),
    summary: reportText.split('。').slice(0,2).join('。').slice(0,320) };
}
