/**
 * FounderIllustration — Story 2-3a Task 6.2. `aria-hidden` decorative-only.
 */
export function FounderIllustration() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 240 120"
      className="h-24 w-full text-green-700"
    >
      <rect
        x="40"
        y="30"
        width="160"
        height="60"
        rx="12"
        fill="currentColor"
        opacity="0.1"
      />
      <circle cx="80" cy="60" r="12" fill="currentColor" />
      <text x="80" y="64" textAnchor="middle" fill="white" fontSize="7" fontWeight="700">
        YOU
      </text>
      <circle cx="130" cy="60" r="10" fill="currentColor" opacity="0.85" />
      <text x="130" y="63" textAnchor="middle" fill="white" fontSize="6">T</text>
      <circle cx="165" cy="60" r="8" fill="currentColor" opacity="0.6" />
      <text x="165" y="63" textAnchor="middle" fill="white" fontSize="5">S</text>
    </svg>
  )
}
