/**
 * Brand marks rendered with CSS masks so a single monochrome asset takes the
 * current text colour in both themes.
 *
 *   <Logo className="h-8 text-foreground" />     full lock-up (1774 × 913)
 *   <LogoMark className="size-8 text-foreground" />  square tree mark
 *   <LogoEmblem className="w-12 text-foreground" />  tree and gate, flat bottom
 *                                                    (792 × 563), the collapsed rail
 */

import emblemUrl from "@/assets/brand/emblem.svg";
import logoUrl from "@/assets/brand/logo.svg";
import markUrl from "@/assets/brand/mark.svg";
import { PARK_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

interface MaskedProps extends React.HTMLAttributes<HTMLSpanElement> {
  url: string;
  ratio: string;
  label?: string;
}

function Masked({ url, ratio, label = PARK_NAME, className, style, ...props }: MaskedProps) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        aspectRatio: ratio,
        WebkitMaskImage: `url(${url})`,
        maskImage: `url(${url})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        ...style,
      }}
      {...props}
    />
  );
}

export function Logo({ className, ...props }: Omit<MaskedProps, "url" | "ratio">) {
  return <Masked url={logoUrl} ratio="1774 / 913" className={className} {...props} />;
}

export function LogoMark({ className, ...props }: Omit<MaskedProps, "url" | "ratio">) {
  return <Masked url={markUrl} ratio="1 / 1" className={className} {...props} />;
}

/** The tree over its gate and fence, cut from the lock-up (`emblem.svg`): no ground or grass, the fence 5 % inside the canopy, the base 1.25× tall. */
export function LogoEmblem({ className, ...props }: Omit<MaskedProps, "url" | "ratio">) {
  return <Masked url={emblemUrl} ratio="792 / 563" className={className} {...props} />;
}
