export function statistics(conversations) {
  const groups = new Map();
  const key = (result) => result.model + ":" + (result.tier || "成员");
  function group(result) {
    const k = key(result);
    if (!groups.has(k))
      groups.set(k, {
        model: result.model,
        tier: result.tier || "成员",
        turns: 0,
        failed: 0,
        duration: 0,
        input: 0,
        output: 0,
        tasks: 0,
        firstPassed: 0,
        repairs: 0,
      });
    return groups.get(k);
  }
  for (const conversation of conversations) {
    for (const e of conversation.events) {
      if (!["model_result", "run_failed"].includes(e.type)) continue;
      const r = e.data,
        g = group(r);
      g.turns++;
      g.failed += e.type === "run_failed" ? 1 : 0;
      g.duration += r.duration || 0;
      g.input +=
        (r.usage?.input_tokens || 0) +
        (r.channel === "claude"
          ? (r.usage?.cache_creation_input_tokens || 0) +
            (r.usage?.cache_read_input_tokens || 0)
          : 0);
      g.output += r.usage?.output_tokens || 0;
    }
    for (const task of conversation.tasks) {
      const commits = conversation.events.filter(
        (e) =>
          e.type === "task_update" && e.data.id === task.id && e.data.commit,
      );
      const delivery = (commit) =>
        conversation.events
          .filter(
            (e) =>
              e.type === "model_result" &&
              e.data.member === task.member &&
              e.id < commit.id,
          )
          .at(-1)?.data;
      const touched = new Map();
      for (const commit of commits) {
        const result = delivery(commit);
        if (result) touched.set(key(result), { result, failures: 0 });
      }
      let failures = 0;
      for (const e of conversation.events) {
        if (
          e.type !== "task_update" ||
          e.data.id !== task.id ||
          e.data.failures === undefined
        )
          continue;
        const delta = e.data.failures - failures;
        failures = e.data.failures;
        const commit = commits.filter((c) => c.id < e.id).at(-1),
          result = commit && delivery(commit);
        if (result && delta > 0) {
          group(result).repairs += delta;
          touched.get(key(result)).failures += delta;
        }
      }
      const last = commits.at(-1),
        final = last && delivery(last);
      for (const { result, failures: count } of touched.values()) {
        const g = group(result);
        g.tasks++;
        if (
          task.status === "passed" &&
          final &&
          key(final) === key(result) &&
          !count
        )
          g.firstPassed++;
      }
    }
  }
  return [...groups.values()];
}

// Run starts define calls; terminal events supply consumption, including partial failures.
export function cycleStatistics(conversations) {
  const groups = new Map();
  for (const { events } of conversations)
    for (const e of events) {
      const d = e.data;
      if (!d.runId || !d.cycleId) continue;
      if (!groups.has(d.cycleId))
        groups.set(d.cycleId, { runs: new Map(), events: [] });
      const g = groups.get(d.cycleId);
      if (e.type === "run_start")
        g.runs.set(d.runId, { ...g.runs.get(d.runId), start: e });
      if (["model_result", "run_failed", "run_interrupted"].includes(e.type))
        g.runs.set(d.runId, { ...g.runs.get(d.runId), end: e });
    }
  return [...groups].map(([cycleId, g]) => {
    const s = {
      cycleId,
      calls: {},
      failed: 0,
      interrupted: 0,
      usageKnown: 0,
      usageUnknown: 0,
      input: 0,
      output: 0,
      cached: 0,
      cacheCreation: 0,
      modelDuration: 0,
      waitDuration: 0,
      wallDuration: 0,
      humanDecisions: conversations
        .flatMap((c) => c.events)
        .filter((e) => e.type === "answer" && e.data.cycleId === cycleId)
        .length,
    };
    const times = [];
    for (const { start, end } of g.runs.values()) {
      const d = { ...start?.data, ...end?.data },
        u = d.usage;
      s.calls[d.purpose] = (s.calls[d.purpose] || 0) + 1;
      s.failed += end?.type === "run_failed" ? 1 : 0;
      s.interrupted += end?.type === "run_interrupted" ? 1 : 0;
      const known =
        Number.isFinite(u?.input_tokens) && Number.isFinite(u?.output_tokens);
      s[known ? "usageKnown" : "usageUnknown"]++;
      s.input += u?.input_tokens || 0;
      s.output += u?.output_tokens || 0;
      s.cached += u?.cached_input_tokens || u?.cache_read_input_tokens || 0;
      s.cacheCreation += u?.cache_creation_input_tokens || 0;
      s.modelDuration += d.duration || 0;
      s.waitDuration += d.waitDuration || 0;
      if (start) times.push(Date.parse(start.time));
      if (end) times.push(Date.parse(end.time));
    }
    s.usageCoverage = s.usageKnown / (s.usageKnown + s.usageUnknown);
    s.wallDuration = times.length
      ? Math.max(...times) - Math.min(...times)
      : null;
    return s;
  });
}
