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
