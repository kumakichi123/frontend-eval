import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");
const DEFAULT_TENANT =
  process.env.NEXT_PUBLIC_TENANT_ID || "11111111-1111-1111-1111-111111111111";

// 画面に表示するだけのデモ資格情報
const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_EMAIL || "demo@example.com";
const DEMO_PASS  = process.env.NEXT_PUBLIC_DEMO_PASSWORD || "dummy_pass";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = localStorage.getItem("kinder.jwt");
    if (token) {
      const tenant = localStorage.getItem("kinder.tenantId") || DEFAULT_TENANT;
      router.replace(`/tenant/${tenant}/dashboard`);
    }
  }, [router]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json().catch(async () => ({ error: await r.text() }));
      if (!r.ok || !j.token) throw new Error(j?.error || "サーバ認証に失敗しました");

      const tenantId = j.tenantId || DEFAULT_TENANT;
      localStorage.setItem("kinder.jwt", j.token);
      localStorage.setItem("kinder.tenantId", tenantId);
      router.push(`/tenant/${tenantId}/dashboard`);
    } catch (err:any) {
      setError(err.message || "ログイン失敗");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="panel" onSubmit={handleSubmit}>
        <h1>管理者ログイン</h1>
        <label>
          <span>メールアドレス</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          <span>パスワード</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "ログイン中…" : "ログイン"}
        </button>
      </form>

      {/* フォーム直下に表示（テキストのみ） */}
      <div className="demo-info">
        <p className="title">デモ用ログイン情報</p>
        <p className="kv"><span>メール</span><code>{DEMO_EMAIL}</code></p>
        <p className="kv"><span>パスワード</span><code>{DEMO_PASS}</code></p>
      </div>

      <style jsx>{`
        .login-page{min-height:100vh;background:#f5f7fb;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;gap:12px;}
        .panel{background:#fff;padding:32px;border-radius:12px;box-shadow:0 20px 40px rgba(15,20,30,.08);min-width:320px;display:flex;flex-direction:column;gap:16px;max-width:420px;width:100%;}
        label{display:flex;flex-direction:column;gap:8px;font-size:14px;color:#333;}
        input{padding:10px 12px;border-radius:6px;border:1px solid #ccd3e0;font-size:16px;}
        button{padding:12px;border-radius:8px;border:none;background:#2f6fed;color:#fff;font-size:16px;cursor:pointer;}
        button[disabled]{opacity:.6;cursor:not-allowed;}
        .error{color:#c00;margin:0;font-size:14px;}
        .demo-info{background:#f0f5ff;border:1px solid #cfe0ff;border-radius:8px;padding:12px;max-width:420px;width:100%;}
        .title{margin:0 0 6px 0;font-weight:600;color:#1f3b82;font-size:14px;}
        .kv{display:flex;justify-content:space-between;gap:8px;margin:0;}
        .kv span{color:#334155;font-size:13px;}
        code{background:#e6eeff;border-radius:4px;padding:2px 6px;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;}
      `}</style>
    </div>
  );
}
