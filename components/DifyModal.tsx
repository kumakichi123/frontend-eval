import { useMemo, useState, type CSSProperties } from 'react';

export type DifyResult = {
  itemName: string;
  itemDescription: string;
};

type Props = {
  onClose: () => void;
  onApply: (data: DifyResult) => void;
  tenantId: string;
  role: string;
  apiBase: string;
  token: string;
};

const defaultSeed =
  '\u30a6\u30c1\u306b\u3068\u3063\u3066\u30c1\u30fc\u30e0\u30ef\u30fc\u30af\u3068\u306f\u3001\u4fdd\u80b2\u58eb\u3060\u3051\u3067\u306a\u304f\u4ed6\u8077\u7a2e\u3068\u306e\u9023\u643a\u3082\u542b\u3081\u308b';

export default function DifyModal({ onClose, onApply, tenantId, role, apiBase, token }: Props) {
  const [seedText, setSeedText] = useState(defaultSeed);
  const [styleHint, setStyleHint] = useState('');
  const [result, setResult] = useState<DifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint = useMemo(() => {
    const trimmed = apiBase?.trim().replace(/\/$/, '');
    return trimmed ? `${trimmed}/api/dify/generate` : '/api/dify/generate';
  }, [apiBase]);

  const callDify = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ tenantId, role, seedText, style: styleHint })
      });
      const json = (await res.json().catch(() => null)) as (Partial<DifyResult> & { error?: string }) | null;
      if (!res.ok || !json) {
        throw new Error(json?.error || `Dify\u30ea\u30af\u30a8\u30b9\u30c8\u304c\u5931\u6557\u3057\u307e\u3057\u305f (${res.status})`);
      }
      setResult(normalizeResult(json));
    } catch (e: any) {
      setError(e?.message ?? '\u751f\u6210\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002');
    } finally {
      setLoading(false);
    }
  };

  const canApply = Boolean(result && result.itemName.trim() && result.itemDescription.trim());

  return (
    <div style={backdropStyle}>
      <div style={panelStyle}>
        <h3 style={{ margin: 0, marginBottom: 12 }}>{'Dify\u751f\u6210'}</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={fieldLabelStyle}>
            <span>{'\u89b3\u5bdf\u30e1\u30e2'}</span>
            <textarea
              rows={4}
              style={textAreaStyle}
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              placeholder={'\u8a55\u4fa1\u5bfe\u8c61\u3068\u306a\u308b\u51fa\u6765\u4e8b\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002'}
            />
          </label>
          <label style={fieldLabelStyle}>
            <span>{'\u30b9\u30bf\u30a4\u30eb\uff08\u4efb\u610f\uff09'}</span>
            <input
              type="text"
              value={styleHint}
              onChange={(e) => setStyleHint(e.target.value)}
              placeholder={'\u4f8b: \u524d\u5411\u304d\u306b / \u7c21\u6f54\u306b'}
              style={inputStyle}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button onClick={callDify} disabled={loading} style={buttonStyle}>
            {loading ? '\u751f\u6210\u4e2d\u2026' : '\u751f\u6210'}
          </button>
          <button onClick={onClose} disabled={loading} style={{ ...buttonStyle, background: '#7b8794' }}>
            {'\u9589\u3058\u308b'}
          </button>
        </div>

        {error && <p style={{ color: '#c00', marginTop: 12 }}>{error}</p>}

        {result && (
          <div style={editorStyle}>
            <label style={fieldLabelStyle}>
              <span>{'\u8a55\u4fa1\u9805\u76ee\u540d'}</span>
              <input
                type="text"
                value={result.itemName}
                onChange={(e) => setResult({ ...result, itemName: e.target.value })}
                style={inputStyle}
              />
            </label>
            <label style={fieldLabelStyle}>
              <span>{'\u9805\u76ee\u8aac\u660e'}</span>
              <textarea
                rows={5}
                style={textAreaStyle}
                value={result.itemDescription}
                onChange={(e) => setResult({ ...result, itemDescription: e.target.value })}
              />
            </label>
            <button
              onClick={() => result && onApply(cleanResult(result))}
              style={{ ...buttonStyle, marginTop: 6 }}
              disabled={!canApply}
            >
              {'\u8868\u306b\u8ffd\u52a0'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'grid',
  placeItems: 'center',
  zIndex: 1000
};

const panelStyle: CSSProperties = {
  background: '#fff',
  padding: 20,
  width: 640,
  maxWidth: '90vw',
  maxHeight: '90vh',
  overflowY: 'auto',
  borderRadius: 12,
  boxShadow: '0 18px 34px rgba(15, 23, 42, 0.18)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12
};

const fieldLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 14,
  color: '#1f2937'
};

const textAreaStyle: CSSProperties = {
  width: '100%',
  resize: 'vertical',
  padding: 10,
  borderRadius: 6,
  border: '1px solid #cbd5f0',
  fontSize: 14,
  lineHeight: 1.5
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: 10,
  borderRadius: 6,
  border: '1px solid #cbd5f0',
  fontSize: 14
};

const buttonStyle: CSSProperties = {
  padding: '10px 18px',
  border: 'none',
  borderRadius: 8,
  background: '#2563eb',
  color: '#fff',
  cursor: 'pointer'
};

const editorStyle: CSSProperties = {
  marginTop: 18,
  background: '#f5f7fb',
  padding: 14,
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 12
};

function normalizeResult(result: Partial<DifyResult>): DifyResult {
  const itemName = (result.itemName || '').trim();
  const itemDescription = (result.itemDescription || '').trim();
  const fallbackName = itemName || 'AI\u63d0\u6848\u9805\u76ee';
  const fallbackDescription =
    itemDescription ||
    '\u751f\u6210\u7d50\u679c\u3092\u7de8\u96c6\u3057\u3066\u304f\u3060\u3055\u3044\u3002\u8a55\u4fa1\u306e\u72d9\u3044\u3084\u89b3\u5bdf\u30dd\u30a4\u30f3\u30c8\u30922\u301c3\u6587\u3067\u5165\u529b\u3057\u307e\u3059\u3002';
  return { itemName: fallbackName, itemDescription: fallbackDescription };
}

function cleanResult(result: DifyResult): DifyResult {
  return {
    itemName: result.itemName.trim(),
    itemDescription: result.itemDescription.trim()
  };
}
