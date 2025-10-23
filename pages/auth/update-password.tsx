// pages/auth/update-password.tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { createClient } from "@supabase/supabase-js";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");
const DEFAULT_TENANT =
  process.env.NEXT_PUBLIC_TENANT_ID || "11111111-1111-1111-1111-111111111111";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function UpdatePassword() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // メールリンクから来た ?code=... をセッション化
  useEffect(() => {
    sb.auth.exchangeCodeForSession(location.href).catch(() => {
      router.replace("/login");
    });
  }, [router]);

  const submit = async () => {
    setErr(null);
    setLoading(true);
    try {
      // 1) パスワード更新
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;

      // 2) 現在のSupabaseセッション→サーバJWTに交換
      const { data } = await sb.auth.getSession();
      const at = data.session?.access_token;
      if (!at) throw new Error("no session");
      const r = await fetch(`${API_BASE}/auth/supabase`, {
        method: "POST",
        headers: { Authorization: `Bearer ${at}` },
      });
      const j = await r.json();
      if (!r.ok || !j.token) throw new Error("server auth failed");

      // 3) 保存してダッシュボードへ
      const tenantId = j.tenantId || DEFAULT_TENANT;
      localStorage.setItem("kinder.jwt", j.token);
      localStorage.setItem("kinder.tenantId", tenantId);
      router.replace(`/tenant/${tenantId}/dashboard`);
    } catch (e: any) {
      setErr(e?.message || "更新に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#f5f7fb"}}>
      <div style={{background:"#fff",padding:24,borderRadius:12,boxShadow:"0 20px 40px rgba(15,20,30,.08)",minWidth:320}}>
        <h2>パスワード再設定</h2>
        <input
          type="password"
          placeholder="新しいパスワード"
          value={pw}
          onChange={(e)=>setPw(e.target.value)}
          style={{width:"100%",padding:"10px 12px",border:"1px solid #ccd3e0",borderRadius:6}}
        />
        <button onClick={submit} disabled={loading || !pw}
          style={{marginTop:12,width:"100%",padding:12,borderRadius:8,border:"none",background:"#2f6fed",color:"#fff"}}>
          {loading ? "更新中…" : "更新してログイン"}
        </button>
        {err && <p style={{color:"#c00"}}>{err}</p>}
      </div>
    </div>
  );
}
