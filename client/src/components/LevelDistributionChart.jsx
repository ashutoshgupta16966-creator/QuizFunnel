import { useState, useMemo } from 'react';

const LEVEL_COLORS = [
  { stroke: '#4361EE', fill: 'rgba(67, 97, 238, 0.15)', label: 'Level 1', name: 'Foundation' },
  { stroke: '#7209B7', fill: 'rgba(114, 9, 183, 0.15)', label: 'Level 2', name: 'Intermediate' },
  { stroke: '#F72585', fill: 'rgba(247, 37, 133, 0.15)', label: 'Level 3', name: 'Advanced' },
  { stroke: '#4CC9F0', fill: 'rgba(76, 201, 240, 0.15)', label: 'Level 4', name: 'Final Round' },
  { stroke: '#10B981', fill: 'rgba(16, 185, 129, 0.15)', label: 'Level 5', name: 'Master' },
];

export default function LevelDistributionChart({ participants = [] }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);

  const totalStudents = participants.length;

  const levelData = useMemo(() => {
    if (totalStudents === 0) return [];

    // Find all distinct levels present, minimum 1 to 4
    let maxLevel = 4;
    participants.forEach((p) => {
      const lvl = parseInt(p.level, 10);
      if (!isNaN(lvl) && lvl > maxLevel) maxLevel = lvl;
    });

    const counts = {};
    for (let i = 1; i <= maxLevel; i++) {
      counts[i] = 0;
    }

    participants.forEach((p) => {
      const lvl = parseInt(p.level, 10) || 1;
      counts[lvl] = (counts[lvl] || 0) + 1;
    });

    return Object.entries(counts).map(([lvlStr, count], idx) => {
      const lvl = parseInt(lvlStr, 10);
      const colorScheme = LEVEL_COLORS[(lvl - 1) % LEVEL_COLORS.length];
      const percentage = totalStudents > 0 ? ((count / totalStudents) * 100).toFixed(1) : 0;
      return {
        level: lvl,
        count,
        percentage: Number(percentage),
        color: colorScheme.stroke,
        fillBg: colorScheme.fill,
        label: colorScheme.label,
        name: colorScheme.name,
      };
    });
  }, [participants, totalStudents]);

  // SVG Geometry for donut pie slices
  // Radius = 68, Stroke = 24, Center = 100, 100
  const radius = 68;
  const circumference = 2 * Math.PI * radius;

  // Compute stroke-dasharray & stroke-dashoffset for each slice
  let accumulatedOffset = 0;
  const slices = levelData.map((d, idx) => {
    const sliceRatio = totalStudents > 0 ? d.count / totalStudents : 0;
    const strokeDash = sliceRatio * circumference;
    const currentOffset = accumulatedOffset;
    accumulatedOffset += strokeDash;

    return {
      ...d,
      strokeDasharray: `${strokeDash} ${circumference - strokeDash}`,
      strokeDashoffset: -currentOffset,
    };
  });

  return (
    <div className="level-chart-container">
      <div className="level-chart-header">
        <div className="level-chart-title-wrap">
          <span className="level-chart-icon" aria-hidden>🥧</span>
          <div>
            <h3 className="level-chart-title">Student Distribution by Level</h3>
            <p className="level-chart-subtitle">Real-time candidate progression through quiz rounds</p>
          </div>
        </div>
        <div className="level-chart-total-pill">
          <span className="total-dot" />
          <span>Total: <strong>{totalStudents}</strong> Student{totalStudents !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {totalStudents === 0 ? (
        <div className="level-chart-empty">
          <span className="empty-icon">👥</span>
          <p className="empty-text">No students have joined this room yet.</p>
          <span className="empty-hint">Distribution will update live when students connect with your room code.</span>
        </div>
      ) : (
        <div className="level-chart-body">
          {/* Donut SVG */}
          <div className="donut-wrapper">
            <svg
              className="donut-svg"
              viewBox="0 0 200 200"
              width="180"
              height="180"
              aria-label="Student level distribution pie chart"
            >
              <defs>
                <filter id="pie-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.25" />
                </filter>
              </defs>

              {/* Background ring */}
              <circle
                cx="100"
                cy="100"
                r={radius}
                fill="none"
                stroke="var(--color-border, rgba(255, 255, 255, 0.1))"
                strokeWidth="24"
              />

              {/* Pie Slices */}
              <g transform="rotate(-90 100 100)">
                {slices.map((slice, idx) => {
                  if (slice.count === 0) return null;
                  const isHovered = hoveredIdx === idx;
                  return (
                    <circle
                      key={slice.level}
                      cx="100"
                      cy="100"
                      r={radius}
                      fill="none"
                      stroke={slice.color}
                      strokeWidth={isHovered ? 28 : 24}
                      strokeDasharray={slice.strokeDasharray}
                      strokeDashoffset={slice.strokeDashoffset}
                      strokeLinecap="round"
                      filter={isHovered ? 'url(#pie-glow)' : 'none'}
                      style={{
                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        cursor: 'pointer',
                        opacity: hoveredIdx !== null && !isHovered ? 0.45 : 1,
                      }}
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                    />
                  );
                })}
              </g>

              {/* Center counter */}
              <text
                x="100"
                y="94"
                textAnchor="middle"
                className="donut-center-count"
                fill="currentColor"
              >
                {hoveredIdx !== null ? slices[hoveredIdx].count : totalStudents}
              </text>
              <text
                x="100"
                y="114"
                textAnchor="middle"
                className="donut-center-label"
                fill="currentColor"
              >
                {hoveredIdx !== null
                  ? `${slices[hoveredIdx].label} (${slices[hoveredIdx].percentage}%)`
                  : 'Total Students'}
              </text>
            </svg>
          </div>

          {/* Legend Details */}
          <div className="chart-legend-grid">
            {slices.map((slice, idx) => {
              const isHovered = hoveredIdx === idx;
              return (
                <div
                  key={slice.level}
                  className={`legend-item-card ${isHovered ? 'is-active' : ''}`}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  style={{
                    borderColor: isHovered ? slice.color : 'transparent',
                  }}
                >
                  <div className="legend-item-top">
                    <div className="legend-badge-group">
                      <span className="legend-color-dot" style={{ backgroundColor: slice.color }} />
                      <strong className="legend-level-name">{slice.label}</strong>
                      <span className="legend-sub-name">({slice.name})</span>
                    </div>
                    <span className="legend-item-count">
                      <strong>{slice.count}</strong>
                      <span className="legend-pct">({slice.percentage}%)</span>
                    </span>
                  </div>

                  {/* Level Progression Progress Bar */}
                  <div className="legend-mini-bar">
                    <div
                      className="legend-mini-fill"
                      style={{
                        width: `${slice.percentage}%`,
                        backgroundColor: slice.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
