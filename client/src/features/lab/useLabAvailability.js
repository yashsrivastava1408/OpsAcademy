import { useCallback, useState } from 'react';
import { labPortalApi } from '../../shared/services/api';
import usePolling from '../../shared/hooks/usePolling';

/**
 * Where the signed-in learner stands for the lab right now (open, available, full, queued, no slot, blocked).
 * Polled slowly; `null` until the first answer, and it stays `null` if the server cannot say.
 */
export default function useLabAvailability(intervalMs = 15000, enabled = true) {
  const [state, setState] = useState(null);
  const load = useCallback(() => {
    labPortalApi.availability().then((res) => setState(res.data.data)).catch(() => setState(null));
  }, []);
  usePolling(load, intervalMs, enabled);
  return state;
}
