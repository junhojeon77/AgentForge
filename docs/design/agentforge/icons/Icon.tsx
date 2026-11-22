// AgentForge icons: 24-unit grid, 2-unit round stroke, currentColor. Stroke only.
// Always render beside a text label; the icon is hidden from screen readers.
import type { ReactElement } from "react";

const paths = {
  "needs-you": <><circle cx="12" cy="8" r="4"/><path d="M4 21c1.2-4.2 4.3-6.5 8-6.5s6.8 2.3 8 6.5"/></>,
  "working": <><path d="M12 3a9 9 0 1 1-9 9"/></>,
  "waiting": <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></>,
  "held": <><path d="M9 5v14M15 5v14"/></>,
  "done": <><path d="M5 12.5l4.5 4.5L19 7"/></>,
  "problem": <><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5h.01"/></>,
  "stopped": <><circle cx="12" cy="12" r="9"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/></>,
  "finished": <><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></>,
  "connected": <><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></>,
  "connecting": <><path d="M6 12h.01M12 12h.01M18 12h.01"/></>,
  "offline": <><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></>,
  "no-token": <><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></>,
  "resume": <><path d="M8 5l11 7-11 7z"/></>,
  "retry": <><path d="M20 12a8 8 0 1 1-2.35-5.65"/><path d="M20 4v5h-5"/></>,
  "cancel": <><path d="M6 6l12 12M18 6L6 18"/></>,
  "approve": <><path d="M5 12.5l4.5 4.5L19 7"/></>,
  "reject": <><path d="M6 6l12 12M18 6L6 18"/></>,
  "chevron": <><path d="M9 6l6 6-6 6"/></>,
  "copy": <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></>
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof paths;

export function Icon({ name, className = "size-4" }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
