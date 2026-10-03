import { useBrowseSelection } from '../features/browse/useBrowseSelection.js';
import { useActivityDetail } from '../features/browse/useActivityDetail.js';
import React, { useMemo } from 'react';
import type { ActivityInterval } from '../types/api.js';
import {
  HeartPulse,
  Plus,
  RefreshCw,
  AlertTriangle,
  Zap,
  Compass
} from 'lucide-react';
import { CanvasRunChart } from './CanvasRunChart';
import { KmSplitsVisualizer } from './KmSplitsVisualizer.js';
import { formatPace as formatPaceUtil } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';
import { BrowseSidebar } from './browse/BrowseSidebar.js';
import { ActivityDetailHeader } from './browse/ActivityDetailHeader.js';
import { CoachScoreCard } from './browse/CoachScoreCard.js';
import { IntervalsTable } from './browse/IntervalsTable.js';


export { getDisplayTitle, doesActivityMatchTag } from '../features/browse/selectors.js';
export type { ActivitySummary, BrowseViewProps, DisplayTitleInput, DisplayTitleFn } from '../features/browse/selectors.js';
import { getDisplayTitle } from '../features/browse/selectors.js';
import type { BrowseViewProps } from '../features/browse/selectors.js';

export const BrowseView: React.FC<BrowseViewProps> = ({
  activities = [],
  selectedActivityId,
  dataRefreshKey = 0,
  onSelectActivity,
  onOpenUpload,
  onActivityUpdated,
  theme = 'dark',
  readOnly = false
}) => {
  const { t, language, format } = useTranslation();
  const { safeActivities, selectedMonth, setSelectedMonth, selectedDate, setSelectedDate, showCalendar, setShowCalendar,
    calendarViewYm, setCalendarViewYm, selectedTagFilter, setSelectedTagFilter, mobileSubTab, setMobileSubTab,
    showTagMenu, setShowTagMenu, tagMenuRef, tagCounts, availableYears, activeDatesMap, filteredActivities, groupedActivities } =
    useBrowseSelection(activities, selectedActivityId, onSelectActivity);
  const { detailData, setDetailData, loadingDetail, detailError, setRetryCounter, isRefreshingWeather, handleRefreshWeather, activeSubTab, setActiveSubTab } =
    useActivityDetail(selectedActivityId, dataRefreshKey, onActivityUpdated);

  const act = detailData?.activity;

  const intervalsTabVisible = useMemo(() => {
    const list = detailData?.intervals || [];
    if (list.length === 0) return false;
    const runType = detailData?.activity?.run_type;
    if (runType === 'threshold_lt2' || runType === 'intervals_vo2' || runType === 'race') return true;
    return list.some((i: ActivityInterval) => i.type === 'stride');
  }, [detailData]);

  const displayedSubTab = activeSubTab === 'strides' && !intervalsTabVisible ? 'telemetry' : activeSubTab;

  const formatPace = (secKm: number | null) => formatPaceUtil(secKm, false);

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remainingSec = Math.round(sec % 60);
    return `${mins}:${String(remainingSec).padStart(2, '0')}`;
  };

  const getTimeOfDay = (dateStr: string) => {
    const d = new Date(dateStr);
    const hour = d.getHours();
    if (hour >= 5 && hour < 11) return t.browse.timeOfDayMorning;
    if (hour >= 11 && hour < 16) return t.browse.timeOfDayMidday;
    if (hour >= 16 && hour < 19) return t.browse.timeOfDayEvening;
    return t.browse.timeOfDayNight;
  };

  return (
    <div className={`browse-grid ${mobileSubTab === 'detail' ? 'mobile-show-detail' : 'mobile-show-list'}`}>
      {/* Mobile list/detail switcher (< 768px) */}
      <div className="mobile-browse-segmented-control" role="tablist" aria-label={t.browse.viewSwitcherLabel}>
        <button
          type="button"
          className={`mobile-browse-tab-btn ${mobileSubTab === 'list' ? 'active' : ''}`}
          onClick={() => setMobileSubTab('list')}
        >
          {format(t.browse.sessionsCount, { count: filteredActivities.length })}
        </button>
        <button
          type="button"
          className={`mobile-browse-tab-btn ${mobileSubTab === 'detail' ? 'active' : ''}`}
          onClick={() => setMobileSubTab('detail')}
        >
          {t.browse.tabTelemetry}
        </button>
      </div>

      {/* Left Sidebar: Sessions List & Interactive Calendar Picker */}
      <BrowseSidebar
        filteredActivities={filteredActivities}
        groupedActivities={groupedActivities}
        tagCounts={tagCounts}
        selectedTagFilter={selectedTagFilter}
        setSelectedTagFilter={setSelectedTagFilter}
        selectedActivityId={selectedActivityId}
        onSelectActivity={onSelectActivity}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        selectedMonth={selectedMonth}
        setSelectedMonth={setSelectedMonth}
        showCalendar={showCalendar}
        setShowCalendar={setShowCalendar}
        calendarViewYm={calendarViewYm}
        setCalendarViewYm={setCalendarViewYm}
        availableYears={availableYears}
        activeDatesMap={activeDatesMap}
        setMobileSubTab={setMobileSubTab}
        setShowTagMenu={setShowTagMenu}
        onOpenUpload={onOpenUpload}
        readOnly={readOnly}
        getDisplayTitle={getDisplayTitle}
        formatPace={formatPace}
        language={language}
        t={t}
        activitiesCount={safeActivities.length}
      />

      {/* Right Main Panel: Run Details */}
      <main className="detail-panel">
        {safeActivities.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '4rem 2rem',
              background: 'var(--bg-card)',
              borderRadius: 14,
              border: '1px dashed var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              boxShadow: 'var(--card-shadow)'
            }}
          >
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: 16,
                background: 'rgba(6, 182, 212, 0.12)',
                border: '1px solid rgba(6, 182, 212, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <HeartPulse size={30} color="#38bdf8" />
            </div>
            <h3 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
              {t.browse.readyFirstRunTitle}
            </h3>
            <p style={{ maxWidth: 460, color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.55, margin: 0 }}>
              {t.browse.readyFirstRunDesc}
            </p>
            {!readOnly && <button
              onClick={onOpenUpload}
              style={{
                marginTop: '0.5rem',
                padding: '0.7rem 1.4rem',
                fontSize: '0.88rem',
                fontWeight: 700,
                borderRadius: 8,
                background: 'linear-gradient(135deg, #0284c7, #06b6d4)',
                border: 'none',
                color: '#ffffff',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                boxShadow: '0 4px 14px 0 rgba(6, 182, 212, 0.35)'
              }}
            >
              <Plus size={16} />
              <span>{t.browse.importFirstWorkoutBtn}</span>
            </button>}
          </div>
        ) : detailError ? (
          <div
            style={{
              padding: '3rem 2rem',
              background: 'var(--bg-card)',
              borderRadius: 14,
              border: '1px solid rgba(244, 63, 94, 0.3)',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              boxShadow: 'var(--card-shadow)',
              minHeight: 280
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: 'rgba(244, 63, 94, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f43f5e'
              }}
            >
              <AlertTriangle size={24} />
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t.browse.telemetryLoadFailed}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: 420 }}>
              {detailError}
            </div>
            <button
              onClick={() => setRetryCounter(c => c + 1)}
              style={{
                padding: '0.55rem 1.25rem',
                borderRadius: 8,
                background: '#06b6d4',
                color: '#07090e',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem'
              }}
            >
              <RefreshCw size={14} />
              <span>{t.common.retry}</span>
            </button>
          </div>
        ) : loadingDetail || !act ? (
          <div
            className="overview-card loading-skeleton"
            style={{
              height: 350,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.85rem',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid rgba(6,182,212,0.2)', borderTopColor: '#06b6d4', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 500 }}>
              {t.browse.loadingTelemetry}
            </span>
          </div>
        ) : (
          <>
            {/* Mobile Back Button (< 768px) */}
            <div className="mobile-back-to-sessions-bar">
              <button
                type="button"
                className="mobile-back-btn"
                onClick={() => setMobileSubTab('list')}
              >
                ← {t.browse.backToSessions}
              </button>
            </div>

            {/* Overview Header Card */}
            <ActivityDetailHeader
              key={act.id}
              act={act}
              records={detailData.records}
              fitMetadata={detailData.fitMetadata}
              getDisplayTitle={getDisplayTitle}
              formatPace={formatPace}
              formatTime={formatTime}
              getTimeOfDay={getTimeOfDay}
              onActivityUpdated={(updated) => {
                setDetailData(prev => prev ? { ...prev, activity: { ...prev.activity, ...updated } } : prev);
                onActivityUpdated?.(updated);
              }}
              onRefreshWeather={handleRefreshWeather}
              isRefreshingWeather={isRefreshingWeather}
              showTagMenu={showTagMenu}
              setShowTagMenu={setShowTagMenu}
              tagMenuRef={tagMenuRef}
              t={t}
              readOnly={readOnly}
            />

            {/* Sub-Tabs Selector for Main Panel */}
            <div className="detail-subtabs" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
              <button
                id="subtab-telemetry-btn"
                className={`filter-pill-btn ${displayedSubTab === 'telemetry' ? 'active' : ''}`}
                onClick={() => setActiveSubTab('telemetry')}
              >
                {t.browse.tabTelemetry}
              </button>
              {(detailData.splits?.length ?? 0) > 0 && (
                <button
                  id="subtab-splits-btn"
                  className={`filter-pill-btn ${displayedSubTab === 'splits' ? 'active' : ''}`}
                  onClick={() => setActiveSubTab('splits')}
                >
                  {t.browse.tabSplits} ({detailData.splits.length})
                </button>
              )}
              {intervalsTabVisible && (
                <button
                  id="subtab-strides-btn"
                  className={`filter-pill-btn ${displayedSubTab === 'strides' ? 'active' : ''}`}
                  onClick={() => setActiveSubTab('strides')}
                >
                  {t.browse.tabIntervals} ({detailData.intervals.filter(interval => interval.type === 'work' || interval.type === 'stride').length})
                </button>
              )}
              <button
                id="subtab-coach-btn"
                className={`filter-pill-btn ${displayedSubTab === 'coach' ? 'active' : ''}`}
                onClick={() => setActiveSubTab('coach')}
              >
                {t.browse.tabCoach}
              </button>
            </div>

            {/* SUBTAB 1: Telemetry & Chart */}
            {displayedSubTab === 'telemetry' && (
              <>
                <section className="chart-card">
                  <div className="chart-header">
                    <span className="chart-title">{t.browse.telemetryChartTitle}</span>
                  </div>

                  <CanvasRunChart
                    records={detailData.records || []}
                    theme={theme}
                  />
                </section>

                <div className="goal-markers-grid">
                  <div className="goal-card">
                    <div className="goal-card-header">
                      <span className="goal-card-title">{t.browse.aerobicDecoupling}</span>
                      <HeartPulse size={18} color="#06b6d4" />
                    </div>
                    <div className="goal-stat-highlight" style={{ color: (act.aerobic_decoupling_pct ?? 0) < 4.5 ? '#10b981' : '#f59e0b' }}>
                      {act.aerobic_decoupling_pct != null ? `${act.aerobic_decoupling_pct.toFixed(1)}%` : '—'}
                    </div>
                    <p className="goal-stat-desc">
                      {(act.aerobic_decoupling_pct ?? 0) < 4.5
                        ? t.browse.aerobicDecouplingDescSolid
                        : t.browse.aerobicDecouplingDescDrift}
                    </p>
                  </div>

                  <div className="goal-card">
                    <div className="goal-card-header">
                      <span className="goal-card-title">{t.browse.efficiencyFactor}</span>
                      <Zap size={18} color="#10b981" />
                    </div>
                    <div className="goal-stat-highlight" style={{ color: '#10b981' }}>
                      {act.efficiency_factor ? `${act.efficiency_factor.toFixed(2)}` : '—'}
                      <span style={{ fontSize: '0.85rem', color: '#94a3b8', marginLeft: '0.3rem' }}>{t.browse.efficiencyFactorUnits}</span>
                    </div>
                    <p className="goal-stat-desc">
                      {act.meters_per_beat ? `${act.meters_per_beat.toFixed(2)} ${t.browse.metersPerHeartbeatDesc}` : t.browse.efficiencyDefaultDesc}
                    </p>
                  </div>

                  <div className="goal-card">
                    <div className="goal-card-header">
                      <span className="goal-card-title">{t.browse.biomechanicalDynamics}</span>
                      <Compass size={18} color="#8b5cf6" />
                    </div>
                    <div className="goal-stat-highlight" style={{ color: '#8b5cf6', fontSize: '1.4rem' }}>
                      {act.avg_stance_time ? `${Math.round(act.avg_stance_time)} ms` : '—'}
                      <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginLeft: '0.5rem' }}>
                        {t.browse.gctShort} • {act.avg_vertical_oscillation ? `${(act.avg_vertical_oscillation / 10).toFixed(1)} ${t.browse.verticalOscShort}` : ''}
                      </span>
                    </div>
                    <p className="goal-stat-desc">
                      {t.browse.biomechanicalDesc}
                    </p>
                  </div>
                </div>
              </>
            )}

            {/* SUBTAB: KM Splits & Pace Variation (Full Interactive Mode) */}
            {displayedSubTab === 'splits' && (
              <KmSplitsVisualizer
                splits={detailData.splits || []}
                overallAvgPace={act.avg_pace_sec_km}
                compact={false}
              />
            )}

            {/* SUBTAB 2: Strides & Intervals */}
            {displayedSubTab === 'strides' && intervalsTabVisible && (
              <IntervalsTable
                intervals={detailData.intervals || []}
                activityRunType={detailData.activity?.run_type ?? undefined}
                formatPace={formatPace}
                formatTime={formatTime}
              />
            )}

            {/* SUBTAB 3: Session Analysis */}
            {displayedSubTab === 'coach' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {detailData.coachSummary && (
                  <CoachScoreCard
                    coachSummary={detailData.coachSummary}
                    language={language}
                    t={t}
                  />
                )}

              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};
