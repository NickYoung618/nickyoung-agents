export function speaker(state, event) {
  const member = state.members.find((m) => m.id === event.data.member) || {};
  const result = state.events.findLast(
    (e) =>
      e.id < event.id &&
      e.type === "model_result" &&
      e.data.member === event.data.member,
  )?.data;
  const start = state.events.findLast(
    (e) =>
      e.id < event.id &&
      e.type === "run_start" &&
      e.data.member === event.data.member,
  )?.data;
  return {
    ...member,
    model: event.data.model || result?.model || start?.model || member.model,
    effort: event.data.effort || start?.effort || member.effort,
  };
}
