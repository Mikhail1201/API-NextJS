// app/import/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/app/firebase/config';
import { useAuthState } from 'react-firebase-hooks/auth';
import * as XLSX from 'xlsx';

type ColumnKey =
  | 'request'
  | 'number'
  | 'reportdate'
  | 'description'
  | 'pointofsell'
  | 'quotation'
  | 'deliverycertificate'
  | 'state'
  | 'bill'
  | 'servicename'
  | 'servicedescription'
  | 'asesorias';

interface ReportRow {
  request?: string;
  number?: string;
  reportdate?: string; // YYYY-MM-DD (sin hora)
  description?: string;
  pointofsell?: string;
  quotation?: string;
  deliverycertificate?: string;
  state?: string;
  bill?: string;
  servicename?: string;
  servicedescription?: string;
  asesorias?: string;
  [key: string]: string | undefined;
}

const KEY_TO_LABEL: Record<ColumnKey, string> = {
  request: 'Solicitud/Aviso',
  number: 'Presupuesto',
  reportdate: 'Fecha de Reporte',
  description: 'Descripción',
  pointofsell: 'Punto de Venta',
  quotation: 'Cotización',
  deliverycertificate: 'Acta de Entrega',
  state: 'Estado',
  bill: 'Factura',
  servicename: 'Nombre del Servicio',
  servicedescription: 'Descripción del Servicio',
  asesorias: 'Asesorías',
};

const normStr = (v?: unknown): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : (v !== undefined && v !== null ? String(v) : '');

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Convierte celda de fecha a YYYY-MM-DD “pura” (sin hora) */
const toLocalDateISO = (cell: unknown): string | undefined => {
  // 1) Date nativa (SheetJS si cellDates: true)
  if (cell instanceof Date && !isNaN(cell.getTime())) {
    const y = cell.getFullYear();
    const m = pad2(cell.getMonth() + 1);
    const d = pad2(cell.getDate());
    return `${y}-${m}-${d}`;
  }
  // 2) Serial Excel (número)
  if (typeof cell === 'number') {
    const parts = XLSX.SSF.parse_date_code(cell);
    if (parts) {
      const y = parts.y;
      const m = pad2(parts.m);
      const d = pad2(parts.d);
      return `${y}-${m}-${d}`;
    }
  }
  // 3) String habitual
  if (typeof cell === 'string') {
    const s = cell.trim();
    // DD/MM/YYYY
    const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m1) {
      const d = pad2(Number(m1[1]));
      const mo = pad2(Number(m1[2]));
      const y = Number(m1[3]);
      return `${y}-${mo}-${d}`;
    }
    // YYYY-MM-DD
    const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m2) return s;
    // Último intento
    const t = Date.parse(s);
    if (!isNaN(t)) {
      const dt = new Date(t);
      return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
    }
  }
  return undefined;
};

async function readExcel(file: File): Promise<ReportRow[]> {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: true,
  });

  const get = (row: Record<string, unknown>, key: ColumnKey) => {
    const label = KEY_TO_LABEL[key];
    if (Object.prototype.hasOwnProperty.call(row, label)) return row[label];
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
    return '';
  };

  return rows
    .map((r) => {
      const dateCell = get(r, 'reportdate');
      const dateISO = toLocalDateISO(dateCell);

      const out: Record<string, string | undefined> = {
        request: normStr(get(r, 'request')),
        number: normStr(get(r, 'number')),
        reportdate: dateISO,
        description: normStr(get(r, 'description')),
        pointofsell: normStr(get(r, 'pointofsell')),
        quotation: normStr(get(r, 'quotation')),
        deliverycertificate: normStr(get(r, 'deliverycertificate')),
        state: normStr(get(r, 'state')),
        bill: normStr(get(r, 'bill')),
        servicename: normStr(get(r, 'servicename')),
        servicedescription: normStr(get(r, 'servicedescription')),
        asesorias: normStr(get(r, 'asesorias')),
      };
      // Quita undefineds
      Object.keys(out).forEach((k) => ((out as ReportRow)[k] === undefined) && delete (out as ReportRow)[k]);
      return out;
    })
    .filter((row) => Object.values(row).some((v) => v !== '' && v !== undefined && v !== null));
}

export default function ImportPage() {
  const router = useRouter();
  const [user, loading] = useAuthState(auth);

  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [posList, setPosList] = useState<string[]>([]);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const canImport = useMemo(() => rows.length > 0, [rows.length]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setRows([]);
    setPosList([]);
    setStatus('');
  };

  const handlePreview = async () => {
    if (!file) return;
    setBusy(true);
    setStatus('Leyendo archivo…');
    try {
      const data = await readExcel(file);
      const seen = new Set<string>();
      const uniques: string[] = [];
      data.forEach((r) => {
        const pos = (r.pointofsell || '').trim();
        if (!pos) return;
        const key = pos.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          uniques.push(pos);
        }
      });
      setRows(data);
      setPosList(uniques);
      setStatus(`Filas: ${data.length}. Puntos de Venta únicos: ${uniques.length}.`);
    } catch (e) {
      setStatus(`Error al leer: ${(e as Error)?.message || 'desconocido'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!canImport) return;
    setBusy(true);
    setStatus('Importando…');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('No se pudo obtener token');

      const res = await fetch('/api/admin-import-reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reports: rows }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string })?.error || 'Falló importación');

      const { importedCount, createdPOS } = json as { importedCount?: number; createdPOS?: number };
      setStatus(`OK. Importados ${importedCount} reportes. POS nuevos: ${createdPOS}.`);
    } catch (e) {
      setStatus(`Error: ${(e as Error)?.message || 'desconocido'}`);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !user) return null;

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 overflow-hidden">
      {/* Volver */}
      <button
        onClick={() => router.push('/')}
        className="absolute top-4 left-4 z-20 bg-white/90 hover:bg-white text-blue-600 p-3 rounded-full shadow-md transition cursor-pointer"
        aria-label="Volver al inicio"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div className="z-10 bg-white w-full max-w-xl p-6 rounded-2xl shadow-xl">
        <h1 className="text-2xl font-bold text-gray-800 mb-4">Importar Reportes (Excel)</h1>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Archivo Excel (.xlsx / .xls)</label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={onPick}
              className="w-full p-3 rounded-lg border border-gray-300 text-gray-900 bg-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handlePreview}
              disabled={!file || busy}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg disabled:bg-gray-300 disabled:text-gray-700 disabled:cursor-not-allowed"
            >
              {busy ? 'Procesando…' : 'Previsualizar'}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={!canImport || busy}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-lg disabled:bg-gray-300 disabled:text-gray-700 disabled:cursor-not-allowed"
            >
              {busy ? 'Importando…' : 'Importar'}
            </button>
          </div>

          {rows.length > 0 && (
            <div className="text-sm text-gray-700">
              <p>Filas leídas: <strong>{rows.length}</strong></p>
              <p>Puntos de Venta únicos: <strong>{posList.length}</strong></p>
              {!!posList.length && (
                <div className="mt-2 max-h-40 overflow-auto border rounded p-2">
                  {posList.map((p) => <div key={p} className="py-0.5">{p}</div>)}
                </div>
              )}
            </div>
          )}

          {!!status && (
            <div className="mt-3 p-3 rounded bg-gray-100 text-gray-800 text-sm">
              {status}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
