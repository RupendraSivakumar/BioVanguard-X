import React from 'react';
import type { AlertLevel } from '../types/medbay.ts';

interface SparklineChartProps {
  history: number[];
  yellowThreshold: number;
  redThreshold: number;
  baseline: number;
  status: AlertLevel;
}

export const SparklineChart: React.FC<SparklineChartProps> = ({
  history,
  yellowThreshold,
  redThreshold,
  baseline,
  status,
}) => {
  if (history.length < 2) return null;

  const width = 220;
  const height = 42;
  const pad = 4;

  const allVals = [...history, baseline, yellowThreshold, redThreshold];
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const span = maxVal - minVal || 1;

  const toY = (v: number) =>
    height - pad - ((v - minVal) / span) * (height - pad * 2);

  const points = history
    .map((v, i) => {
      const x = pad + (i / (history.length - 1)) * (width - pad * 2);
      const y = toY(v);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const strokeColor =
    status === 'RED'
      ? '#f43f5e'
      : status === 'YELLOW'
        ? '#f59e0b'
        : '#06b6d4';

  const yellowY = toY(yellowThreshold);
  const redY = toY(redThreshold);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-10 overflow-visible"
      aria-label="Live telemetry trend"
    >
      <line
        x1={pad}
        y1={yellowY}
        x2={width - pad}
        y2={yellowY}
        stroke="#f59e0b"
        strokeOpacity={0.35}
        strokeDasharray="3 3"
        strokeWidth={1}
      />
      <line
        x1={pad}
        y1={redY}
        x2={width - pad}
        y2={redY}
        stroke="#f43f5e"
        strokeOpacity={0.35}
        strokeDasharray="3 3"
        strokeWidth={1}
      />
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
};
