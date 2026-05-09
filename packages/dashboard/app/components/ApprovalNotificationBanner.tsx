import { AlertTriangle, Inbox, X } from "lucide-react";
import "./ApprovalNotificationBanner.css";

interface ApprovalNotificationBannerProps {
  pendingCount: number;
  onOpenMailbox: () => void;
  onDismiss: () => void;
}

export function ApprovalNotificationBanner({
  pendingCount,
  onOpenMailbox,
  onDismiss,
}: ApprovalNotificationBannerProps) {
  const noun = pendingCount === 1 ? "request" : "requests";

  return (
    <section className="approval-notification-banner" role="region" aria-live="polite" aria-label="Approval requests">
      <div className="approval-notification-banner__content">
        <div className="approval-notification-banner__headline">
          <span className="status-dot" aria-hidden="true" />
          <AlertTriangle aria-hidden="true" />
          <span>{pendingCount} approval {noun} need your attention</span>
        </div>
        <div className="approval-notification-banner__actions">
          <button type="button" className="btn btn-sm" onClick={onOpenMailbox}>
            <Inbox aria-hidden="true" />
            <span>Open Mailbox</span>
          </button>
          <button type="button" className="btn-icon approval-notification-banner__dismiss" onClick={onDismiss} aria-label="Dismiss approval notification banner">
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
