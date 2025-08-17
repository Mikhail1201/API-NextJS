'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/app/firebase/config';
import { useAuthState } from 'react-firebase-hooks/auth';
import { saveAs } from 'file-saver';
import XlsxPopulate from 'xlsx-populate/browser/xlsx-populate';

// ==== Tipos y constantes ====
type ExportMode = 'until' | 'day' | 'range' | 'month' | null;

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

interface Report {
  id: string;
  request?: string;
  number?: string;
  reportdate?: string | { seconds: number };
  description?: string;
  pointofsell?: string;
  quotation?: string;
  deliverycertificate?: string;
  state?: string;
  bill?: string;
  servicename?: string;
  servicedescription?: string;
  asesorias?: string;
  [key: string]: unknown;
}

interface UserPrefs {
  stateColors: Record<string, string>;
  columnOrder?: ColumnKey[];
}

const ALLOWED_COL_KEYS: ColumnKey[] = [
  'request',
  'number',
  'reportdate',
  'description',
  'pointofsell',
  'quotation',
  'deliverycertificate',
  'state',
  'bill',
  'servicename',
  'servicedescription',
  'asesorias',
];

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

// ==== Utilidades ====
const toMillis = (d?: Report['reportdate']): number | null => {
  if (!d) return null;
  if (typeof d === 'string') {
    const t = Date.parse(d);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof d === 'object' && typeof d.seconds === 'number') {
    return d.seconds * 1000;
  }
  return null;
};

const formatDateEs = (ms?: number | null): string => {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString('es-CO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};

const sanitizeOrder = (order?: ColumnKey[]): ColumnKey[] => {
  const seen = new Set<ColumnKey>();
  const out: ColumnKey[] = [];
  if (Array.isArray(order)) {
    for (const k of order) {
      if (ALLOWED_COL_KEYS.includes(k) && !seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  for (const base of ALLOWED_COL_KEYS) {
    if (!seen.has(base)) out.push(base);
  }
  return out;
};

// A->Z, AA...
const colLetter = (n: number): string => {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

// #RRGGBB -> 'RRGGBB'
const normalizeHexNoHash = (hex?: string): string | null => {
  if (!hex) return null;
  let h = hex.trim().toUpperCase();
  if (h.startsWith('#')) h = h.slice(1);
  if (/^[0-9A-F]{6}$/.test(h)) return h;
  return null;
};

// Para texto legible: blanco sobre colores oscuros, negro sobre claros
const textForBg = (hexNoHash: string): 'FFFFFF' | '000000' => {
  const r = parseInt(hexNoHash.slice(0, 2), 16);
  const g = parseInt(hexNoHash.slice(2, 4), 16);
  const b = parseInt(hexNoHash.slice(4, 6), 16);
  // luminancia relativa aproximada
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 140 ? 'FFFFFF' : '000000';
};

// ==== Llamado a la API de preferencias ====
const fetchUserPrefs = async (): Promise<UserPrefs | null> => {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return null;
    const res = await fetch('/api/admin-user-prefs', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as UserPrefs;
    return {
      stateColors: json?.stateColors || {},
      columnOrder: json?.columnOrder ? sanitizeOrder(json.columnOrder) : undefined,
    };
  } catch {
    return null;
  }
};

export default function ExportReportsPage() {
  const router = useRouter();
  const [user, loading] = useAuthState(auth);

  const [mode, setMode] = useState<ExportMode>(null);

  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [rangeStart, setRangeStart] = useState<string>(todayStr);
  const [rangeEnd, setRangeEnd] = useState<string>(todayStr);
  const ym = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState<string>(ym);

  const [exporting, setExporting] = useState<boolean>(false);

  // ==== Exportar con xlsx-populate ====
  const exportWithStyles = async (data: Report[], fileName: string, prefs: UserPrefs | null) => {
    const order = sanitizeOrder(prefs?.columnOrder);
    const lastColIndex = order.length;
    const lastCol = colLetter(lastColIndex);

    // Mapa de colores por estado (case-insensitive)
    const ciColors: Record<string, string> = {};
    Object.entries(prefs?.stateColors || {}).forEach(([k, v]) => {
      const hex = normalizeHexNoHash(v);
      if (hex) ciColors[k.toLowerCase()] = hex;
    });

    // Crear libro
    const workbook = await XlsxPopulate.fromBlankAsync();
    const ws = workbook.sheet(0).name('Reportes');

    // Encabezados
    order.forEach((key, idx) => {
      const c = idx + 1;
      ws.cell(1, c).value(KEY_TO_LABEL[key]).style({
        bold: true,
        fill: 'DDE5FF', // azulito suave para header
        border: true,
      });
      // ancho aproximado por tipo
      ws.column(c).width(Math.max(14, KEY_TO_LABEL[key].length + 4));
    });

    // Filas de datos
    data.forEach((r, i) => {
      const row = i + 2;
      const ms = toMillis(r.reportdate);
      const valuesByKey: Record<ColumnKey, unknown> = {
        request: r.request ?? '',
        number: r.number ?? '',
        reportdate: formatDateEs(ms),
        description: r.description ?? '',
        pointofsell: r.pointofsell ?? '',
        quotation: r.quotation ?? '',
        deliverycertificate: r.deliverycertificate ?? '',
        state: r.state ?? '',
        bill: r.bill ?? '',
        servicename: r.servicename ?? '',
        servicedescription: r.servicedescription ?? '',
        asesorias: r.asesorias ?? '',
      };

      // Escribir celdas en el orden preferido
      order.forEach((key, idx) => {
        ws.cell(row, idx + 1).value(valuesByKey[key] as string);
      });

      // Pintar la fila completa (A..lastCol) si hay color para el estado
      const estadoVal = String(r.state ?? '').toLowerCase();
      const fillHex = ciColors[estadoVal] || null;
      if (fillHex) {
        const textHex = textForBg(fillHex);
        const rng = ws.range(`A${row}:${lastCol}${row}`);
        rng.style({ fill: fillHex, fontColor: textHex });
      }
    });

    // Congelar encabezados
    ws.freezePanes(2, 1);

    // Hoja 2: leyenda de colores
    const entries = Object.entries(prefs?.stateColors || {});
    if (entries.length) {
      const legend = workbook.addSheet('Colores por Estado');
      legend.cell(1, 1).value('Estado').style({ bold: true, border: true, fill: 'EFEFEF' });
      legend.cell(1, 2).value('HEX').style({ bold: true, border: true, fill: 'EFEFEF' });
      legend.column(1).width(24);
      legend.column(2).width(12);

      entries.forEach(([estado, hex], idx) => {
        const row = idx + 2;
        const norm = normalizeHexNoHash(hex) || 'FFFFFF';
        legend.cell(row, 1).value(estado).style({ border: true });
        legend.cell(row, 2).value(`#${norm}`).style({ border: true });
        legend.range(`A${row}:B${row}`).style({ fill: norm, fontColor: textForBg(norm) });
      });
    }

    const blob = await workbook.outputAsync();
    saveAs(blob, `${fileName}.xlsx`);
  };

  // ==== API helpers ====
  const fetchReportsUntil = async (untilDateISO: string): Promise<Report[]> => {
    const res = await fetch('/api/admin-export-reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedDate: untilDateISO,
        onlyThatDay: false,
        userId: user?.uid,
        userEmail: user?.email,
        mode: 'until',
      }),
    });
    const data = await res.json();
    return data.success ? (data.reports as Report[]) : [];
  };

  const fetchReportsOnlyDay = async (dayISO: string): Promise<Report[]> => {
    const res = await fetch('/api/admin-export-reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedDate: dayISO,
        onlyThatDay: true,
        userId: user?.uid,
        userEmail: user?.email,
        mode: 'day',
      }),
    });
    const data = await res.json();
    return data.success ? (data.reports as Report[]) : [];
  };

  // ==== Export según modo (lee prefs primero) ====
  const handleExport = async () => {
    if (!mode) return;
    setExporting(true);
    try {
      const prefs = await fetchUserPrefs();

      if (mode === 'until') {
        if (!selectedDate) return;
        const reports = await fetchReportsUntil(selectedDate);
        await exportWithStyles(reports, `reportes_hasta_${selectedDate}`, prefs);
        return;
      }

      if (mode === 'day') {
        if (!selectedDate) return;
        const reports = await fetchReportsOnlyDay(selectedDate);
        await exportWithStyles(reports, `reportes_solo_${selectedDate}`, prefs);
        return;
      }

      if (mode === 'range') {
        if (!rangeStart || !rangeEnd) return;
        const reports = await fetchReportsUntil(rangeEnd);
        const startMs = Date.parse(rangeStart);
        const endMs = Date.parse(rangeEnd) + 24 * 60 * 60 * 1000 - 1;
        const filtered = reports.filter((r) => {
          const ms = toMillis(r.reportdate);
          return typeof ms === 'number' && ms >= startMs && ms <= endMs;
        });
        await exportWithStyles(filtered, `reportes_${rangeStart}_a_${rangeEnd}`, prefs);
        return;
      }

      if (mode === 'month') {
        if (!selectedMonth) return;
        const [y, m] = selectedMonth.split('-').map(Number);
        const first = new Date(y, (m ?? 1) - 1, 1);
        const last = new Date(y, (m ?? 1), 0);
        const lastISO = last.toISOString().split('T')[0];

        const reports = await fetchReportsUntil(lastISO);

        const startMs = first.getTime();
        const endMs = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999).getTime();
        const filtered = reports.filter((r) => {
          const ms = toMillis(r.reportdate);
          return typeof ms === 'number' && ms >= startMs && ms <= endMs;
        });

        await exportWithStyles(filtered, `reportes_mes_${selectedMonth}`, prefs);
        return;
      }
    } finally {
      setExporting(false);
    }
  };

  const baseBtn =
    'cursor-pointer w-full font-semibold py-3 rounded-lg transition text-white disabled:bg-gray-300 disabled:text-gray-700 disabled:cursor-not-allowed';

  const modeBtn = (m: Exclude<ExportMode, null>, color: string, hover: string) =>
    `${baseBtn} ${mode === m ? 'bg-gray-300 text-gray-700' : `${color} ${hover}`}`;

  if (loading) return null;

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

      <div className="z-10 bg-white w-full max-w-md p-6 rounded-2xl shadow-xl">
        <h1 className="text-2xl font-bold text-center mb-4 text-gray-800">Exportar Reportes</h1>

        {/* Botones de modo */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            className={modeBtn('until', 'bg-blue-600', 'hover:bg-blue-700')}
            onClick={() => setMode('until')}
            disabled={mode === 'until'}
            aria-pressed={mode === 'until'}
          >
            Hasta la fecha seleccionada
          </button>

          <button
            type="button"
            className={modeBtn('day', 'bg-purple-600', 'hover:bg-purple-700')}
            onClick={() => setMode('day')}
            disabled={mode === 'day'}
            aria-pressed={mode === 'day'}
          >
            Solo la fecha seleccionada
          </button>

          <button
            type="button"
            className={modeBtn('range', 'bg-emerald-600', 'hover:bg-emerald-700')}
            onClick={() => setMode('range')}
            disabled={mode === 'range'}
            aria-pressed={mode === 'range'}
          >
            Por rango (inicio/fin)
          </button>

          <button
            type="button"
            className={modeBtn('month', 'bg-amber-600', 'hover:bg-amber-700')}
            onClick={() => setMode('month')}
            disabled={mode === 'month'}
            aria-pressed={mode === 'month'}
          >
            Por mes (YYYY-MM)
          </button>
        </div>

        {/* Inputs según modo */}
        <div className="mt-6 space-y-4">
          {mode === 'until' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Seleccione fecha (incluirá todos los reportes hasta este día)
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full p-3 rounded-lg border border-gray-300 text-gray-900"
                required
              />
            </div>
          )}

          {mode === 'day' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Seleccione la fecha exacta
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full p-3 rounded-lg border border-gray-300 text-gray-900"
                required
              />
            </div>
          )}

          {mode === 'range' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rango de fechas</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="date"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                  className="w-full p-3 rounded-lg border border-gray-300 text-gray-900"
                />
                <input
                  type="date"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  className="w-full p-3 rounded-lg border border-gray-300 text-gray-900"
                />
              </div>
              {mode === 'range' && !!rangeStart && !!rangeEnd && rangeStart > rangeEnd && (
                <p className="text-sm text-red-600 mt-1">
                  La fecha de inicio no puede ser mayor que la fecha fin.
                </p>
              )}
            </div>
          )}

          {mode === 'month' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mes</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full p-3 rounded-lg border border-gray-300 text-gray-900"
              />
            </div>
          )}
        </div>

        {/* Botón Exportar */}
        <button
          type="button"
          onClick={handleExport}
          disabled={
            exporting ||
            !(
              (mode === 'until' && !!selectedDate) ||
              (mode === 'day' && !!selectedDate) ||
              (mode === 'range' && !!rangeStart && !!rangeEnd && !(rangeStart > rangeEnd)) ||
              (mode === 'month' && !!selectedMonth)
            )
          }
          className="mt-6 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg disabled:bg-gray-300 disabled:text-gray-700 disabled:cursor-not-allowed"
        >
          {exporting ? 'Exportando…' : 'Exportar'}
        </button>
      </div>
    </div>
  );
}
