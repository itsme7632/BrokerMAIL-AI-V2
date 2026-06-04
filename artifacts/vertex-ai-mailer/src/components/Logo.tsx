// Known intrinsic dimensions (pixels after trimming)
const LIGHT_AR = 2035 / 773;  // 2.633 — logo-horizontal.png
const DARK_AR  = 1190 / 222;  // 5.360 — logo-horizontal-dark.png (trimmed)

// Tailwind h-N → pixel map
const H_MAP: Record<string, number> = {
  "h-6": 24, "h-7": 28, "h-8": 32, "h-9": 36,
  "h-10": 40, "h-11": 44, "h-12": 48, "h-14": 56, "h-16": 64,
};

/**
 * Given the parent's className (which drives the light logo size),
 * compute the maxWidth that gives the dark logo the same visual area
 * as the light logo at the same height.
 *
 * Both logos at height H:
 *   Light area = H * (H * LIGHT_AR) = H² * LIGHT_AR
 *   Dark at maxWidth W: content fills width W, height = W / DARK_AR
 *   Dark area = W * (W / DARK_AR) = W² / DARK_AR
 *   Equal area → W = H * √(LIGHT_AR * DARK_AR)
 */
function darkMaxWidth(className: string): number {
  for (const [cls, px] of Object.entries(H_MAP)) {
    if (new RegExp(`(?:^|\\s)${cls}(?:\\s|$)`).test(className)) {
      return Math.round(px * Math.sqrt(LIGHT_AR * DARK_AR));
    }
  }
  return 150; // safe fallback for h-10 equivalent
}

interface LogoProps {
  variant?: "horizontal" | "icon";
  className?: string;
}

export function Logo({ variant = "horizontal", className = "" }: LogoProps) {
  if (variant === "icon") {
    return (
      <span className="contents">
        <img
          src="/logo-icon.png"
          alt="BrokerMail AI"
          className={`dark:hidden ${className}`}
        />
        <img
          src="/logo-icon-dark.png"
          alt="BrokerMail AI"
          className={`hidden dark:block ${className}`}
        />
      </span>
    );
  }

  // Apply a computed maxWidth to the dark logo so it occupies the same
  // visual area as the light logo. The inline style overrides any max-w-*
  // Tailwind class the parent might include.
  const darkMW = darkMaxWidth(className);

  return (
    <span className="contents">
      <img
        src="/logo-horizontal.png"
        alt="BrokerMail AI"
        className={`dark:hidden ${className}`}
      />
      <img
        src="/logo-horizontal-dark.png"
        alt="BrokerMail AI"
        className={`hidden dark:block ${className}`}
        style={{ maxWidth: `${darkMW}px` }}
      />
    </span>
  );
}
