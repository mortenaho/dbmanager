type IconProps = { size?: number };

export function ServerIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.2" y="1.3" width="13.6" height="5.6" rx="1" fill="#e7eef6" stroke="#3e5366" strokeWidth="0.8" />
      <rect x="1.2" y="8.1" width="13.6" height="5.6" rx="1" fill="#e7eef6" stroke="#3e5366" strokeWidth="0.8" />
      <circle cx="3.5" cy="4.1" r="0.75" fill="#2f9e4f" />
      <circle cx="3.5" cy="10.9" r="0.75" fill="#2b88d8" />
      <path d="M5.6 4.1 h7.2 M5.6 10.9 h7.2" stroke="#7e94a8" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}

export function DatabaseIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.7 4.5v7.1c0 1.25 2.37 2.2 5.3 2.2s5.3-.95 5.3-2.2V4.5" fill="#f0c43a" stroke="#a67c12" strokeWidth="0.7" />
      <path d="M2.7 8c0 .9 2.37 1.65 5.3 1.65s5.3-.75 5.3-1.65" fill="none" stroke="#c8961a" strokeWidth="0.6" />
      <ellipse cx="8" cy="4.5" rx="5.3" ry="2" fill="#ffe7a6" stroke="#a67c12" strokeWidth="0.7" />
      <ellipse cx="8" cy="4.2" rx="2.2" ry="0.65" fill="#fff6d2" />
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

function LineIcon({ size = 16, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export function SaveIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M3 2.5 h7.2 L13 5.2 V13.5 H3 z" />
      <path d="M5 2.5 V6 h5 V2.5" />
      <path d="M5 9.2 h6 v4.3 H5 z" />
    </LineIcon>
  );
}

export function OpenIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M1.8 6.2 h5 l1.2-1.6 h6.2 v1.6" />
      <path d="M1.8 6.2 H14 v7.2 H1.8 z" />
    </LineIcon>
  );
}

export function CloseIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M4 4 l8 8 M12 4 l-8 8" />
    </LineIcon>
  );
}

export function CloseAllIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M6 3.2 h7 v8" />
      <path d="M3 5 h7 v8 H3 z" />
      <path d="M4.6 7.4 l3.8 3.8 M8.4 7.4 l-3.8 3.8" />
    </LineIcon>
  );
}

export function ExitIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M6.5 3 H3.2 v10 h3.3" />
      <path d="M7 8 h6" />
      <path d="M10.6 5.4 L13.2 8 10.6 10.6" />
    </LineIcon>
  );
}

export function ConnectIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M6 1.6 v3.2 M10 1.6 v3.2" />
      <path d="M4.2 4.8 h7.6 v2.6 a3.8 3.8 0 0 1-7.6 0 z" />
      <path d="M8 11.2 v3" />
    </LineIcon>
  );
}

export function DisconnectIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M6 1.8 v2.6 M10 1.8 v2.6" />
      <path d="M4.4 4.6 h7.2 v2.2 a3.6 3.6 0 0 1-7.2 0 z" />
      <path d="M8 10.4 v2.4" />
      <path d="M3.2 13.2 L12.8 3.2" />
    </LineIcon>
  );
}

export function ScriptIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M3.5 2 h6.2 L12 4.4 V14 H3.5 z" />
      <path d="M9.5 2 v2.6 H12" />
      <path d="M5.5 7.2 h5 M5.5 9.5 h5 M5.5 11.8 h3" />
    </LineIcon>
  );
}

export function ScriptBothIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M2.5 2 h5.4 L10 4.2 V12 H2.5 z" />
      <path d="M4.2 6.2 h3.6 M4.2 8.2 h3.6" />
      <path d="M11 9.2 v4 M9 11.2 h4" />
    </LineIcon>
  );
}

export function InsertIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M3 2.5 h6.2 L11.5 5 V8" />
      <path d="M3 2.5 V13.5 h5" />
      <path d="M10 10 v4 M8 12 h4" />
    </LineIcon>
  );
}

export function BackupIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M2.2 3.2 h11.6 v2.4 H2.2 z" />
      <path d="M3.4 5.6 v7.2 h9.2 V5.6" />
      <path d="M8 7.4 v3.6" />
      <path d="M6.3 9.4 L8 11.1 9.7 9.4" />
    </LineIcon>
  );
}

export function HistoryIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <circle cx="8" cy="8" r="5.2" />
      <path d="M8 4.8 V8 l2.2 1.4" />
    </LineIcon>
  );
}

export function ExplorerIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M3 2.5 v11" />
      <path d="M3 4.5 h3.2 M3 8 h5.2 M3 11.5 h3.2" />
      <path d="M9.2 6.8 h4 M9.2 9.6 h4" />
    </LineIcon>
  );
}

export function ExcelIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="2.2" y="2.2" width="11.6" height="11.6" />
      <path d="M2.2 6 h11.6 M2.2 9.8 h11.6 M6.2 2.2 v11.6 M9.8 2.2 v11.6" />
    </LineIcon>
  );
}

export function JsonIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M6.2 3.2 c-1.6 0-1.8 1.4-1.8 2.4 S5.6 7.2 6.2 8 4.4 8.8 4.4 10.2 4.6 12.8 6.2 12.8" />
      <path d="M9.8 3.2 c1.6 0 1.8 1.4 1.8 2.4 S10.4 7.2 9.8 8 s1.8.8 1.8 2.2-1.6 2.6-1.8 2.6" />
    </LineIcon>
  );
}

export function DesignIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="1.6" y="5.4" width="4.2" height="3.4" />
      <rect x="10.2" y="1.8" width="4.2" height="3.4" />
      <rect x="10.2" y="10.6" width="4.2" height="3.4" />
      <path d="M5.8 7.1 H8.2 L10.2 3.5 M8.2 7.1 L10.2 12.3" />
    </LineIcon>
  );
}

export function OptionsIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M2.5 4 h11 M2.5 8 h11 M2.5 12 h11" />
      <circle cx="6" cy="4" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="8" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="7" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </LineIcon>
  );
}

export function KeyboardIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="1.6" y="3.6" width="12.8" height="8.8" rx="1" />
      <path d="M3.6 6.2 h1.2 M6.2 6.2 h1.2 M8.8 6.2 h1.2 M11.2 6.2 h1.2" />
      <path d="M4.2 9.4 h7.6" />
    </LineIcon>
  );
}

export function InfoIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <circle cx="8" cy="8" r="5.2" />
      <path d="M8 7.2 v4" />
      <circle cx="8" cy="4.7" r="0.7" fill="currentColor" stroke="none" />
    </LineIcon>
  );
}

export function RenameIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M9.2 2.4 l4.2 4.2 L6.2 13.8 H2.2 v-4 z" />
      <path d="M8 3.6 l4.2 4.2" />
    </LineIcon>
  );
}

export function NewTableIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="1.6" y="2.2" width="9" height="8.6" />
      <path d="M1.6 5 h9 M5 2.2 v8.6" />
      <path d="M11.6 9.4 v4 M9.6 11.4 h4" />
    </LineIcon>
  );
}

export function InsertColumnIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="2.4" y="2.2" width="5.4" height="11.6" />
      <path d="M11.2 6.2 v4.6 M8.9 8.5 h4.6" />
    </LineIcon>
  );
}

export function DeleteColumnIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="2.4" y="2.2" width="5.4" height="11.6" />
      <path d="M9.2 8.5 h4.6" />
    </LineIcon>
  );
}

export function SelectRowsIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="2" y="2.4" width="12" height="11.2" />
      <path d="M2 6 h12 M2 9.6 h12" />
      <path d="M2.6 6.4 h10.8 v2.8 H2.6 z" fill="currentColor" stroke="none" />
    </LineIcon>
  );
}

export function CopyIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="5.2" y="4.8" width="7.6" height="8.4" />
      <path d="M5.2 7.2 h7.6" />
      <path d="M3.2 10.6 V2.8 h7.2" />
    </LineIcon>
  );
}

export function CopyPlainIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="5.2" y="4.8" width="7.6" height="8.4" />
      <path d="M7 8 h4 M7 10.4 h4" />
      <path d="M3.2 10.6 V2.8 h7.2" />
    </LineIcon>
  );
}

export function SelectAllIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="2.6" y="2.6" width="10.8" height="10.8" strokeDasharray="2.2 1.4" />
    </LineIcon>
  );
}

export function SortAscIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M3 4 h6 M3 7.2 h4.2 M3 10.4 h2.4" />
      <path d="M11.4 12.2 V4.2" />
      <path d="M9.4 6.2 L11.4 4 13.4 6.2" />
    </LineIcon>
  );
}

export function SortDescIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M3 4 h6 M3 7.2 h4.2 M3 10.4 h2.4" />
      <path d="M11.4 3.8 v8" />
      <path d="M9.4 9.8 L11.4 12 13.4 9.8" />
    </LineIcon>
  );
}

export function DeleteIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M3.2 4.4 h9.6" />
      <path d="M6.2 4.4 V2.8 h3.6 v1.6" />
      <path d="M4.4 4.4 l.7 8.8 h5.8 l.7-8.8" />
      <path d="M7 7 v4 M9 7 v4" />
    </LineIcon>
  );
}

export function ClearIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <circle cx="8" cy="8" r="5.2" />
      <path d="M5.4 5.4 l5.2 5.2" />
    </LineIcon>
  );
}

export function ArrangeIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="2" y="2" width="5" height="4.2" />
      <rect x="9" y="2" width="5" height="5.4" />
      <rect x="2" y="8.2" width="5" height="5.6" />
      <rect x="9" y="9.4" width="5" height="4.4" />
    </LineIcon>
  );
}

export function ImplementIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M2 8 h6.2" />
      <path d="M6.2 5.6 L9 8 6.2 10.4" />
      <rect x="10.2" y="3.2" width="3.6" height="9.6" />
    </LineIcon>
  );
}

export function OneToManyIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <circle cx="3" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <path d="M4.6 8 H10" />
      <path d="M10 8 L13.4 4.8 M10 8 H13.4 M10 8 L13.4 11.2" />
    </LineIcon>
  );
}

export function OneToOneIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <circle cx="3.2" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <path d="M4.8 8 h6.4" />
      <circle cx="12.8" cy="8" r="1.3" fill="currentColor" stroke="none" />
    </LineIcon>
  );
}

export function ManyToManyIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M2.2 4.8 L5.2 8 2.2 11.2" />
      <path d="M5.2 8 h5.6" />
      <path d="M13.8 4.8 L10.8 8 13.8 11.2" />
    </LineIcon>
  );
}

export function LinkIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M6.4 8.6 H4.2 a2.3 2.3 0 0 1 0-4.6 h2.6" />
      <path d="M9.6 7.4 h2.2 a2.3 2.3 0 0 1 0 4.6 H9.2" />
      <path d="M6.2 8 h3.6" />
    </LineIcon>
  );
}

export function UniqueIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M8 2.2 L13.2 8 8 13.8 2.8 8 z" />
    </LineIcon>
  );
}

export function ResultsIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="2.2" y="2.4" width="11.6" height="11.2" />
      <path d="M2.2 5.8 h11.6 M2.2 9 h11.6 M6.4 5.8 v7.8" />
    </LineIcon>
  );
}

export function MessagesIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M2.4 3.2 h11.2 v7.4 H6.2 L3.2 13 v-2.4 H2.4 z" />
    </LineIcon>
  );
}

export function PrimaryKeyIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.2 1.6a3 3 0 0 1 1.1 5.8l.3.2 1.2-.1.6.7-.7.7.8.1.5.6-.9.8H7.5l-.4-1.4A3 3 0 1 1 6.2 1.6zm.1 1.5a1.4 1.4 0 1 0 .1 2.8 1.4 1.4 0 0 0-.1-2.8z"
      />
    </svg>
  );
}

export function LogIcon({ size = 16 }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M3.2 2.4 h7.2 L12.8 4.8 V13.6 H3.2 z" />
      <path d="M5.2 6.4 h6 M5.2 8.8 h6 M5.2 11.2 h4" />
    </LineIcon>
  );
}
