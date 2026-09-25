import type { AgentState } from '../lib/types';
import { StopIcon } from './icons';

/** Live "what Claude is doing right now" strip above the composer. */
export function ActivityBar({ agent, working, onStop }: { agent: AgentState | null; working: boolean; onStop?: () => void }) {
  if (!working) return null;
  return (
    <div className="activity">
      <span className="dots"><i /><i /><i /></span>
      <span className="activity-text">{agent?.activity || 'Working…'}</span>
      {onStop && (
        <button className="activity-stop" onClick={onStop}>
          <StopIcon width={14} height={14} /> Stop
        </button>
      )}
    </div>
  );
}
