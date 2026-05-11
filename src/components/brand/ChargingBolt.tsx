import type { SVGProps } from "react";

export function ChargingBolt(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="Charging bolt"
      {...props}
    >
      <path
        d="M27.5 3 9 27.6h13.3L19.8 45 39 19.6H25.7L27.5 3Z"
        fill="url(#voltflow-bolt-gradient)"
      />
      <defs>
        <linearGradient
          id="voltflow-bolt-gradient"
          x1="9"
          x2="39"
          y1="3"
          y2="45"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#00E676" />
          <stop offset="1" stopColor="#00D1FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}
