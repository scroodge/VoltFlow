import type { SVGProps } from "react";

import { LogoMark } from "./LogoMark";

export function AppIcon(props: SVGProps<SVGSVGElement>) {
  return <LogoMark {...props} />;
}
