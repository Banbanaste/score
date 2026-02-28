'use client';

import { getEmotionForMorale } from '@/components/crowd-emojis';

const ROWS = 11;
const INNER_RADIUS_PX = 200;
const OUTER_RADIUS_PX = 380;

/** Slots per semicircle per row – enough to fill the arc with no visible gaps (~6° apart) */
function slotsPerArcForRow(_row: number): number {
  return 32;
}

/** Radii for each row (inner to outer) */
function rowRadii(): number[] {
  return Array.from(
    { length: ROWS },
    (_, row) => INNER_RADIUS_PX + (row / (ROWS - 1)) * (OUTER_RADIUS_PX - INNER_RADIUS_PX)
  );
}

/** Angles in degrees for left semicircle (Team Blue): 90° to 270°, dense fill */
function leftArcAngles(slots: number): number[] {
  return Array.from({ length: slots }, (_, i) => 90 + (i / Math.max(1, slots - 1)) * 180);
}

/** Angles in degrees for right semicircle (Team Red): -90° to 90°, dense fill */
function rightArcAngles(slots: number): number[] {
  return Array.from({ length: slots }, (_, i) => -90 + (i / Math.max(1, slots - 1)) * 180);
}

function positionOnCircle(angleDeg: number, radiusPx: number) {
  const rad = (angleDeg * Math.PI) / 180;
  const x = radiusPx * Math.cos(rad);
  const y = radiusPx * Math.sin(rad);
  return { x, y };
}

interface DonutCrowdProps {
  children: React.ReactNode;
  moraleX: number;
  moraleO: number;
}

export default function DonutCrowd({ children, moraleX, moraleO }: DonutCrowdProps) {
  const blue = getEmotionForMorale(moraleX);
  const red = getEmotionForMorale(moraleO);
  const radii = rowRadii();

  const sizePx = OUTER_RADIUS_PX * 2 + 80;

  return (
    <div
      className="relative inline-flex items-center justify-center flex-shrink-0 rounded-full overflow-hidden"
      style={{ width: sizePx, height: sizePx, minWidth: sizePx, minHeight: sizePx }}
    >
      {/* Background underlay: blue left, red right */}
      <div className="absolute inset-0 flex pointer-events-none" aria-hidden>
        <div className="flex-1 bg-blue-900/50" />
        <div className="flex-1 bg-red-900/50" />
      </div>

      {/* Dense donut ring – filled arcs, no spokes (pointer-events-none so board stays clickable) */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        {/* Team Blue – left half: dense semicircle per row */}
        {radii.map((radius, row) => {
          const slots = slotsPerArcForRow(row);
          const angles = leftArcAngles(slots);
          return angles.map((angle, i) => {
            const { x, y } = positionOnCircle(angle, radius);
            const slotIndex = row * slots + i;
            const isOuter = row >= ROWS - 4;
            return (
              <span
                key={`blue-${row}-${i}`}
                className={`absolute flex items-center justify-center ${
                  isOuter ? 'w-10 h-10 text-xl sm:w-12 sm:h-12 sm:text-2xl' : 'w-12 h-12 text-2xl sm:w-14 sm:h-14 sm:text-3xl'
                }`}
                style={{
                  left: '50%',
                  top: '50%',
                  transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                }}
              >
                {blue.emojis[slotIndex % blue.emojis.length]}
              </span>
            );
          });
        })}
        {/* Team Red – right half: dense semicircle per row */}
        {radii.map((radius, row) => {
          const slots = slotsPerArcForRow(row);
          const angles = rightArcAngles(slots);
          return angles.map((angle, i) => {
            const { x, y } = positionOnCircle(angle, radius);
            const slotIndex = row * slots + i;
            const isOuter = row >= ROWS - 4;
            return (
              <span
                key={`red-${row}-${i}`}
                className={`absolute flex items-center justify-center ${
                  isOuter ? 'w-10 h-10 text-xl sm:w-12 sm:h-12 sm:text-2xl' : 'w-12 h-12 text-2xl sm:w-14 sm:h-14 sm:text-3xl'
                }`}
                style={{
                  left: '50%',
                  top: '50%',
                  transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                }}
              >
                {red.emojis[slotIndex % red.emojis.length]}
              </span>
            );
          });
        })}
      </div>

      {/* Board in center (stays interactive) */}
      <div className="relative z-10 pointer-events-auto">{children}</div>
    </div>
  );
}
