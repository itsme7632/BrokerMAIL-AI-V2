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
      />
    </span>
  );
}
