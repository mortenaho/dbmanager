import { useEffect, useState } from "react";
import { deleteProfile, loadProfiles, saveProfile } from "../api";
import { defaultPort, engineLabel, errorText, type ConnectPayload, type EngineKind, type Profile } from "../types";

type Props = {
  selectedId?: string | null;
  initialError?: string;
  onCancel: () => void;
  onConnect: (payload: ConnectPayload, profile: Profile) => Promise<void>;
};

const engines: EngineKind[] = ["mssql", "postgres", "mysql"];

function emptyForm(engine: EngineKind = "mssql"): ConnectPayload & { rememberPassword: boolean; name: string } {
  return {
    engine,
    name: "",
    host: "localhost",
    port: defaultPort(engine),
    username: engine === "postgres" ? "postgres" : engine === "mysql" ? "root" : "sa",
    password: "",
    database: "",
    trustCert: true,
    encrypt: engine === "mssql",
    ssl: false,
    rememberPassword: false,
  };
}

export function ConnectDialog({ selectedId, initialError = "", onCancel, onConnect }: Props) {
  const [form, setForm] = useState(emptyForm);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    loadProfiles()
      .then((items) => {
        if (cancel) return;
        setProfiles(items);
        if (selectedId === null) return;
        const chosen = items.find((item) => item.id === selectedId) ?? (selectedId ? undefined : items[0]);
        if (!chosen) return;
        setProfileId(chosen.id);
        setForm(formFromProfile(chosen));
      })
      .catch((reason) => {
        if (!cancel) setError(errorText(reason));
      });
    return () => {
      cancel = true;
    };
  }, [selectedId]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeEngine(engine: EngineKind) {
    setForm((current) => ({
      ...current,
      engine,
      port: defaultPort(engine),
      username:
        current.username === "sa" || current.username === "postgres" || current.username === "root"
          ? engine === "postgres"
            ? "postgres"
            : engine === "mysql"
              ? "root"
              : "sa"
          : current.username,
      encrypt: engine === "mssql",
      ssl: false,
    }));
  }

  function applyProfile(id: string) {
    setProfileId(id);
    const profile = profiles.find((item) => item.id === id);
    setForm(profile ? formFromProfile(profile) : emptyForm());
  }

  function formFromProfile(profile: Profile) {
    return {
      engine: profile.engine,
      name: profile.name,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      password: profile.password,
      database: profile.database,
      trustCert: profile.trustCert,
      encrypt: profile.encrypt,
      ssl: profile.ssl,
      rememberPassword: profile.rememberPassword,
    };
  }

  async function removeProfile() {
    if (!profileId) return;
    await deleteProfile(profileId);
    setProfiles((current) => current.filter((item) => item.id !== profileId));
    setProfileId("");
  }

  async function submit() {
    setBusy(true);
    setError("");
    const payload: ConnectPayload = {
      engine: form.engine,
      name: form.name.trim() || `${form.host},${form.port}`,
      host: form.host.trim(),
      port: Number(form.port),
      username: form.username,
      password: form.password,
      database: form.database.trim(),
      trustCert: form.trustCert,
      encrypt: form.encrypt,
      ssl: form.ssl,
    };
    const profile: Profile = {
      id: profileId,
      ...payload,
      rememberPassword: form.rememberPassword,
      password: form.rememberPassword ? form.password : "",
    };
    try {
      const saved = await saveProfile(profile);
      await onConnect(payload, saved);
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <form
        className="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="dialog-title">Connect to Server</div>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="saved">Saved</label>
            <div className="saved-row">
              <select id="saved" value={profileId} onChange={(event) => applyProfile(event.target.value)}>
                <option value="">New connection</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({engineLabel(profile.engine)})
                  </option>
                ))}
              </select>
              <button type="button" disabled={!profileId} onClick={() => void removeProfile()}>
                Delete
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="engine">Server type</label>
            <select
              id="engine"
              value={form.engine}
              onChange={(event) => changeEngine(event.target.value as EngineKind)}
            >
              {engines.map((engine) => (
                <option key={engine} value={engine}>
                  {engineLabel(engine)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="host">Server name</label>
            <input
              id="host"
              value={form.host}
              autoFocus={!profileId || form.password.length > 0}
              onChange={(event) => update("host", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="login">Authentication</label>
            <select id="login" value="sql" disabled>
              <option value="sql">
                {form.engine === "mssql" ? "SQL Server Authentication" : "Database user"}
              </option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="user">User name</label>
            <input id="user" value={form.username} onChange={(event) => update("username", event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={form.password}
              autoFocus={profileId.length > 0 && form.password.length === 0}
              onChange={(event) => update("password", event.target.value)}
            />
          </div>
          <div className="checks">
            <label>
              <input
                type="checkbox"
                checked={form.rememberPassword}
                onChange={(event) => update("rememberPassword", event.target.checked)}
              />
              Remember password
            </label>
          </div>
          <div className="section-label">Connection properties</div>
          <div className="field">
            <label htmlFor="dbname">Connect to database</label>
            <input
              id="dbname"
              value={form.database}
              placeholder={form.engine === "mssql" ? "master" : form.engine === "postgres" ? "postgres" : "optional"}
              onChange={(event) => update("database", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="port">Port</label>
            <input
              id="port"
              type="number"
              min={1}
              max={65535}
              value={form.port}
              onChange={(event) => update("port", Number(event.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="cname">Display name</label>
            <input
              id="cname"
              value={form.name}
              placeholder="Optional"
              onChange={(event) => update("name", event.target.value)}
            />
          </div>
          {form.engine === "mssql" ? (
            <div className="checks">
              <label>
                <input
                  type="checkbox"
                  checked={form.encrypt}
                  onChange={(event) => update("encrypt", event.target.checked)}
                />
                Encrypt connection
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.trustCert}
                  onChange={(event) => update("trustCert", event.target.checked)}
                />
                Trust server certificate
              </label>
            </div>
          ) : (
            <div className="checks">
              <label>
                <input type="checkbox" checked={form.ssl} onChange={(event) => update("ssl", event.target.checked)} />
                Use SSL
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.trustCert}
                  onChange={(event) => update("trustCert", event.target.checked)}
                />
                Trust server certificate
              </label>
            </div>
          )}
        </div>
        {error ? <div className="dialog-error">{error}</div> : null}
        <div className="dialog-actions">
          <button className="default" type="submit" disabled={busy}>
            {busy ? "Connecting..." : "Connect"}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
