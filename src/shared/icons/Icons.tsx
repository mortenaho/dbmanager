type IconProps = { size?: number };

export function ServerIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2" width="13" height="8.2" fill="#e4e7ec" stroke="#5c6770" strokeWidth="0.8" />
      <rect x="2.6" y="3" width="10.8" height="5.4" fill="#3d7ec9" />
      <rect x="6.2" y="10.2" width="3.6" height="1.3" fill="#6d7782" />
      <rect x="4.2" y="11.5" width="7.6" height="1.3" fill="#8b949e" />
    </svg>
  );
}

export function DatabaseIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.6 4.2v7.1c0 1.15 2.42 2.1 5.4 2.1s5.4-.95 5.4-2.1V4.2" fill="#f0c43a" stroke="#c49612" strokeWidth="0.7" />
      <path d="M2.6 7.4c0 1 2.42 1.75 5.4 1.75s5.4-.75 5.4-1.75" fill="none" stroke="#d7aa22" strokeWidth="0.6" />
      <ellipse cx="8" cy="4.2" rx="5.4" ry="2" fill="#ffe7a3" stroke="#c49612" strokeWidth="0.7" />
    </svg>
  );
}

export function FolderIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.3 5.2h5l1.1-1.5h2.2v1.5h5.1v8.2H1.3z" fill="#e7b423" />
      <path d="M1.3 6.2h13.4v6.7H1.3z" fill="#ffd866" stroke="#c49612" strokeWidth="0.7" />
      <path d="M1.3 5.2h5l1.1-1.5h2.2v1.5" fill="#f6c445" stroke="#c49612" strokeWidth="0.7" />
    </svg>
  );
}

export function TableIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.6" y="2.2" width="12.8" height="11.6" fill="#fff" stroke="#3d7ec4" strokeWidth="0.8" />
      <rect x="1.6" y="2.2" width="12.8" height="3" fill="#5b9bd5" />
      <path d="M1.6 8.1h12.8M1.6 11h12.8M6.1 5.2v8.6M10.2 5.2v8.6" stroke="#8eb7e3" strokeWidth="0.7" />
    </svg>
  );
}

export function ViewIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.6" y="2.2" width="12.8" height="11.6" fill="#fff" stroke="#6a5acd" strokeWidth="0.8" />
      <rect x="1.6" y="2.2" width="12.8" height="3" fill="#8d7be0" />
      <path d="M1.6 8.1h12.8M1.6 11h12.8M6.1 5.2v8.6M10.2 5.2v8.6" stroke="#c4b8ef" strokeWidth="0.7" />
    </svg>
  );
}

export function ProcedureIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.2 1.6h6.2L12.8 5v9.4H3.2z" fill="#fff" stroke="#5a5a5a" strokeWidth="0.7" />
      <path d="M9.2 1.8V5H12.6" fill="#ececec" stroke="#5a5a5a" strokeWidth="0.7" />
      <path d="M5 8.2h5.2M5 10.2h5.2M5 12.1h3.2" stroke="#2e9b32" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}

export function FunctionIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" fill="#fff6df" stroke="#c49612" strokeWidth="0.8" />
      <path d="M6.1 4.2h4.4M6.1 4.2v7.6M6.1 8h3.4" fill="none" stroke="#c47b12" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

export function FormatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.4 3.2h11.2" stroke="#3A3A3A" strokeWidth="1.35" strokeLinecap="round" />
      <path d="M2.4 6.4h7.2" stroke="#3A3A3A" strokeWidth="1.35" strokeLinecap="round" />
      <path d="M5.2 9.6h8.4" stroke="#3A3A3A" strokeWidth="1.35" strokeLinecap="round" />
      <path d="M2.4 12.8h8" stroke="#3A3A3A" strokeWidth="1.35" strokeLinecap="round" />
      <path d="M2.4 9.6h1.5" stroke="#0078D4" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

export function ColumnIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5" y="1.8" width="6" height="12.4" fill="#e7f3ff" stroke="#3d7ec4" strokeWidth="0.8" />
      <path d="M5 5.2h6M5 8.4h6M5 11.4h6" stroke="#8eb7e3" strokeWidth="0.7" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.6 2.1 13.1 8 3.6 13.9Z" fill="#3C9F40" stroke="#1E7A24" strokeWidth="0.7" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.6 8.3 6.2 11.8 13.4 4.2" fill="none" stroke="#0078D4" strokeWidth="2.15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function NewQueryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 1.4h6.1L13 5.2V14.6H3Z" fill="#fff" stroke="#5C5C5C" strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M9.1 1.6V5.2H13" fill="#ECECEC" stroke="#5C5C5C" strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M4.8 7.3h6.2M4.8 9.4h6.2M4.8 11.5h4.2" stroke="#0078D4" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function PlugIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.7 4.1v6.1c0 .9 1.55 1.65 3.5 1.65s3.5-.75 3.5-1.65V4.1" fill="#F0C43A" stroke="#C49612" strokeWidth="0.7" />
      <path d="M1.7 6.5c0 .85 1.55 1.5 3.5 1.5s3.5-.65 3.5-1.5" fill="none" stroke="#C49612" strokeWidth="0.6" />
      <ellipse cx="5.2" cy="4.1" rx="3.5" ry="1.5" fill="#FFE7A0" stroke="#C49612" strokeWidth="0.7" />
      <path d="M14.3 8.6H10.8" stroke="#2E9B32" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M12.1 6.9 10.3 8.6l1.8 1.7" fill="none" stroke="#2E9B32" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 8 a5 5 0 1 1-1.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M13 2.5 v3.2 h-3.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
