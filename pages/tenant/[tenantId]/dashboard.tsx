import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import debounce from 'lodash.debounce';

import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';

import DifyModal, { type DifyResult } from '../../../components/DifyModal';
import { exportGridToXlsx } from '../../../utils/xlsx';

const ROLES = ['保育士', 'リーダー', '主任', '看護師', '事務'];
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || '').replace(/\/$/, '');
const PLACEHOLDER_KEY = '__placeholder__';

type Template = { id: string; title: string; max_score: number };
type ItemRow = { item_key: string; label: string; description: string } & Record<string, number | string | undefined>;
type Staff = { id: string; name: string; role?: string; staff_code?: string | null };
type EvaluationCell = { period: string; evaluator_role: string; staff_id: string; item_key: string; score: number };
type EvalKind = 'self' | 'mgr';

function buildPlaceholderRow(staffList: Staff[]): ItemRow {
  const base: ItemRow = {
    item_key: PLACEHOLDER_KEY,
    label: '',
    description: ''
  };
  for (const member of staffList) {
    base[`self_${member.id}`] = undefined;
    base[`mgr_${member.id}`] = undefined;
  }
  return base;
}

export default function Dashboard() {
  const router = useRouter();
  const { tenantId: tenantIdFromRoute } = router.query as { tenantId?: string };
  const gridRef = useRef<AgGridReact<ItemRow>>(null);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [role, setRole] = useState('保育士');
  const [template, setTemplate] = useState<Template | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [rowData, setRowData] = useState<ItemRow[]>([]);
  const [draftItemRow, setDraftItemRow] = useState<ItemRow>(() => buildPlaceholderRow([]));
  const [showDify, setShowDify] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeEvaluator, setActiveEvaluator] = useState<EvalKind>('self');
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [savingItems, setSavingItems] = useState(false);
  const [creatingStaff, setCreatingStaff] = useState(false);

  useEffect(() => {
    setDraftItemRow(buildPlaceholderRow(staff));
  }, [staff]);

  const gridRows = useMemo(() => {
    return [...rowData, draftItemRow];
  }, [rowData, draftItemRow]);

  const [tenantId, setTenantId] = useState<string | null>(null);
  useEffect(() => {
    const envTenant = process.env.NEXT_PUBLIC_TENANT_ID || '';
    const lsTenant = typeof window !== 'undefined' ? localStorage.getItem('kinder.tenantId') || '' : '';
    const resolved = (tenantIdFromRoute as string) || envTenant || lsTenant || '';
    if (resolved) {
      setTenantId(resolved);
      if (typeof window !== 'undefined') {
        localStorage.setItem('kinder.tenantId', resolved);
      }
    }
  }, [tenantIdFromRoute]);

  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('kinder.jwt');
      const sanitized = stored && stored !== 'undefined' && stored !== 'null' ? stored : '';
      setToken(sanitized);
    }
  }, []);

  const handleAuthFailure = useCallback((message?: string) => {
    setError(message || 'ログイン情報が無効です。再度ログインしてください。');
    if (typeof window !== 'undefined') {
      localStorage.removeItem('kinder.jwt');
    }
    setToken('');
  }, []);

  useEffect(() => {
    if (token === null) return;
    if (!token) router.replace('/login');
  }, [token, router]);

  const apiUrl = useCallback((path: string) => {
    return API_BASE ? `${API_BASE}${path}` : path;
  }, []);

  const buildRowData = useCallback((sourceItems: ItemRow[], sourceStaff: Staff[], sourceEvaluations: EvaluationCell[]) => {
    const rows = sourceItems.map((item) => {
      const base: ItemRow = {
        item_key: item.item_key,
        label: item.label,
        description: item.description
      };
      for (const s of sourceStaff) {
        base[`self_${s.id}`] = undefined;
        base[`mgr_${s.id}`] = undefined;
      }
      return base;
    });
    const rowMap = new Map(rows.map((row) => [row.item_key, row]));
    for (const ev of sourceEvaluations) {
      const row = rowMap.get(ev.item_key);
      if (!row) continue;
      const prefix = ev.evaluator_role === '園長' ? 'mgr' : 'self';
      row[`${prefix}_${ev.staff_id}`] = ev.score;
    }
    return rows;
  }, []);

  const refreshData = useCallback(async () => {
    if (!tenantId || !token) return;
    setLoading(true);
    setError(null);
    try {
      const headers: HeadersInit = { Authorization: `Bearer ${token}` };
      const templateRes = await fetch(apiUrl(`/api/templates/${tenantId}/${role}`), { headers });
      if (templateRes.status === 401) {
        handleAuthFailure('セッションの有効期限が切れました。再度ログインしてください。');
        return;
      }
      if (!templateRes.ok) throw new Error(`テンプレート取得に失敗しました (${templateRes.status})`);
      const templateJson = await templateRes.json();
      const templateData: Template | null = templateJson.template;
      const itemRows: ItemRow[] = templateJson.items || [];
      const staffRows: Staff[] = templateJson.staff || [];

      setTemplate(templateData);
      setItems(itemRows);
      setStaff(staffRows);
      setSelectedItemKey(null);

      if (!templateData) {
        setRowData(buildRowData(itemRows, staffRows, []));
        return;
      }

      const evalRes = await fetch(apiUrl(`/api/evaluations/${tenantId}/${role}`), { headers });
      if (evalRes.status === 401) {
        handleAuthFailure('セッションの有効期限が切れました。再度ログインしてください。');
        return;
      }
      if (!evalRes.ok) throw new Error(`評価の取得に失敗しました (${evalRes.status})`);
      const evalJson = await evalRes.json();
      const evalRows: EvaluationCell[] = evalJson.rows || [];
      setRowData(buildRowData(itemRows, staffRows, evalRows));
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? 'データ取得に失敗しました');
      setTemplate(null);
      setItems([]);
      setStaff([]);
      setRowData([]);
      setSelectedItemKey(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId, token, role, apiUrl, buildRowData, handleAuthFailure]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const persistTemplateItems = useCallback(
    async (nextItems: ItemRow[]) => {
      if (!template || !tenantId || !token) return;
      setSavingItems(true);
      try {
        const response = await fetch(apiUrl(`/api/templates/${tenantId}/${template.id}`), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            items: nextItems.map((item, index) => ({
              key: item.item_key,
              label: item.label.trim() || `未設定の項目${index + 1}`,
              description: item.description.trim(),
              display_order: index
            }))
          })
        });
        if (response.status === 401) {
          handleAuthFailure('セッションの有効期限が切れました。再度ログインしてください。');
          throw new Error('認証が必要です');
        }
        if (!response.ok) {
          const message = await response.text().catch(() => '');
          throw new Error(
            message ? `failed to save template items (${response.status}): ${message}` : `failed to save template items (${response.status})`
          );
        }
      } catch (err: any) {
        console.error('failed to save template items', err);
        setError(err?.message ?? '評価項目の保存に失敗しました');
        throw err;
      } finally {
        setSavingItems(false);
      }
    },
    [template, tenantId, token, apiUrl, handleAuthFailure]
  );

  // 機能保持のため残す（UIからは呼ばれない）
  const createStaff = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (!tenantId || !token) {
        setError('職員の追加にはログインが必要です');
        return;
      }
      setCreatingStaff(true);
      try {
        const response = await fetch(apiUrl(`/api/staff/${tenantId}`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            name: trimmed,
            role: role || '職員'
          })
        });
        if (response.status === 401) {
          handleAuthFailure('セッションの有効期限が切れました。再度ログインしてください。');
          throw new Error('認証が必要です');
        }
        if (!response.ok) {
          const raw = await response.text().catch(() => '');
          let detail = raw.trim();
          if (detail.startsWith('{')) {
            try {
              const parsed = JSON.parse(detail);
              if (parsed && typeof parsed.error === 'string') {
                detail = parsed.error;
              }
            } catch {}
          }
          throw new Error(detail || `failed to create staff (${response.status})`);
        }
        await refreshData();
      } catch (err: any) {
        console.error('failed to create staff', err);
        setError(err?.message ?? '職員の追加に失敗しました');
      } finally {
        setCreatingStaff(false);
      }
    },
    [tenantId, token, role, apiUrl, handleAuthFailure, refreshData]
  );

  // 機能保持のため残す（UIからは呼ばれない）
  const updateStaff = useCallback(
    async (staffId: string, name: string) => {
      if (!tenantId || !token) {
        setError('職員の更新にはログインが必要です');
        throw new Error('authentication required');
      }
      const trimmed = name.trim();
      if (!trimmed) {
        throw new Error('職員名を入力してください');
      }
      const response = await fetch(apiUrl(`/api/staff/${tenantId}/${staffId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name: trimmed })
      });
      if (response.status === 401) {
        handleAuthFailure('セッションの有効期限が切れました。再度ログインしてください。');
        throw new Error('認証が必要です');
      }
      if (!response.ok) {
        const raw = await response.text().catch(() => '');
        let detail = raw.trim();
        if (detail.startsWith('{')) {
          try {
            const parsed = JSON.parse(detail);
            if (parsed && typeof parsed.error === 'string') {
              detail = parsed.error;
            }
          } catch {}
        }
        throw new Error(detail || `failed to update staff (${response.status})`);
      }
      const json = await response.json().catch(() => null);
      return json?.staff as Staff | undefined;
    },
    [tenantId, token, apiUrl, handleAuthFailure]
  );

  const submitEvaluations = useCallback(
    async (kind: 'self' | 'mgr', rows: Array<{ staffId: string; scores: Record<string, number> }>, period?: string) => {
      if (!template || !tenantId || !token || rows.length === 0) return;
      const response = await fetch(apiUrl(`/api/evaluations/${tenantId}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          templateId: template.id,
          period: period || new Date().toISOString().slice(0, 7),
          evaluatorRole: kind === 'mgr' ? '園長' : '自己',
          evaluations: rows
        })
      });
      if (response.status === 401) {
        handleAuthFailure('セッションの有効期限が切れました。再度ログインしてください。');
        throw new Error('認証が必要です');
      }
      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(
          message ? `failed to save evaluations (${response.status}): ${message}` : `failed to save evaluations (${response.status})`
        );
      }
    },
    [template, tenantId, token, apiUrl, handleAuthFailure]
  );

  const submitEvaluationsRef = useRef(submitEvaluations);
  useEffect(() => {
    submitEvaluationsRef.current = submitEvaluations;
  }, [submitEvaluations]);

  const pendingSavesRef = useRef<{
    self: Map<string, Record<string, number>>;
    mgr: Map<string, Record<string, number>>;
  }>({
    self: new Map(),
    mgr: new Map()
  });

  const flushPendingSaves = useCallback(async (shouldRefresh = true) => {
    const flushFor = async (kind: 'self' | 'mgr') => {
      const map = pendingSavesRef.current[kind];
      if (map.size === 0) return false;
      const snapshot = Array.from(map.entries());
      const payload = snapshot.map(([staffId, scores]) => ({ staffId, scores }));
      try {
        await submitEvaluationsRef.current(kind, payload);
        snapshot.forEach(([staffId, scores]) => {
          if (map.get(staffId) === scores) {
            map.delete(staffId);
          }
        });
        return true;
      } catch (err) {
        console.error('failed to save evaluations', err);
        return false;
      }
    };

    const results = await Promise.allSettled([flushFor('self'), flushFor('mgr')]);
    const anySuccess = results.some((res) => res.status === 'fulfilled' && res.value);
    if (shouldRefresh && anySuccess && isMountedRef.current) {
      await refreshData();
    }
  }, [refreshData]);

  const scheduleFlush = useMemo(() => debounce(() => void flushPendingSaves(), 600), [flushPendingSaves]);
  useEffect(() => {
    return () => {
      void flushPendingSaves(false);
      scheduleFlush.cancel();
    };
  }, [scheduleFlush, flushPendingSaves]);

  useEffect(() => {
    scheduleFlush.flush();
  }, [role, template?.id, tenantId, scheduleFlush]);

  const queueSave = useCallback(
    (kind: 'self' | 'mgr', staffId: string, itemKey: string, score: number) => {
      const bucket = pendingSavesRef.current[kind];
      const existing = bucket.get(staffId) || {};
      bucket.set(staffId, { ...existing, [itemKey]: score });
      scheduleFlush();
    },
    [scheduleFlush]
  );

  const addBlankItem = useCallback(async () => {
    if (!template) {
      setError('テンプレートが存在しません。先にテンプレートを作成してください。');
      return;
    }
    const baseLabel = `新規項目${items.length + 1}`;
    const baseKey = createItemKey(`${baseLabel}_${Date.now()}`);
    const newItem: ItemRow = { item_key: baseKey, label: baseLabel, description: '' };
    const newRow: ItemRow = staff.reduce(
      (acc, current) => {
        acc[`self_${current.id}`] = undefined;
        acc[`mgr_${current.id}`] = undefined;
        return acc;
      },
      { ...newItem }
    );
    const nextItems = [...items, newItem];
    setItems(nextItems);
    setRowData((prev) => [...prev, newRow]);
    try {
      await persistTemplateItems(nextItems);
    } catch {
      await refreshData();
    }
  }, [template, items, staff, persistTemplateItems, refreshData]);

  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);

  const removeSelectedItem = useCallback(async () => {
    if (!selectedItemKey) return;
    const nextItems = items.filter((item) => item.item_key !== selectedItemKey);
    if (nextItems.length === items.length) return;
    setItems(nextItems);
    setRowData((prev) => prev.filter((row) => row.item_key !== selectedItemKey));
    gridRef.current?.api?.deselectAll?.();
    setSelectedItemKey(null);
    try {
      await persistTemplateItems(nextItems);
    } catch {
      await refreshData();
    }
  }, [selectedItemKey, items, persistTemplateItems, refreshData]);

  const onSelectionChanged = useCallback(() => {
    if (!gridRef.current) return;
    const selected = gridRef.current.api?.getSelectedRows?.() || [];
    if (!selected.length) {
      setSelectedItemKey(null);
      return;
    }
    const first = selected[0] as ItemRow;
    if (!first || first.item_key === PLACEHOLDER_KEY) {
      setSelectedItemKey(null);
      return;
    }
    setSelectedItemKey(first.item_key);
  }, []);

  const evaluatorLabel = useMemo(() => (activeEvaluator === 'mgr' ? '園長評価' : '自己評価'), [activeEvaluator]);

  const scoreboardData = useMemo(() => {
    const prefix = activeEvaluator === 'mgr' ? 'mgr' : 'self';
    return staff
      .map((s) => {
        const field = `${prefix}_${s.id}` as keyof ItemRow;
        const total = rowData.reduce((sum, row) => {
          const value = row[field];
          return sum + (typeof value === 'number' ? value : 0);
        }, 0);
        return { staffId: s.id, name: s.name, total };
      })
      .sort((a, b) => b.total - a.total);
  }, [staff, rowData, activeEvaluator]);

  const itemsCount = items.length;

  const maxTotalPerStaff = useMemo(() => {
    if (!template) return 0;
    return (template.max_score || 0) * itemsCount;
  }, [template, itemsCount]);

  const columnDefs: ColDef[] = useMemo(() => {
    const maxScore = template?.max_score ?? 5;
    const prefix = activeEvaluator === 'mgr' ? 'mgr' : 'self';
    const columns: ColDef[] = [
      {
        field: 'label',
        headerName: '評価項目',
        pinned: 'left',
        editable: true,
        width: 220,
        checkboxSelection: (params) => {
          const key = params.data?.item_key;
          return key !== PLACEHOLDER_KEY;
        },
        headerCheckboxSelection: false
      },
      {
        field: 'description',
        headerName: '項目説明',
        pinned: 'left',
        editable: true,
        width: 380,
        wrapText: true,
        autoHeight: true,
        cellStyle: { whiteSpace: 'pre-wrap', lineHeight: '1.4', alignItems: 'flex-start' }
      }
    ];
    for (const s of staff) {
      columns.push({
        field: `${prefix}_${s.id}`,
        headerName: s.name,
        editable: true,
        width: 120,
        checkboxSelection: false,
        valueParser: (p) => clampScore(p.newValue, template?.max_score),
        valueFormatter: (p) => formatScoreCellDisplay(p.value, maxScore)
      });
    }
    return columns;
  }, [staff, template?.max_score, activeEvaluator]);

  const onCellValueChanged = useCallback(
    async (params: any) => {
      const data = params.data as ItemRow | undefined;
      if (!data) return;
      const field = params.colDef.field as string;

      if (data.item_key === PLACEHOLDER_KEY) {
        if (!template) {
          setError('テンプレートが存在しません。先にテンプレートを作成してください。');
          setDraftItemRow(buildPlaceholderRow(staff));
          return;
        }
        if (field !== 'label' && field !== 'description') {
          setDraftItemRow(buildPlaceholderRow(staff));
          return;
        }
        const labelValue = typeof data.label === 'string' ? data.label.trim() : '';
        const descriptionValue = typeof data.description === 'string' ? data.description.trim() : '';
        if (!labelValue && !descriptionValue) {
          setDraftItemRow(buildPlaceholderRow(staff));
          return;
        }
        const baseLabel = labelValue || `新規項目${items.length + 1}`;
        const existingKeys = new Set(items.map((item) => item.item_key));
        const baseKey = createItemKey(baseLabel);
        let itemKey = baseKey;
        let suffix = 1;
        while (existingKeys.has(itemKey)) {
          itemKey = `${baseKey}_${suffix++}`;
        }
        const newItem: ItemRow = { item_key: itemKey, label: baseLabel, description: descriptionValue };
        const newRow: ItemRow = staff.reduce(
          (acc, current) => {
            acc[`self_${current.id}`] = undefined;
            acc[`mgr_${current.id}`] = undefined;
            return acc;
          },
          { ...newItem }
        );
        const nextItems = [...items, newItem];
        setItems(nextItems);
        setRowData((prev) => [...prev, newRow]);
        setDraftItemRow(buildPlaceholderRow(staff));
        setSelectedItemKey(itemKey);
        try {
          await persistTemplateItems(nextItems);
        } catch {
          await refreshData();
        }
        return;
      }

      if (!template) return;

      if (field === 'label' || field === 'description') {
        const key = data.item_key as string;
        const nextValue = typeof params.newValue === 'string' ? params.newValue.trim() : '';
        const updatedItems = items.map((item) =>
          item.item_key === key ? { ...item, [field]: nextValue } : item
        );
        setItems(updatedItems);
        setRowData((prev) =>
          prev.map((row) => (row.item_key === key ? { ...row, [field]: nextValue } : row))
        );
        try {
          await persistTemplateItems(updatedItems);
        } catch {
          await refreshData();
        }
        return;
      }

      const [kind, staffId] = parseKind(field);
      if (!kind || !staffId) return;
      const score = clampScore(params.newValue, template.max_score);
      const safeScore = typeof score === 'number' ? score : 0;
      setRowData((prev) =>
        prev.map((row) => (row.item_key === data.item_key ? { ...row, [field]: score } : row))
      );
      queueSave(kind, staffId, data.item_key, safeScore);
    },
    [template, staff, items, persistTemplateItems, refreshData, queueSave]
  );

  const columnsReady = columnDefs.length > 0;

  const onExport = useCallback(() => {
    exportGridToXlsx(
      {
        templateMeta: template,
        items,
        staff,
        rows: rowData
      },
      `export_${role}.xlsx`
    );
  }, [template, items, staff, rowData, role]);

  const handleApplyFromDify = useCallback(
    async (payload: DifyResult) => {
      const labelBase = payload.itemName.trim().slice(0, 80) || `AI提案${items.length + 1}`;
      const description = formatEvaluationDescription(payload);
      const existingKeys = new Set(items.map((item) => item.item_key));
      const baseKey = createItemKey(labelBase);
      let itemKey = baseKey;
      let suffix = 1;
      while (existingKeys.has(itemKey)) {
        itemKey = `${baseKey}_${suffix++}`;
      }
      const newItem: ItemRow = { item_key: itemKey, label: labelBase, description };
      const newRow: ItemRow = staff.reduce(
        (acc, current) => {
          acc[`self_${current.id}`] = undefined;
          acc[`mgr_${current.id}`] = undefined;
          return acc;
        },
        { ...newItem }
      );
      const nextItems = [...items, newItem];
      setItems(nextItems);
      setRowData((prev) => [...prev, newRow]);
      setShowDify(false);
      try {
        await persistTemplateItems(nextItems);
      } catch {
        await refreshData();
      }
    },
    [items, staff, persistTemplateItems, refreshData]
  );

  return (
    <div className="page-container">
      <header className="topbar">
        <label className="inline">
          <span>ロール</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} disabled={loading}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          <span>評価タイプ</span>
          <select
            value={activeEvaluator}
            onChange={(e) => setActiveEvaluator(e.target.value as EvalKind)}
            disabled={loading}
          >
            <option value="self">自己評価</option>
            <option value="mgr">園長評価</option>
          </select>
        </label>
        <button onClick={onExport} disabled={!template || rowData.length === 0}>
          Export XLSX
        </button>
        <button onClick={addBlankItem} disabled={!template || savingItems}>
          評価項目を追加
        </button>
        <button onClick={removeSelectedItem} disabled={!template || !selectedItemKey || savingItems}>
          選択項目を削除
        </button>
        <button onClick={() => setShowScoreboard(true)} disabled={rowData.length === 0}>
          合計スコア
        </button>
        <button onClick={() => setShowDify(true)} disabled={!template}>
          AI生成
        </button>
        {creatingStaff && <span>職員登録中…</span>}
        {savingItems && <span>保存中…</span>}
        {loading && <span>読込中…</span>}
        {error && <span style={{ color: '#c00' }}>{error}</span>}
      </header>

      <div className="grid-wrap">
        <div className="ag-theme-quartz ag-grid">
          {columnsReady && (
            <AgGridReact
              ref={gridRef}
              columnDefs={columnDefs}
              rowData={gridRows}
              suppressDragLeaveHidesColumns
              singleClickEdit
              stopEditingWhenCellsLoseFocus
              enterNavigatesVerticallyAfterEdit
              onCellValueChanged={onCellValueChanged}
              onSelectionChanged={onSelectionChanged}
              rowSelection={{ mode: 'singleRow' }}
              getRowId={(params) => params.data.item_key}
              isRowSelectable={(node) => {
                const key = node?.data?.item_key;
                return key !== PLACEHOLDER_KEY;
              }}
              defaultColDef={{ resizable: true }}
            />
          )}
        </div>
      </div>

      {showDify && template && tenantId && (
        <DifyModal
          onClose={() => setShowDify(false)}
          onApply={handleApplyFromDify}
          tenantId={tenantId}
          role={role}
          apiBase={API_BASE}
          token={token || ''}
        />
      )}

      {showScoreboard && (
        <div className="scoreboard-backdrop">
          <div className="scoreboard-panel">
            <h3>{`合計スコア (${evaluatorLabel})`}</h3>
            {maxTotalPerStaff > 0 && (
              <p className="scoreboard-sub">{`最大 ${maxTotalPerStaff} 点 / ${itemsCount} 項目`}</p>
            )}
            <ol>
              {scoreboardData.map((row, index) => (
                <li key={row.staffId}>
                  <span className="rank">{index + 1}.</span>
                  <span className="name">{row.name}</span>
                  <span className="score">
                    {maxTotalPerStaff > 0 ? `${row.total} / ${maxTotalPerStaff}` : row.total}
                  </span>
                </li>
              ))}
              {scoreboardData.length === 0 && <li>スコアがありません</li>}
            </ol>
            <button onClick={() => setShowScoreboard(false)} className="close-button">
              閉じる
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .page-container {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          padding: 1rem;
          gap: 1rem;
          background: #f8f9fb;
        }
        .topbar {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
        }
        .inline {
          display: inline-flex;
          gap: 6px;
          align-items: center;
        }
        .grid-wrap {
          flex: 1;
          min-height: 0;
        }
        .ag-grid {
          height: 70vh;
          width: 100%;
        }
        .scoreboard-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.35);
          display: grid;
          place-items: center;
          z-index: 1200;
        }
        .scoreboard-panel {
          background: #fff;
          padding: 20px;
          border-radius: 12px;
          min-width: 280px;
          max-width: 360px;
          box-shadow: 0 18px 34px rgba(15, 23, 42, 0.18);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .scoreboard-panel ol {
          margin: 0;
          padding-left: 1.2rem;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .scoreboard-panel li {
          display: flex;
          justify-content: space-between;
          gap: 8px;
        }
        .scoreboard-panel .rank {
          width: 2ch;
        }
        .scoreboard-panel .name {
          flex: 1;
        }
        .scoreboard-panel .score {
          font-weight: bold;
        }
        .scoreboard-sub {
          margin: 0;
          font-size: 0.85rem;
          color: #374151;
        }
        .close-button {
          align-self: flex-end;
          padding: 8px 16px;
          border: none;
          border-radius: 6px;
          background: #2563eb;
          color: #fff;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

function parseKind(field: string | undefined): [EvalKind, string] | [null, null] {
  if (!field) return [null, null];
  const m = field.match(/^(self|mgr)_(.+)$/);
  return m ? [m[1] as EvalKind, m[2]] : [null, null];
}


function formatScoreCellDisplay(value: unknown, maxScore: number) {
  if (value === null || value === undefined || value === '') {
    return `/${maxScore}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value === 0 ? `/${maxScore}` : `${value}/${maxScore}`;
  }
  const text = String(value).trim();
  if (!text) return `/${maxScore}`;
  const [portion] = text.split('/');
  const numeric = Number(portion.trim());
  if (!Number.isFinite(numeric) || numeric === 0) return `/${maxScore}`;
  return `${numeric}/${maxScore}`;
}

function clampScore(value: any, max?: number) {
  if (value === null || value === undefined) return undefined;
  let candidate: any = value;
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) return undefined;
    const [portion] = trimmed.split('/');
    candidate = Number(portion.trim());
  }
  const n = typeof candidate === 'number' ? candidate : Number(candidate);
  if (!Number.isFinite(n)) return undefined;
  if (max == null) return n;
  return Math.max(0, Math.min(max, n));
}

function createItemKey(label: string) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || `item_${Date.now()}`;
}

function formatEvaluationDescription(payload: DifyResult) {
  return (payload.itemDescription || payload.itemName).trim();
}
