type IconProps = { size?: number };

export function ServerIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1" y="2" width="14" height="10" rx="1" fill="#d0d7e2" stroke="#5b6b7c" />
      <rect x="3" y="4" width="10" height="6" fill="#2b88d8" />
      <rect x="6" y="12" width="4" height="2" fill="#5b6b7c" />
    </svg>
  );
}

export function DatabaseIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <ellipse cx="8" cy="3.5" rx="5.5" ry="2.2" fill="#f6d56b" stroke="#b8860b" />
      <path d="M2.5 3.5 v7 c0 1.2 2.5 2.2 5.5 2.2 s5.5-1 5.5-2.2 v-7" fill="#f3c84a" stroke="#b8860b" />
      <ellipse cx="8" cy="3.5" rx="5.5" ry="2.2" fill="#ffe08a" stroke="#b8860b" />
    </svg>
  );
}

export function FolderIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1 4 h5 l1 1.5 h8 v8 H1 z" fill="#f6d56b" stroke="#b8860b" />
    </svg>
  );
}

export function TableIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" fill="#e8f3ff" stroke="#2b88d8" />
      <path d="M2 6 h12 M2 10 h12 M6 2 v12 M10 2 v12" stroke="#2b88d8" />
    </svg>
  );
}

export function ViewIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" fill="#f4eaff" stroke="#6b4c9a" />
      <path d="M2 7 h12 M6 3 v10" stroke="#6b4c9a" />
    </svg>
  );
}

export function ProcedureIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1" fill="#e8fff1" stroke="#1f8a3b" />
      <path d="M4.5 6 h7 M4.5 8.5 h7 M4.5 11 h4" stroke="#1f8a3b" />
    </svg>
  );
}

export function FunctionIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1" fill="#fff4e5" stroke="#c47b12" />
      <path d="M6 4.5 h4.5 M6 4.5 v7 M6 8 h3.2" fill="none" stroke="#c47b12" strokeWidth="1.3" />
    </svg>
  );
}

export function FormatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 3 h10 M3 6.5 h7 M3 10 h10 M3 13.5 h5" fill="none" stroke="#333" strokeWidth="1.4" />
    </svg>
  );
}

export function ColumnIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4" y="2" width="8" height="12" rx="1" fill="#d6ebff" stroke="#2b88d8" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5 L13 8 L4 13.5 Z" fill="#1f8a3b" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.2 L6.4 11.5 L13 4.5" fill="none" stroke="#0b6a0b" strokeWidth="2" />
    </svg>
  );
}

export function NewQueryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 1.5 h7 l3 3 V14.5 H3 z" fill="#fff" stroke="#3a3a3a" />
      <path d="M10 1.5 V4.5 H13" fill="none" stroke="#3a3a3a" />
      <path d="M5 8 h6 M5 10.5 h6" stroke="#2b88d8" />
    </svg>
  );
}

export function PlugIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 1 v4 M10 1 v4 M4 5 h8 v3 a4 4 0 0 1-8 0 z" fill="none" stroke="#2b88d8" strokeWidth="1.4" />
      <path d="M8 12 v3" stroke="#2b88d8" strokeWidth="1.4" />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 8 a5 5 0 1 1-1.5-3.5" fill="none" stroke="#333" strokeWidth="1.4" />
      <path d="M13 2.5 v3.2 h-3.2" fill="none" stroke="#333" strokeWidth="1.4" />
    </svg>
  );
}
