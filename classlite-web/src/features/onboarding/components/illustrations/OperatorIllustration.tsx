/**
 * OperatorIllustration — Story 2-3a Task 6.2.
 *
 * `aria-hidden="true"` (Sally-I1 fold) — decorative-only. The persona card
 * label already carries the semantic content. Screen readers should not
 * announce "YOU"/"STUDENTS"/"CENTER 3 TEACHERS" text nodes from the SVG.
 */
export function OperatorIllustration() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 240 120"
      className="h-24 w-full text-amber-600"
    >
      <circle cx="120" cy="30" r="14" fill="currentColor" opacity="0.15" />
      <circle cx="120" cy="30" r="10" fill="currentColor" />
      <text
        x="120"
        y="34"
        textAnchor="middle"
        fill="white"
        fontSize="8"
        fontWeight="700"
      >
        YOU
      </text>
      <line x1="120" y1="44" x2="60" y2="90" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <line x1="120" y1="44" x2="120" y2="90" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <line x1="120" y1="44" x2="180" y2="90" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <rect x="45" y="90" width="30" height="18" rx="4" fill="currentColor" opacity="0.85" />
      <rect x="105" y="90" width="30" height="18" rx="4" fill="currentColor" opacity="0.85" />
      <rect x="165" y="90" width="30" height="18" rx="4" fill="currentColor" opacity="0.85" />
      <text x="60" y="102" textAnchor="middle" fill="white" fontSize="6">T1</text>
      <text x="120" y="102" textAnchor="middle" fill="white" fontSize="6">T2</text>
      <text x="180" y="102" textAnchor="middle" fill="white" fontSize="6">T3</text>
    </svg>
  )
}
