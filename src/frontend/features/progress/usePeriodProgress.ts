import { useState, useEffect } from 'react';
import type { ProgressHistoryResponse } from '../../types/api.js';
import { getProgressHistory } from '../../api/client.js';
import { useActivityRevision } from '../activity-revision.js';

export function usePeriodProgress() {
  const revision = useActivityRevision();
  const [runTypeFilter, setRunTypeFilter] = useState<'all' | 'easy' | 'threshold'>('all');
  const [data, setData] = useState<ProgressHistoryResponse | null>(null);
  const [completed, setCompleted] = useState<string | null>(null);
  const request = [runTypeFilter, revision].join(':');
  useEffect(() => {
    const controller = new AbortController();
    getProgressHistory(runTypeFilter, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setData(data);
      setCompleted(request);
    }).catch(error => {
      if (controller.signal.aborted) return;
      console.error('Failed to load progress history:', error);
      setCompleted(request);
    });
    return () => controller.abort();
  }, [runTypeFilter, request]);
  return { data, loading: completed !== request, runTypeFilter, setRunTypeFilter };
}
