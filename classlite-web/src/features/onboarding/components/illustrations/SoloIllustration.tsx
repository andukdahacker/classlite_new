/**
 * SoloIllustration — Story 2-3a Task 6.2. `aria-hidden` decorative-only.
 */
export function SoloIllustration() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 240 120"
      className="h-24 w-full text-blue-800"
    >
      <circle cx="80" cy="60" r="18" fill="currentColor" />
      <text x="80" y="64" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
        YOU
      </text>
      <line
        x1="100"
        y1="60"
        x2="140"
        y2="60"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.6"
      />
      <circle cx="160" cy="50" r="7" fill="currentColor" opacity="0.85" />
      <circle cx="160" cy="70" r="7" fill="currentColor" opacity="0.85" />
      <text x="160" y="54" textAnchor="middle" fill="white" fontSize="5">S</text>
      <text x="160" y="74" textAnchor="middle" fill="white" fontSize="5">S</text>
    </svg>
  )
}
