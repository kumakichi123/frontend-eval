import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { createClient } from "@supabase/supabase-js";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");
const DEFAULT_TENANT =
  process.env.NEXT_PUBLIC_TENANT_ID || "11111111-1111-1111-1111-111111111111";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const sb = createClient(SB_URL, SB_ANON);

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

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
      // 1) Supabaseで認証
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw new Error("メールまたはパスワードが無効です");

      // 2) サーバJWTへ交換（ヘッダで渡す）
      const at = data.session.access_token;
      const r = await fetch(`${API_BASE}/auth/supabase`, {
        method: "POST",
        headers: { Authorization: `Bearer ${at}` },
      });
      const j = await r.json();
      if (!r.ok || !j.token) throw new Error("サーバ認証に失敗しました");


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

  // パスワード再設定メール送信
  const sendResetMail = async () => {
    if (!email) return setError("メールを入力してください");
    setSendingReset(true);
    setError(null);
    setInfo(null);
    try {
      await sb.auth.resetPasswordForEmail(email, {
        redirectTo: `${location.origin}/auth/update-password`,
      });
      setInfo("再設定メールを送信しました。受信箱を確認してください。");
    } catch (e: any) {
      setError(e?.message ?? "送信に失敗しました");
    } finally {
      setSendingReset(false);
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
        {info && <p className="info">{info}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "ログイン中…" : "ログイン"}
        </button>

        <div className="row">
          <button type="button" onClick={sendResetMail} disabled={sendingReset || !email}>
            {sendingReset ? "送信中…" : "パスワードを忘れた場合（再設定メール送信）"}
          </button>
        </div>
      </form>
      <style jsx>{`
        .login-page{min-height:100vh;background:#f5f7fb;display:flex;align-items:center;justify-content:center;padding:32px;}
        .panel{background:#fff;padding:32px;border-radius:12px;box-shadow:0 20px 40px rgba(15,20,30,.08);min-width:320px;display:flex;flex-direction:column;gap:16px;}
        label{display:flex;flex-direction:column;gap:8px;font-size:14px;color:#333;}
        input{padding:10px 12px;border-radius:6px;border:1px solid #ccd3e0;font-size:16px;}
        button{padding:12px;border-radius:8px;border:none;background:#2f6fed;color:#fff;font-size:16px;cursor:pointer;}
        button[disabled]{opacity:.6;cursor:not-allowed;}
        .row{display:flex;gap:8px;flex-direction:column}
        .error{color:#c00;margin:0;font-size:14px;}
        .info{color:#0a7;margin:0;font-size:14px;}
      `}</style>
    </div>
  );
}
