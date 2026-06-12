import { STATUS } from "../constants.js";

export default function StatusBadge({ status, full = false }) {
  const s = STATUS[status] || STATUS[6];
  return (
    <span className="status-badge" style={{ background: s.color }}>
      {full ? s.label : s.short}
    </span>
  );
}
