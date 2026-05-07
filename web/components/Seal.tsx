export function Seal({ size = 64 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="wax" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="#d8243a" />
          <stop offset="60%" stopColor="#b91528" />
          <stop offset="100%" stopColor="#7a0c1c" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="28" fill="url(#wax)" />
      <circle cx="32" cy="32" r="24" fill="none" stroke="#f3ede0" strokeOpacity="0.45" strokeWidth="1" />
      <circle cx="32" cy="32" r="20" fill="none" stroke="#f3ede0" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 3" />
      <text
        x="32"
        y="38"
        textAnchor="middle"
        fontFamily="Fraunces, Georgia, serif"
        fontWeight="700"
        fontStyle="italic"
        fontSize="22"
        fill="#f3ede0"
      >
        R
      </text>
    </svg>
  );
}
