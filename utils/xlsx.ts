import * as XLSX from 'xlsx';

export type ImportResult = {
  templateMeta: { period?: string };
  items: { item_key: string; label: string; description: string }[];
  evaluations: {
    staffName: string;
    kind: 'self' | 'mgr';
    scores: Record<string, number>;
  }[];
};

type ExportGridData = {
  templateMeta: any;
  items: { item_key: string; label: string; description: string }[];
  staff: { id: string; name: string }[];
  rows: Array<Record<string, any>>;
};

export function exportGridToXlsx(gridData: ExportGridData, filename: string) {
  const { items, staff, rows } = gridData;
  const rowByKey = new Map(rows.map((row) => [row.item_key, row]));

  const header = [
    'item_key',
    'label',
    'description',
    ...staff.map((s) => `self_${s.name}`),
    ...staff.map((s) => `mgr_${s.name}`)
  ];

  const data = items.map((item) => {
    const row = rowByKey.get(item.item_key) || {};
    const record: Record<string, any> = {
      item_key: item.item_key,
      label: item.label,
      description: item.description
    };
    for (const s of staff) {
      record[`self_${s.name}`] = row[`self_${s.id}`] ?? '';
    }
    for (const s of staff) {
      record[`mgr_${s.name}`] = row[`mgr_${s.id}`] ?? '';
    }
    return record;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data, { header });
  XLSX.utils.book_append_sheet(wb, ws, 'scores');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function importXlsxFile(file: File): Promise<ImportResult> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const table = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
  if (!table.length) {
    return { templateMeta: {}, items: [], evaluations: [] };
  }

  const header = table[0].map((cell) => String(cell || ''));
  const rows = table.slice(1);

  const idxKey = header.indexOf('item_key');
  const idxLabel = header.indexOf('label');
  const idxDesc = header.indexOf('description');

  const items = rows
    .filter((r) => r.length >= 3 && r[idxKey] != null)
    .map((r) => ({
      item_key: String(r[idxKey]),
      label: String(r[idxLabel] ?? ''),
      description: String(r[idxDesc] ?? '')
    }));

  const evaluationsMap = new Map<string, { staffName: string; kind: 'self' | 'mgr'; scores: Record<string, number> }>();

  rows.forEach((row) => {
    const itemKey = String(row[idxKey] ?? '');
    if (!itemKey) return;
    header.forEach((col, colIndex) => {
      const kind = col.startsWith('self_') ? 'self' : col.startsWith('mgr_') ? 'mgr' : null;
      if (!kind) return;
      const staffName = col.replace(/^self_|^mgr_/, '');
      const raw = row[colIndex];
      const score = Number(raw);
      if (Number.isNaN(score)) return;
      const mapKey = `${kind}:${staffName}`;
      if (!evaluationsMap.has(mapKey)) {
        evaluationsMap.set(mapKey, { staffName, kind, scores: {} });
      }
      evaluationsMap.get(mapKey)!.scores[itemKey] = score;
    });
  });

  return {
    templateMeta: {},
    items,
    evaluations: Array.from(evaluationsMap.values())
  };
}
