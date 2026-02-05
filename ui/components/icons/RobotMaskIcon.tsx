export default function RobotMaskIcon({ size = 64, color = "#2ecc71" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Minimal mask outline */}
      <path
        d="M12 20C12 12 20 6 32 6C44 6 52 12 52 20V40C52 50 44 58 32 58C20 58 12 50 12 40V20Z"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      
      {/* Left eye - sharp angular */}
      <path
        d="M17 28L26 26L28 32L26 38L17 36Z"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="23" cy="32" r="2.5" fill={color} />
      
      {/* Right eye - sharp angular */}
      <path
        d="M47 28L38 26L36 32L38 38L47 36Z"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="41" cy="32" r="2.5" fill={color} />
      
      {/* Mouth vent */}
      <path
        d="M24 48H40"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      
      {/* Antenna dot */}
      <circle cx="32" cy="6" r="2.5" fill={color} />
    </svg>
  );
}
