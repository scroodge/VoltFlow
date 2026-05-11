import type { SVGProps } from "react";

export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="VoltFlow"
      {...props}
    >
      <rect width="64" height="64" rx="18" fill="#12151C" />
      <path
        d="M12 15 29.2 49h5.6L52 15h-8.6L32 38.2 20.6 15H12Z"
        fill="url(#voltflow-mark-gradient)"
      />
      <path
        d="M35.5 13 22.8 32.6h8.6L28.7 51 42.2 28.4h-8.6L35.5 13Z"
        fill="#12151C"
      />
      <path
        d="M35.1 16.5 25.6 31h7.7l-2.1 13.8 8.4-14.5h-7.3l2.8-13.8Z"
        fill="url(#voltflow-bolt-inner-gradient)"
      />
      <defs>
        <linearGradient
          id="voltflow-mark-gradient"
          x1="12"
          x2="52"
          y1="15"
          y2="49"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#00E676" />
          <stop offset="1" stopColor="#00D1FF" />
        </linearGradient>
        <linearGradient
          id="voltflow-bolt-inner-gradient"
          x1="25.6"
          x2="39.6"
          y1="16.5"
          y2="44.8"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#F8FAFC" />
          <stop offset="1" stopColor="#00D1FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}
