import { useState, useEffect } from 'react';
import type { ThresholdsResponse, VolumeData } from '../../types/api.js';
import { getProfile, getProgressHistory, getThresholds, getVolume } from '../../api/client.js';
import { useActivityRevision } from '../activity-revision.js';

export function useStatsController() {
  const revision = useActivityRevision();
  const [data, setData] = useState<ThresholdsResponse | null>(null);
  const [completedRequest, setCompletedRequest] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const request = [retryCount, revision].join(':');
  const loading = completedRequest !== request;
  const [volumePeriod, setVolumePeriod] = useState<'week' | 'month' | 'year' | 'all'>('month');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [availableMonths, setAvailableMonths] = useState<{ period: string; label: string }[]>([]);
  const [volumeData, setVolumeData] = useState<VolumeData | null>(null);
  const [completedVolumeRequest, setCompletedVolumeRequest] = useState<string | null>(null);
  const [volumeLoadError, setVolumeLoadError] = useState(false);
  const [volumeRetryCount, setVolumeRetryCount] = useState(0);
  const volumeRequest = [volumePeriod, selectedMonth, volumeRetryCount, revision].join(':');
  const loadingVolume = completedVolumeRequest !== volumeRequest;
  const [demographics, setDemographics] = useState<{ age: number | null; gender: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    getThresholds()
      .then(resData => {
        if (cancelled) return;
        setLoadError(false);
        setData(resData);
        setCompletedRequest(request);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load stats:', err);
        setLoadError(true);
        setCompletedRequest(request);
      });

    getProgressHistory()
      .then(hist => {
        if (!cancelled && hist.months) {
          setAvailableMonths(hist.months);
        }
      })
      .catch(() => {});

    getProfile()
      .then(response => { if (!cancelled) setDemographics({ age: response.profile?.age ?? null, gender: response.profile?.gender ?? null }); })
      .catch(() => { if (!cancelled) setDemographics(null); });
    return () => { cancelled = true; };
  }, [request]);

  useEffect(() => {
    let cancelled = false;
    getVolume({
      period: volumePeriod,
      ...(volumePeriod === 'month' && selectedMonth !== 'all' ? { month: selectedMonth } : {})
    })
      .then(vData => {
        if (cancelled) return;
        setVolumeLoadError(false);
        setVolumeData(vData);
        setCompletedVolumeRequest(volumeRequest);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load volume stats:', err);
        setVolumeLoadError(true);
        setCompletedVolumeRequest(volumeRequest);
      });
    return () => { cancelled = true; };
  }, [volumePeriod, selectedMonth, volumeRequest]);

  return { data, loading, loadError, setRetryCount, volumePeriod, setVolumePeriod, selectedMonth, setSelectedMonth,
    isMonthPickerOpen, setIsMonthPickerOpen, availableMonths, volumeData, volumeLoadError, setVolumeRetryCount, loadingVolume, demographics };
}
