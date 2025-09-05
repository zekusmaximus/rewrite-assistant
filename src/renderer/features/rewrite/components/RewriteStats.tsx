import React from 'react';
import { useManuscriptStore } from '../../../stores/manuscriptStore';
import useRewriteStore from '../stores/rewriteStore';
import PerformanceOptimizer from '../../../../services/rewrite/PerformanceOptimizer';

const performanceOptimizer = new PerformanceOptimizer();

const RewriteStats: React.FC = () => {
  const manuscript = useManuscriptStore(state => state.manuscript);
  const { sceneRewrites, batchProgress } = useRewriteStore();

  const stats = React.useMemo(() => {
    if (!manuscript) return null;

    const totalScenes = manuscript.scenes.length;
    const movedScenes = manuscript.scenes.filter(s => s.hasBeenMoved).length;
    const rewrittenScenes = Array.from(sceneRewrites.keys()).length;
    const appliedRewrites = manuscript.scenes.filter(s => s.rewriteStatus === 'approved').length;

    // Calculate issue resolution rate
    let totalIssues = 0;
    let resolvedIssues = 0;

    manuscript.scenes.forEach(scene => {
      const issues = scene.continuityAnalysis?.issues || [];
      totalIssues += issues.length;

      if (scene.rewriteStatus === 'approved') {
        resolvedIssues += issues.length;
      }
    });

    const resolutionRate = totalIssues > 0 ? (resolvedIssues / totalIssues) * 100 : 0;

    return {
      totalScenes,
      movedScenes,
      rewrittenScenes,
      appliedRewrites,
      totalIssues,
      resolvedIssues,
      resolutionRate
    };
  }, [manuscript, sceneRewrites]);

  const metrics = performanceOptimizer.getMetrics();
  const suggestions = performanceOptimizer.getSuggestions();

  if (!stats) return null;

  return (
    <div className="p-4 space-y-4">
      {/* Main Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Scenes Moved"
          value={stats.movedScenes}
          total={stats.totalScenes}
          color="amber"
        />
        <StatCard
          label="Rewrites Ready"
          value={stats.rewrittenScenes}
          total={stats.movedScenes}
          color="blue"
        />
        <StatCard
          label="Applied"
          value={stats.appliedRewrites}
          total={stats.rewrittenScenes}
          color="green"
        />
        <StatCard
          label="Issues Fixed"
          value={`${stats.resolutionRate.toFixed(0)}%`}
          subtitle={`${stats.resolvedIssues}/${stats.totalIssues}`}
          color="purple"
        />
      </div>

      {/* Performance Metrics */}
      {metrics.lastUpdated > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Performance
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-600">Avg. Rewrite Time:</span>
              <span className="ml-2 font-medium">
                {(metrics.avgRewriteTime / 1000).toFixed(1)}s
              </span>
            </div>
            <div>
              <span className="text-gray-600">Cache Hit Rate:</span>
              <span className="ml-2 font-medium">
                {(metrics.cacheHitRate * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          {suggestions.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="text-xs text-gray-600">Suggestions:</div>
              <ul className="mt-1 space-y-1">
                {suggestions.map((suggestion, index) => (
                  <li key={index} className="text-xs text-amber-600">
                    • {suggestion}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Helper component
const StatCard: React.FC<{
  label: string;
  value: string | number;
  total?: number;
  subtitle?: string;
  color: 'amber' | 'blue' | 'green' | 'purple';
}> = ({ label, value, total, subtitle, color }) => {
  const colorClasses = {
    amber: 'bg-amber-50 text-amber-600',
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600'
  };

  return (
    <div className={`p-4 rounded-lg ${colorClasses[color]}`}>
      <div className="text-2xl font-bold">
        {value}
        {total !== undefined && (
          <span className="text-sm font-normal opacity-75">/{total}</span>
        )}
      </div>
      <div className="text-sm mt-1">{label}</div>
      {subtitle && (
        <div className="text-xs opacity-75 mt-1">{subtitle}</div>
      )}
    </div>
  );
};

export default RewriteStats;