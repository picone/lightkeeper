"use client";

import { useState } from "react";

export default function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `登录失败（${res.status}）`);
    } catch {
      setError("网络错误");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="card login-card" onSubmit={onSubmit}>
        <h1 className="brand"><img src="/icon.svg" alt="" width={28} height={28} />lightkeeper</h1>
        <label>
          用户名
          <input name="username" autoComplete="username" required maxLength={64} />
        </label>
        <label>
          密码
          <input name="password" type="password" autoComplete="current-password" required maxLength={256} />
        </label>
        {error && <p className="banner danger">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "登录中…" : "登录"}</button>
      </form>
    </main>
  );
}
