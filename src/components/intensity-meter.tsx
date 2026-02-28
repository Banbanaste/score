'use client';

interface IntensityMeterProps {
  intensity: number;
}

export default function IntensityMeter({ intensity }: IntensityMeterProps) {
  const pct = Math.round(intensity * 100);
  // Interpolate from blue (calm) to red (intense)
  const hue = Math.round((1 - intensity) * 220); // 220=blue, 0=red

  return (
    <div className="space-y-1">
      <div className="text-xs text-gray-400">Intensity: {pct}%</div>
      <div className="w-full h-3 bg-gray-800 rounded overflow-hidden">
        <div
          className="h-full transition-all duration-500 rounded"
          style={{
            width: `${pct}%`,
            backgroundColor: `hsl(${hue}, 80%, 50%)`,
          }}
        />
      </div>
    </div>
  );
}
