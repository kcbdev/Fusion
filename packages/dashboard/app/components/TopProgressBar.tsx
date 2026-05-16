import "./TopProgressBar.css";

interface TopProgressBarProps {
  visible: boolean;
}

export function TopProgressBar({ visible }: TopProgressBarProps) {
  return (
    <div
      className="top-progress-bar"
      data-visible={visible ? "true" : "false"}
      role="progressbar"
      aria-busy={visible}
      aria-label="Loading"
    >
      <div className="top-progress-bar__indicator" />
    </div>
  );
}
