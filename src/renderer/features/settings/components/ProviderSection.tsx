import React from 'react';

interface ProviderSectionProps {
  title: string;
  enabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  status?: React.ReactNode;
  children: React.ReactNode;
}

const ProviderSection: React.FC<ProviderSectionProps> = ({
  title,
  enabled,
  onToggleEnabled,
  status,
  children,
}) => {
  return (
    <section className="bg-gray-50 border border-gray-200 rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          {status ? (
            <div className="text-xs">{status}</div>
          ) : null}
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
            aria-label={`Enable ${title}`}
          />
          <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
            <div className={`absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : ''}`}></div>
          </div>
          <span className="ml-3 text-sm text-gray-700">Enabled</span>
        </label>
      </div>

      <div className={`${!enabled ? 'opacity-60 pointer-events-none' : ''}`}>
        {children}
      </div>
    </section>
  );
};

export default ProviderSection;