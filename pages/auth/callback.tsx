"use client";
import { useEffect } from "react";
import { useRouter } from "next/router";
import { createClient } from "@supabase/supabase-js";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");
const DEFAULT_TENANT =
  process.env.NEXT_PUBLIC_TENANT_ID || "11111111-1111-1111-1111-111111111111";

export default function Callback() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) return router.replace("/login");
      const sb = createClient(url, anon);

      const href = location.href;
      const hash = location.hash;

      // 1) セッション確立
      if (href.includes("code=")) {
        const { error } = await sb.auth.exchangeCodeForSession(href);
        if (error) return router.replace("/login");
      } else if (hash.includes("access_token=")) {
        const q = new URLSearchParams(hash.slice(1));
        await sb.auth.setSession({
          access_token: q.get("access_token")!,
          refresh_token: q.get("refresh_token")!,
        });
      } else {
        return router.replace("/login");
      }

      // 2) 自前JWTに交換して保存（必要な場合）
      try {
        const { data } = await sb.auth.getSession();
        const at = data.session?.access_token;
        if (at) {
          const r = await fetch(`${API_BASE}/auth/supabase`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken: at }),
          });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j.token) {
            const tenantId = j.tenantId || DEFAULT_TENANT;
            localStorage.setItem("kinder.jwt", j.token);
            localStorage.setItem("kinder.tenantId", tenantId);
            return router.replace(`/tenant/${tenantId}/dashboard`);
          }
        }
      } catch (_) {
        /* 無視して次へ */
      }

      // 3) 交換しない運用なら、ここでトップ or ログインへ
      router.replace("/");
    })();
  }, [router]);

  return null;
}
