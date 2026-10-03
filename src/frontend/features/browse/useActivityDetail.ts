import { useState, useEffect } from 'react';
import type { ActivityDetailResponse, ActivityUpdate } from '../../types/api.js';
import { getActivityDetail, refreshActivityWeather } from '../../api/client.js';
import { useActivityRevision } from '../activity-revision.js';

export type DetailTab = 'telemetry' | 'splits' | 'strides' | 'coach';

export function useActivityDetail(selectedActivityId: string | null, dataRefreshKey: number, onActivityUpdated?: (activity: ActivityUpdate) => void) {
  const revision = useActivityRevision();
  const [activeSubTab, setActiveSubTab] = useState<DetailTab>('telemetry');
  const [detailData, setDetailData] = useState<ActivityDetailResponse | null>(null);
  const [completedDetailRequest, setCompletedDetailRequest] = useState<string | null>(null);
  const [requestError, setDetailError] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState<number>(0);
  const detailRequest = [selectedActivityId, retryCounter, dataRefreshKey, revision].join(':');
  const loadingDetail = !!selectedActivityId && completedDetailRequest !== detailRequest;
  const detailError = completedDetailRequest === detailRequest ? requestError : null;
  const [isRefreshingWeather, setIsRefreshingWeather] = useState<boolean>(false);

  const handleRefreshWeather = async () => {
    if (!selectedActivityId) return;
    const activityId = selectedActivityId;
    setIsRefreshingWeather(true);
    try {
      const data = await refreshActivityWeather(activityId);
      setDetailData(prev => prev?.activity.id === activityId ? {
        ...prev,
        activity: { ...prev.activity, ...data.activity },
        coachSummary: data.coachSummary || prev.coachSummary
      } : prev);
    } catch (err) {
      console.error('Failed to refresh microclimate weather:', err);
    } finally {
      setIsRefreshingWeather(false);
    }
  };

  useEffect(() => {
    if (!selectedActivityId) return;

    const controller = new AbortController();
    getActivityDetail(selectedActivityId, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        setDetailData(data);
        if (!data.intervals || data.intervals.length === 0) {
          setActiveSubTab(prev => (prev === 'strides' ? 'telemetry' : prev));
        }
        if (!data.splits || data.splits.length === 0) {
          setActiveSubTab(prev => (prev === 'splits' ? 'telemetry' : prev));
        }
        if (data.coachSummary != null && onActivityUpdated) {
          onActivityUpdated({
            id: selectedActivityId,
            verdict: data.coachSummary.verdict,
            run_type: data.activity?.run_type,
            name: data.activity?.name,
            tags: data.activity?.tags
          });
        }
        setDetailError(null);
        setCompletedDetailRequest(detailRequest);
      })
      .catch(err => {
        if (controller.signal.aborted || err.name === 'AbortError') return;
        console.error('Failed to load activity detail:', err);
        setDetailError(err.message || 'Failed to load activity telemetry profile');
        setCompletedDetailRequest(detailRequest);
      });

    return () => controller.abort();
  }, [selectedActivityId, detailRequest, onActivityUpdated]);

  return { detailData, setDetailData, loadingDetail, detailError, setRetryCounter, isRefreshingWeather, handleRefreshWeather, activeSubTab, setActiveSubTab };
}
