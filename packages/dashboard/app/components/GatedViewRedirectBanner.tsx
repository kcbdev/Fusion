import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import "./GatedViewRedirectBanner.css";

interface GatedViewRedirectBannerProps {
  /** Human-readable name of the gated view the user tried to reach. */
  viewLabel: string;
  /** Switches the app to advanced mode (persists the global setting). */
  onSwitchToAdvanced: () => void;
}

/**
 * Non-dismissible inline banner shown at the board (the redirect destination)
 * when the user deep-links to an advanced-only view in simple mode (U11, R14).
 *
 * It names the gated view and offers a single "Switch to advanced mode" action.
 * Intentionally NOT a modal or toast: a dismissible surface could discard the
 * user's intent before they act on it.
 */
export function GatedViewRedirectBanner({ viewLabel, onSwitchToAdvanced }: GatedViewRedirectBannerProps) {
  const { t } = useTranslation("app");

  return (
    <div
      className="gated-view-redirect-banner"
      role="status"
      aria-live="polite"
      data-testid="gated-view-redirect-banner"
    >
      <div className="gated-view-redirect-banner__content">
        <Lock size={16} aria-hidden="true" className="gated-view-redirect-banner__icon" />
        <span>
          {t(
            "uiMode.gatedRedirect",
            "“{{view}}” is an advanced-mode feature. You’ve been returned to the board.",
            { view: viewLabel },
          )}
        </span>
      </div>
      <button
        type="button"
        className="gated-view-redirect-banner__action"
        onClick={onSwitchToAdvanced}
        data-testid="gated-view-redirect-switch"
      >
        {t("uiMode.switchToAdvanced", "Switch to advanced mode")}
      </button>
    </div>
  );
}
