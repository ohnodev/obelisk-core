export default function RobotMaskIcon({ size = 64, color = "#2ecc71" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer helmet shape */}
      <path
        d="M8 24C8 14 18 6 32 6C46 6 56 14 56 24V38C56 48 46 58 32 58C18 58 8 48 8 38V24Z"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      
      {/* Forehead ridge / visor line */}
      <path
        d="M12 22C12 22 20 18 32 18C44 18 52 22 52 22"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
      
      {/* Left eye - angular villain style */}
      <path
        d="M16 28L24 26L28 32L24 38L16 36L14 32L16 28Z"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="21" cy="32" r="3" fill={color} opacity="0.8" />
      
      {/* Right eye - angular villain style */}
      <path
        d="M48 28L40 26L36 32L40 38L48 36L50 32L48 28Z"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="43" cy="32" r="3" fill={color} opacity="0.8" />
      
      {/* Nose bridge / center detail */}
      <path
        d="M32 28V40"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
      
      {/* Mouth grille - menacing */}
      <path
        d="M22 46H42"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M24 50H40"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.7"
      />
      
      {/* Jaw lines */}
      <path
        d="M14 42C14 42 18 48 32 48C46 48 50 42 50 42"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.5"
      />
      
      {/* Antenna */}
      <circle cx="32" cy="6" r="3" stroke={color} strokeWidth="2" fill="none" />
      <line x1="32" y1="3" x2="32" y2="0" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
