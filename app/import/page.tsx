// app/import/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  reportdate?: string; // YYYY-MM-DD
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

const REQUIRED_FIELDS_LABEL = 'Solicitud/Aviso, Punto de Venta, Estado';

const normStr = (v?: unknown): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : (v !== undefined && v !== null ? String(v) : '');

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Convierte celda a YYYY-MM-DD (sin hora) */
const toLocalDateISO = (cell: unknown): string | undefined => {
  if (cell instanceof Date && !isNaN(cell.getTime())) {
    const y = cell.getFullYear();
    const m = pad2(cell.getMonth() + 1);
    const d = pad2(cell.getDate());
    return `${y}-${m}-${d}`;
  }
  if (typeof cell === 'number') {
    const parts = XLSX.SSF.parse_date_code(cell);
    if (parts) return `${parts.y}-${pad2(parts.m)}-${pad2(parts.d)}`;
  }
  if (typeof cell === 'string') {
    const s = cell.trim();
    const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m1) return `${m1[3]}-${pad2(+m1[2])}-${pad2(+m1[1])}`;
    const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m2) return s;
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
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });

  const get = (row: Record<string, unknown>, key: ColumnKey) => {
    const label = KEY_TO_LABEL[key];
    if (Object.prototype.hasOwnProperty.call(row, label)) return row[label];
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
    return '';
  };

  return rows
    .map((r) => {
      const dateISO = toLocalDateISO(get(r, 'reportdate'));
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
      Object.keys(out).forEach((k) => ((out as ReportRow)[k] === undefined) && delete (out as ReportRow)[k]);
      return out;
    })
    .filter((row) => Object.values(row).some((v) => v !== '' && v !== undefined && v !== null));
}

type POSPreviewResponse = {
  success?: boolean;
  totalUnique?: number;
  newCount?: number;
  newNames?: string[];
  error?: string;
};

type ImportAPIResponse = {
  success?: boolean;
  importedCount?: number;
  createdPOS?: number;
  skippedExistingRequests?: string[];
  invalidRows?: { request?: string; reason?: string }[];
  error?: string;
};

/** Toast de error (failure) */
function showFailureDiv(message: string) {
  const div = document.createElement('div');
  div.className =
    'fixed bottom-4 right-4 bg-red-600 text-white p-4 rounded-lg shadow-lg flex items-center gap-3 opacity-0 transition-opacity duration-500 z-50';
  div.innerHTML = `
    <svg class="w-6 h-6 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M12 9v4m0 4h.01M10.29 3.86l-8.48 14.7A2 2 0 003.53 22h16.94a2 2 0 001.72-3.44l-8.48-14.7a2 2 0 00-3.42 0z"/>
    </svg>
    <span class="text-sm font-medium">${message}</span>
  `;
  document.body.appendChild(div);
  requestAnimationFrame(() => div.classList.add('opacity-100'));
  setTimeout(() => {
    div.classList.remove('opacity-100');
    setTimeout(() => div.remove(), 500);
  }, 3500);
}

export default function ImportPage() {
  const router = useRouter();
  const [user, loading] = useAuthState(auth);

  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [posList, setPosList] = useState<string[]>([]);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // preview POS nuevos (si usas el endpoint /pos-preview)
  const [newPOSCount, setNewPOSCount] = useState<number>(0);
  const [newPOSNames, setNewPOSNames] = useState<string[]>([]);

  // detalles del import
  const [serverInvalid, setServerInvalid] = useState<ImportAPIResponse['invalidRows']>([]);
  const [serverDupReqs, setServerDupReqs] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const canImport = useMemo(() => rows.length > 0, [rows.length]);

  const resetSelections = () => {
    setRows([]);
    setPosList([]);
    setNewPOSCount(0);
    setNewPOSNames([]);
    setStatus('');
    setServerInvalid([]);
    setServerDupReqs([]);
  };

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    resetSelections();
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    resetSelections();
  };

  const handlePreview = async () => {
    if (!file) return;
    setBusy(true);
    setStatus('Leyendo archivo…');
    setServerInvalid([]);
    setServerDupReqs([]);
    setNewPOSCount(0);
    setNewPOSNames([]);

    try {
      const data = await readExcel(file);

      // POS únicos en el archivo (case-insensitive)
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

      // Preview de POS nuevos (si existe el endpoint)
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('token ausente');
        const res = await fetch('/api/admin-import-reports/pos-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ names: uniques }),
        });
        const json: POSPreviewResponse = await res.json();
        if (res.ok && json.success) {
          setNewPOSCount(json.newCount || 0);
          setNewPOSNames(json.newNames || []);
          setStatus(
            `Filas: ${data.length}. Puntos de Venta únicos: ${uniques.length}. ` +
            `Nuevos a crear: ${json.newCount || 0}.`
          );
        } else {
          setStatus(`Filas: ${data.length}. Puntos de Venta únicos: ${uniques.length}.`);
        }
      } catch {
        setStatus(`Filas: ${data.length}. Puntos de Venta únicos: ${uniques.length}.`);
      }
    } catch (e) {
      setStatus(`Error al leer: ${(e as Error)?.message || 'desconocido'}`);
      showFailureDiv('No se pudo leer el archivo.');
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!canImport) return;
    setBusy(true);
    setStatus('Importando…');
    setServerInvalid([]);
    setServerDupReqs([]);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('No se pudo obtener token');

      const res = await fetch('/api/admin-import-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reports: rows }),
      });

      const json: ImportAPIResponse = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Falló importación');

      setServerInvalid(json.invalidRows || []);
      setServerDupReqs(json.skippedExistingRequests || []);

      const dup = (json.skippedExistingRequests || []).length;
      const inv = (json.invalidRows || []).length;

      setStatus(
        `OK. Importados ${json.importedCount ?? 0} reportes. Puntos de Venta nuevos: ${json.createdPOS ?? 0}. ` +
        `Duplicados (Solicitud/Aviso): ${dup}. Inválidos: ${inv}.`
      );

      if ((dup + inv) > 0) {
        showFailureDiv(`No se importaron ${dup + inv} reportes (Duplicados: ${dup}, Inválidos: ${inv}).`);
      }
    } catch (e) {
      const msg = (e as Error)?.message || 'desconocido';
      setStatus(`Error: ${msg}`);
      showFailureDiv(`Error al importar: ${msg}`);
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

      {/* Card principal: ahora es relative para posicionar el tooltip abajo-derecha */}
      <div className="z-10 bg-white w-full max-w-xl p-6 rounded-2xl shadow-xl relative">
        <h1 className="text-2xl font-bold text-gray-800 mb-4">Importar Reportes (Excel)</h1>

        <div className="space-y-4">
          {/* Selector de archivo */}
          <div>
            <label htmlFor="excel-file" className="block text-sm font-medium text-gray-700">
              Archivo Excel (.xlsx / .xls)
            </label>

            <div className="relative mt-1">
              <input
                id="excel-file"
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={onPick}
                className="sr-only"
              />

              <label
                htmlFor="excel-file"
                className="flex items-center justify-between gap-3 w-full rounded-xl border border-gray-300 bg-white py-2.5 pl-3 pr-12 text-gray-900 cursor-pointer shadow-sm hover:border-gray-400 focus-within:ring-2 focus-within:ring-indigo-500"
              >
                <span className="truncate">
                  {file ? file.name : 'Seleccionar archivo'}
                </span>
                <span className="inline-flex items-center px-3 py-1 rounded-md bg-indigo-600 text-white text-sm font-medium">
                  Buscar…
                </span>
              </label>

              {/* Botón X para limpiar archivo */}
              {file && (
                <button
                  type="button"
                  onClick={clearFile}
                  aria-label="Quitar archivo"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 inline-flex items-center justify-center rounded-full bg-gray-200 hover:bg-gray-300 text-gray-700 shadow"
                >
                  ×
                </button>
              )}
            </div>
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

          {/* Previsualización */}
          {rows.length > 0 && (
            <div className="text-sm text-gray-700">
              <p>Filas leídas: <strong>{rows.length}</strong></p>
              <p>
                Puntos de Venta únicos: <strong>{posList.length}</strong>
                {typeof newPOSCount === 'number' && (
                  <span> | Nuevos a crear: <strong>{newPOSCount}</strong></span>
                )}
              </p>
              {!!newPOSNames.length && (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer font-semibold text-gray-900">
                    Ver Puntos de Venta nuevos
                  </summary>
                  <div className="mt-2 max-h-40 overflow-auto rounded-xl border border-gray-300 bg-white p-2 shadow-sm">
                    {newPOSNames.map((p) => (
                      <div key={p} className="py-0.5">{p}</div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Resumen / estado */}
          {!!status && (
            <div className="mt-3 p-3 rounded-xl bg-gray-50 text-gray-800 text-sm border border-gray-200">
              {status}
            </div>
          )}

          {/* Duplicados */}
          {!!serverDupReqs.length && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer font-semibold text-gray-900">
                Duplicados (Solicitud/Aviso)
              </summary>
              <div className="mt-2 max-h-40 overflow-auto rounded-xl border border-gray-300 bg-white p-2 shadow-sm">
                {serverDupReqs.map((r) => (
                  <div key={r} className="py-1">
                    <span className="font-semibold text-gray-900">{r}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Inválidos */}
          {!!(serverInvalid && serverInvalid.length) && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer font-semibold text-gray-900">
                Inválidos (faltan campos / fecha inválida)
              </summary>
              <div className="mt-2 max-h-48 overflow-auto rounded-xl border border-gray-300 bg-white p-2 shadow-sm">
                {serverInvalid.map((it, idx) => (
                  <div key={`${it.request || 'fila'}-${idx}`} className="py-1">
                    <span className="font-semibold text-gray-900">
                      {it.request ?? '(sin solicitud)'}
                    </span>
                    <span className="text-gray-700"> — {it.reason || 'inválido'}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* CHIP + TOOLTIP abajo-derecha (solo si hay errores). Sale hacia ARRIBA */}
        {(serverInvalid?.length || serverDupReqs.length) ? (
          <div className="absolute bottom-2 right-2 group select-none z-20">
            <div
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5"
              aria-hidden="true"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2a10 10 0 100 20 10 10 0 000-20Zm.75 6.5a.75.75 0 11-1.5 0 .75.75 0 011.5 0ZM11 10.25a1 1 0 012 0v6a1 1 0 11-2 0v-6Z" />
              </svg>
              <span>Info</span>
            </div>
            <div className="pointer-events-none absolute bottom-full right-0 mb-2 w-max max-w-xs rounded-md bg-gray-900 text-white text-xs px-2.5 py-1.5 opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 shadow-lg">
              Los campos obligatorios son: <strong>{REQUIRED_FIELDS_LABEL}</strong>.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
