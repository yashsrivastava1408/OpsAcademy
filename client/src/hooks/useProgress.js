import { useEffect, useState } from 'react';
import { getProgress, refreshProgress, subscribeProgress } from '../services/progressService';

/** The signed-in user's progress summary, kept up to date. */
export default function useProgress() {
  const [progress, setProgress] = useState(getProgress);

  useEffect(() => {
    const unsubscribe = subscribeProgress(setProgress);
    refreshProgress();
    return unsubscribe;
  }, []);

  return progress;
}
