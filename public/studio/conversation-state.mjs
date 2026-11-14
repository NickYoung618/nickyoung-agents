import {blankState,applyStateEvent} from './live-state.mjs';
export const applyEvent=applyStateEvent;
export function project(events){const s=blankState(events[0]?.conversation);for(const e of events)applyEvent(s,e);return s;}
