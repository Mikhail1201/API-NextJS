'use client';

import { useEffect, useMemo, useState, type ReactNode, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { auth } from '@/app/firebase/config';
import { useAuthState } from 'react-firebase-hooks/auth';
import { signOut } from 'firebase/auth';

/* ================== Tipos ================== */
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

type UserDocData = { role?: string };

type FilterField =
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

/** Estados conocidos */
const KNOWN_STATES = [
  'En Programación',
  'En Espera Aprobación',
  'pndte cotización',
  'En Ejecución',
  'Ejecutado',
  'N/A',
] as const;

type BaseStateKey = typeof KNOWN_STATES[number];

/* ================== Colores: utilidades ================== */
const DEFAULT_BASE_COLORS: Record<BaseStateKey, string> = {
  'En Programación': '#0EA5E9',
  'En Espera Aprobación': '#F59E0B',
  'pndte cotización': '#EAB308',
  'En Ejecución': '#6366F1',
  'Ejecutado': '#22C55E',
  'N/A': '#64748B',
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '').trim();
  const valid = /^[0-9a-fA-F]{6}$/.test(m) || /^[0-9a-fA-F]{3}$/.test(m);
  if (!valid) return null;
  let r = 0, g = 0, b = 0;
  if (m.length === 3) {
    r = parseInt(m[0] + m[0], 16);
    g = parseInt(m[1] + m[1], 16);
    b = parseInt(m[2] + m[2], 16);
  } else {
    r = parseInt(m.slice(0, 2), 16);
    g = parseInt(m.slice(2, 4), 16);
    b = parseInt(m.slice(4, 6), 16);
  }
  return { r, g, b };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const to2 = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function mix(hex1: string, hex2: string, weight: number) {
  const a = hexToRgb(hex1);
  const b = hexToRgb(hex2);
  if (!a || !b) return hex1;
  const w = Math.max(0, Math.min(1, weight));
  return rgbToHex({
    r: a.r * (1 - w) + b.r * w,
    g: a.g * (1 - w) + b.g * w,
    b: a.b * (1 - w) + b.b * w,
  });
}

function lighten(hex: string, amount: number) {
  return mix(hex, '#ffffff', amount);
}

// (Eliminado darken: no se usaba)

function getContrastText(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#111827';
  const { r, g, b } = rgb;
  const srgb = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  return L > 0.6 ? '#111827' : '#ffffff';
}

function deriveStylesFromBase(baseHex: string) {
  const rowBg = lighten(baseHex, 0.85);
  const rowHover = lighten(baseHex, 0.75);
  const badgeBg = lighten(baseHex, 0.40);
  const badgeText = getContrastText(badgeBg);
  const optBg = lighten(baseHex, 0.90);
  const optText = getContrastText(optBg);
  return { rowBg, rowHover, badgeBg, badgeText, optBg, optText };
}

function pickStateKey(raw?: string): BaseStateKey | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes('ejecut')) return 'Ejecutado';
  if (s.includes('final')) return 'Ejecutado';
  if (s.includes('program')) return 'En Programación';
  if (s.includes('espera') || s.includes('aprob')) return 'En Espera Aprobación';
  if (s.includes('pndte') || s.includes('pend') || s.includes('cotiz')) return 'pndte cotización';
  if (s.includes('ejecución') || s.includes('ejecucion')) return 'En Ejecución';
  if (s.includes('n/a')) return 'N/A';
  if ((KNOWN_STATES as readonly string[]).includes(raw)) return raw as BaseStateKey;
  return null;
}

/* ================== Componente principal ================== */

export default function ReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [user, loading] = useAuthState(auth);
  const [roleChecked, setRoleChecked] = useState(false);

  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const reportsPerPage = 5;
  const [currentPage, setCurrentPage] = useState(1);

  const [filterField, setFilterField] = useState<FilterField | ''>('');
  const [filterValue, setFilterValue] = useState<string>('');

  const [textQuery, setTextQuery] = useState<string>('');

  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [editReport, setEditReport] = useState<Report | null>(null);
  const [showModal, setShowModal] = useState(false);

  const [showConfig, setShowConfig] = useState(false);

  // Colores base por estado (por usuario)
  const [stateBaseColors, setStateBaseColors] = useState<Record<BaseStateKey, string>>(
    { ...DEFAULT_BASE_COLORS }
  );

  const db = getFirestore();

  /* ---------- helpers existentes ---------- */
  const formatReportDate = (val: string | { seconds: number } | undefined) => {
    if (!val) return '-';
    try {
      if (typeof val === 'string') {
        const d = new Date(val);
        return isNaN(d.getTime()) ? val : d.toLocaleDateString('es-CO');
      }
      if (typeof val === 'object' && 'seconds' in val && typeof val.seconds === 'number') {
        return new Date(val.seconds * 1000).toLocaleDateString('es-CO');
      }
    } catch {}
    return '-';
  };

  const getDateValue = (val: string | { seconds: number } | undefined) => {
    if (!val) return NaN;
    if (typeof val === 'string') {
      const t = new Date(val).getTime();
      return isNaN(t) ? NaN : t;
    }
    if (typeof val === 'object' && 'seconds' in val) return val.seconds * 1000;
    return NaN;
  };

  const coerceNumber = (raw?: string) => {
    if (!raw) return NaN;
    const m = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  };

  // Link (quotation / asesorías)
  const extractFirstUrl = (text?: string | null): string | null => {
    if (!text) return null;
    const match = text.match(/(https?:\/\/[^\s)]+|www\.[^\s)]+)/i);
    if (!match) return null;
    const raw = match[1];
    return raw.startsWith('http') ? raw : `https://${raw}`;
  };

  const LinkCell = ({ value }: { value?: string }) => {
    const url = extractFirstUrl(value);
    if (!url) return <>{value || '-'}</>;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-blue-600 underline hover:text-blue-700 break-all"
        title={url}
      >
        {url}
      </a>
    );
  };

  /* ---------- Auth + datos + preferencias (vía API) ---------- */
  useEffect(() => {
    const run = async () => {
      if (!user) return;

      // Verifica rol
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const data: UserDocData | undefined = userDoc.exists() ? (userDoc.data() as UserDocData) : undefined;
      const userRole: string | null = data?.role ?? null;

      if (!userRole) {
        await signOut(auth);
        router.push('/login');
        return;
      }
      setRoleChecked(true);

      // Trae reportes
      const reportsSnapshot = await getDocs(collection(db, 'reports'));
      const reportsList = reportsSnapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Report));
      setReports(reportsList);

      // Trae preferencias del usuario desde la API
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (idToken) {
          const res = await fetch('/api/user-prefs', {
            method: 'GET',
            headers: { Authorization: `Bearer ${idToken}` },
          });
          if (res.ok) {
            const json = (await res.json()) as { stateColors?: Record<string, string> };
            const stored = json.stateColors || {};
            const merged: Record<BaseStateKey, string> = { ...DEFAULT_BASE_COLORS };
            (KNOWN_STATES as readonly BaseStateKey[]).forEach((k) => {
              const val = stored[k];
              merged[k] = typeof val === 'string' ? normalizeHex(val) : DEFAULT_BASE_COLORS[k];
            });
            setStateBaseColors(merged);
          }
        }
      } catch {
        // si falla, seguimos con defaults
      }
    };

    if (!loading && user) run();
  }, [user, loading, db, router]);

  /* ---------- únicos ---------- */
  const uniquePoints = useMemo(
    () => Array.from(new Set(reports.map((r) => r.pointofsell).filter(Boolean))) as string[],
    [reports]
  );
  const uniqueStates = useMemo(
    () => Array.from(new Set(reports.map((r) => r.state).filter(Boolean))) as string[],
    [reports]
  );

  /* ---------- Derivar estilos ---------- */
  const derivedStylesMap = useMemo(() => {
    return (KNOWN_STATES as readonly BaseStateKey[]).reduce(
      (acc, k) => {
        acc[k] = deriveStylesFromBase(stateBaseColors[k]);
        return acc;
      },
      {} as Record<BaseStateKey, ReturnType<typeof deriveStylesFromBase>>
    );
  }, [stateBaseColors]);

  const styleForStateValue = (raw?: string) => {
    const key = pickStateKey(raw);
    if (!key) {
      return {
        rowBg: '',
        rowHover: '#e0f2fe',
        badgeBg: '#e5e7eb',
        badgeText: '#111827',
        optBg: '#ffffff',
        optText: '#111827',
      };
    }
    return derivedStylesMap[key];
  };

  /* ---------- Orden/filtrado ---------- */
  const sortKey: FilterField = (filterField || 'reportdate') as FilterField;
  const isNumericKey = (k: FilterField) => k === 'request' || k === 'number' || k === 'bill';
  const isDateKey = (k: FilterField) => k === 'reportdate';

  const isTextualFieldSelected =
    filterField === 'description' ||
    filterField === 'servicename' ||
    filterField === 'servicedescription' ||
    filterField === 'asesorias';

  const textTarget: 'description' | 'servicename' | 'servicedescription' | 'asesorias' =
    filterField === 'servicename'
      ? 'servicename'
      : filterField === 'servicedescription'
      ? 'servicedescription'
      : filterField === 'asesorias'
      ? 'asesorias'
      : 'description';

  const textPlaceholder = isTextualFieldSelected
    ? textTarget === 'servicename'
      ? 'Buscar en nombre del servicio...'
      : textTarget === 'servicedescription'
      ? 'Buscar en descripción del servicio...'
      : textTarget === 'asesorias'
      ? 'Buscar en asesorías...'
      : 'Buscar en descripción...'
    : "Selecciona 'Descripción', 'Nombre del Servicio', 'Descripción del Servicio' o 'Asesorías' para buscar";

  useEffect(() => {
    if (!isTextualFieldSelected && textQuery) setTextQuery('');
  }, [isTextualFieldSelected, textQuery]); // <-- añadimos textQuery

  const FIELD_LABELS: Record<FilterField, string> = {
    request: 'Solicitud/Aviso',
    number: 'Presupuesto',
    reportdate: 'Fecha',
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

  const sortDescription = useMemo(() => {
    if (isDateKey(sortKey)) return sortOrder === 'desc' ? 'Más recientes' : 'Más antiguos';
    if (isNumericKey(sortKey)) return sortOrder === 'desc' ? 'Mayor a menor' : 'Menor a mayor';
    return sortOrder === 'desc' ? 'Z → A' : 'A → Z';
  }, [sortKey, sortOrder]);

  const filteredReports = useMemo(() => {
    let filtered = reports;

    if (filterField === 'pointofsell' && filterValue && filterValue !== 'all') {
      filtered = filtered.filter((r) => r.pointofsell === filterValue);
    }
    if (filterField === 'state' && filterValue && filterValue !== 'all') {
      filtered = filtered.filter((r) => r.state === filterValue);
    }

    if (isTextualFieldSelected && textQuery.trim()) {
      const q = textQuery.toLowerCase();
      filtered = filtered.filter((r) => String(r[textTarget] ?? '').toLowerCase().includes(q));
    }

    const asc = sortOrder === 'asc';

    const cmpDate = (a: Report, b: Report) => {
      const av = getDateValue(a.reportdate);
      const bv = getDateValue(b.reportdate);
      const aMiss = isNaN(av);
      const bMiss = isNaN(bv);
      if (aMiss && bMiss) return 0;
      if (aMiss) return 1;
      if (bMiss) return -1;
      return asc ? av - bv : bv - av;
    };

    const cmpNumber = (a: Report, b: Report, key: 'request' | 'number' | 'bill') => {
      const av = coerceNumber(String(a[key] ?? ''));
      const bv = coerceNumber(String(b[key] ?? ''));
      const aMiss = isNaN(av);
      const bMiss = isNaN(bv);
      if (aMiss && bMiss) return 0;
      if (aMiss) return 1;
      if (bMiss) return -1;
      return asc ? av - bv : bv - av;
    };

    const cmpString = (
      a: Report,
      b: Report,
      key: Exclude<FilterField, 'reportdate' | 'request' | 'number'>
    ) => {
      const av = String(a[key] ?? '').toLowerCase();
      const bv = String(b[key] ?? '').toLowerCase();
      const aMiss = av === '';
      const bMiss = bv === '';
      if (aMiss && bMiss) return 0;
      if (aMiss) return 1;
      if (bMiss) return -1;
      const base = av.localeCompare(bv, 'es', { sensitivity: 'base' });
      return asc ? base : -base;
    };

    const sorted = filtered.slice().sort((a, b) => {
      if (isDateKey(sortKey)) return cmpDate(a, b);
      if (isNumericKey(sortKey)) return cmpNumber(a, b, sortKey as 'request' | 'number' | 'bill');
      return cmpString(a, b, sortKey as Exclude<FilterField, 'reportdate' | 'request' | 'number'>);
    });

    return sorted;
  }, [
    reports,
    filterField,
    filterValue,
    isTextualFieldSelected,
    textQuery,
    textTarget,
    sortKey,
    sortOrder,
  ]);

  const totalPages = Math.ceil(filteredReports.length / reportsPerPage);
  const paginatedReports = useMemo(
    () => filteredReports.slice((currentPage - 1) * reportsPerPage, currentPage * reportsPerPage),
    [filteredReports, currentPage, reportsPerPage]
  );

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [filteredReports, totalPages, currentPage]);

  const COLS = [
    { key: 'request', label: 'Solicitud/Aviso', className: 'px-2 py-1 text-center min-w-[120px]' },
    { key: 'number', label: 'Presupuesto', className: 'px-2 py-1 text-center min-w-[120px]' },
    { key: 'reportdate', label: 'Fecha de Reporte', className: 'px-2 py-1 text-center min-w-[120px] whitespace-nowrap' },
    { key: 'description', label: 'Descripción', className: 'px-2 py-1 text-center min-w-[180px]' },
    { key: 'pointofsell', label: 'Punto de Venta', className: 'px-2 py-1 text-center min-w-[120px]' },
    { key: 'quotation', label: 'Cotización', className: 'px-2 py-1 text-center min-w-[120px]' },
    { key: 'deliverycertificate', label: 'Acta de Entrega', className: 'px-2 py-1 text-center min-w-[120px]' },
    { key: 'state', label: 'Estado', className: 'px-2 py-1 text-center min-w-[120px]' },
    { key: 'bill', label: 'Factura', className: 'px-2 py-1 text-center min-w-[120px]' },
    { key: 'servicename', label: 'Nombre del Servicio', className: 'px-2 py-1 text-center min-w-[150px]' },
    { key: 'servicedescription', label: 'Descripción del Servicio', className: 'px-2 py-1 text-center min-w-[180px]' },
    { key: 'asesorias', label: 'Asesorías', className: 'px-2 py-1 text-center min-w-[180px]' },
  ] as const;

  if (loading || !roleChecked) return null;

  // const filterStateDerived = styleForStateValue(filterValue && filterValue !== 'all' ? filterValue : undefined);

  // Tipo seguro para variables CSS personalizadas
  type RowStyle = CSSProperties & { ['--row-bg']?: string; ['--row-hover']?: string };

  return (
    <div className="relative h-screen flex flex-col items-center px-4 py-8 overflow-hidden">
      {/* Volver */}
      <button
        onClick={() => router.push('/')}
        className="absolute top-4 left-4 z-20 bg-white/90 hover:bg-white text-blue-600 p-3 rounded-full shadow-md transition cursor-pointer"
        aria-label="Go back to homepage"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none"
             viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Configuración (abajo-derecha) */}
      <button
        onClick={() => setShowConfig(true)}
        className="fixed bottom-4 right-4 z-20 bg-white/90 hover:bg-white text-blue-600 p-3 rounded-full shadow-md transition cursor-pointer"
        aria-label="Abrir configuraciones"
        title="Configuraciones"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6"
             viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.89 3.31.877 2.42 2.42a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.89 1.543-.877 3.31-2.42 2.42a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.89-3.31-.877-2.42-2.42a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.89-1.543.877-3.31 2.42-2.42.93.537 2.107.214 2.573-1.066z" />
          <path strokeLinecap="round" strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      <div className="text-center text-white z-10 animate-fadeInDown">
        <h1 className="text-3xl sm:text-4xl font-bold">Reportes</h1>
        <p className="text-white/80 text-sm">Todos los reportes</p>
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-3 z-10 w-full max-w-6xl justify-start mt-6 mb-2">
        <button
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          className="cursor-pointer bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold transition text-center"
        >
          Ordenar por {filterField ? FIELD_LABELS[sortKey] : 'Fecha'}: {sortDescription}
        </button>

        <select
          value={filterField}
          onChange={(e) => {
            const f = e.target.value as FilterField | '';
            setFilterField(f);
            setFilterValue('');
            setCurrentPage(1);
          }}
          className="cursor-pointer p-2 rounded-lg border border-gray-300 bg-white text-gray-800 appearance-none"
        >
          <option value="">Seleccionar campo</option>
          {(
            [
              'request', 'number', 'reportdate', 'description', 'pointofsell',
              'quotation', 'deliverycertificate', 'state', 'bill',
              'servicename', 'servicedescription', 'asesorias',
            ] as FilterField[]
          ).map((f) => (
            <option key={f} value={f}>{FIELD_LABELS[f]}</option>
          ))}
        </select>

        {filterField === 'pointofsell' && (
          <select
            value={filterValue || 'all'}
            onChange={(e) => { setFilterValue(e.target.value); setCurrentPage(1); }}
            className="cursor-pointer p-2 rounded-lg border border-gray-300 bg-white text-gray-800 appearance-none"
          >
            <option value="all">Todos</option>
            {uniquePoints.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}

        {filterField === 'state' && (
          <select
            value={filterValue || 'all'}
            onChange={(e) => { setFilterValue(e.target.value); setCurrentPage(1); }}
            className="cursor-pointer p-2 rounded-lg border border-gray-300 appearance-none"
            style={{
              backgroundColor: filterValue && filterValue !== 'all' ? styleForStateValue(filterValue).optBg : '#ffffff',
              color: filterValue && filterValue !== 'all' ? styleForStateValue(filterValue).optText : '#111827',
            }}
          >
            <option value="all" style={{ backgroundColor: '#ffffff', color: '#111827' }}>Todos</option>
            {uniqueStates.map((s) => {
              const st = styleForStateValue(s);
              return (
                <option
                  key={s}
                  value={s}
                  style={{ backgroundColor: st.optBg, color: st.optText }}
                >
                  {s}
                </option>
              );
            })}
          </select>
        )}

        <input
          type="text"
          value={textQuery}
          onChange={(e) => { setTextQuery(e.target.value); setCurrentPage(1); }}
          placeholder={textPlaceholder}
          disabled={!isTextualFieldSelected}
          className={`p-2 rounded-lg border border-gray-300 bg-white text-gray-800 flex-1 min-w-[220px] ${
            !isTextualFieldSelected ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        />
      </div>

      {/* Tabla */}
      <div className="z-10 bg-white w-full max-w-6xl rounded-xl shadow-xl p-4 mt-2 h-[420px] flex flex-col justify-between">
        <div className="flex-grow overflow-auto">
          <div
            className="overflow-x-auto scrollbar-hide cursor-grab"
            style={{ WebkitOverflowScrolling: 'touch', scrollSnapType: 'x mandatory' }}
            onWheel={(e) => {
              if (e.deltaY !== 0) {
                e.currentTarget.scrollLeft += e.deltaY;
                e.preventDefault();
              }
            }}
          >
            <table className="min-w-[1400px] table-auto border-collapse text-sm text-gray-800">
              <thead className="bg-gray-100 text-gray-700">
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} className={c.className}>{c.label}</th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {paginatedReports.map((report) => {
                  const derived = styleForStateValue(report.state);

                  const rowCells: ReactNode[] = [
                    report.request || '-',
                    report.number || '-',
                    formatReportDate(report.reportdate),
                    <div className="h-12 overflow-y-auto" key="desc">{report.description || '-'}</div>,
                    report.pointofsell || '-',
                    <LinkCell value={report.quotation} key="quotation" />,
                    report.deliverycertificate || '-',
                    <span
                      key="state"
                      className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{ backgroundColor: derived.badgeBg, color: derived.badgeText }}
                    >
                      {report.state || '-'}
                    </span>,
                    report.bill || '-',
                    report.servicename || '-',
                    report.servicedescription || '-',
                    <LinkCell value={report.asesorias} key="asesorias" />,
                  ];

                  const rowStyle: RowStyle = {
                    ['--row-bg']: derived.rowBg,
                    ['--row-hover']: derived.rowHover,
                  };

                  return (
                    <tr
                      key={report.id}
                      className="border-t border-gray-200 cursor-pointer transition state-row"
                      style={rowStyle}
                      onClick={() => {
                        setSelectedReport(report);
                        setEditReport({ ...report });
                        setShowModal(true);
                      }}
                    >
                      {rowCells.map((content, i) => (
                        <td key={i} className={COLS[i].className}>{content}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center mt-4 gap-1 flex-wrap">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(currentPage - 1)}
              className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-black cursor-pointer"
            >
              Anterior
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((page) => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 2)
              .map((page, idx, arr) => {
                const prev = arr[idx - 1];
                const showEllipsis = prev && page - prev > 1;
                return (
                  <span key={page} className="flex items-center">
                    {showEllipsis && <span className="px-1">...</span>}
                    <button
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-1 rounded cursor-pointer text-black ${
                        currentPage === page
                          ? 'bg-blue-600 text-white font-bold'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      {page}
                    </button>
                  </span>
                );
              })}

            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(currentPage + 1)}
              className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-black cursor-pointer"
            >
              Siguiente
            </button>

            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(totalPages)}
              className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-black cursor-pointer"
            >
              Última
            </button>
          </div>
        )}
      </div>

      {/* Modal Detalles */}
      {showModal && selectedReport && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-lg w-[90%] max-w-3xl p-6">
            <h2 className="text-xl font-semibold mb-4 text-black">Detalles del Reporte</h2>
            <div className="grid grid-cols-2 gap-4 text-black">
              <div><strong>Solicitud/Aviso:</strong> {selectedReport.request || '-'}</div>
              <div><strong>Presupuesto:</strong> {selectedReport.number || '-'}</div>
              <div><strong>Fecha de Reporte:</strong> {formatReportDate(selectedReport.reportdate)}</div>
              <div><strong>Descripción:</strong> {selectedReport.description || '-'}</div>
              <div><strong>Punto de Venta:</strong> {selectedReport.pointofsell || '-'}</div>
              <div><strong>Cotización:</strong> <LinkCell value={selectedReport.quotation} /></div>
              <div><strong>Acta de Entrega:</strong> {selectedReport.deliverycertificate || '-'}</div>
              <div><strong>Estado:</strong> {selectedReport.state || '-'}</div>
              <div><strong>Factura:</strong> {selectedReport.bill || '-'}</div>
              <div><strong>Nombre del Servicio:</strong> {selectedReport.servicename || '-'}</div>
              <div><strong>Descripción del Servicio:</strong> {selectedReport.servicedescription || '-'}</div>
              <div><strong>Asesorías:</strong> <LinkCell value={selectedReport.asesorias} /></div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="cursor-pointer px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 transition text-black"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar */}
      {showModal && selectedReport && editReport && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-lg w-[90%] max-w-3xl p-6">
            <h2 className="text-xl font-semibold mb-4 text-black">Editar Reporte</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-black">
              {/* Columna 1 */}
              <div className="flex flex-col gap-2">
                <div>
                  <strong>Solicitud/Aviso:</strong>
                  <input
                    className="w-full border rounded p-1 mt-1 h-10"
                    value={editReport.request || ''}
                    onChange={(e) => setEditReport({ ...editReport, request: e.target.value })}
                  />
                </div>
                <div>
                  <strong>Presupuesto:</strong>
                  <input
                    className="w-full border rounded p-1 mt-1 h-10"
                    value={editReport.number || ''}
                    onChange={(e) => setEditReport({ ...editReport, number: e.target.value })}
                  />
                </div>
                <div>
                  <strong>Fecha de Reporte:</strong>
                  <input
                    type="date"
                    className="w-full border rounded p-1 mt-1 h-10"
                    value={
                      typeof editReport.reportdate === 'object' &&
                      editReport.reportdate &&
                      'seconds' in editReport.reportdate
                        ? new Date(editReport.reportdate.seconds * 1000).toISOString().split('T')[0]
                        : (editReport.reportdate as string) || ''
                    }
                    onChange={(e) => setEditReport({ ...editReport, reportdate: e.target.value })}
                  />
                </div>
                <div>
                  <strong>Descripción:</strong>
                  <textarea
                    className="w-full border rounded p-1 mt-1 h-10 resize-none align-middle"
                    value={editReport.description || ''}
                    onChange={(e) => setEditReport({ ...editReport, description: e.target.value })}
                  />
                </div>
              </div>

              {/* Columna 2 */}
              <div className="flex flex-col gap-2">
                <div>
                  <strong>Punto de Venta:</strong>
                  <select
                    className="w-full border rounded p-1 mt-1 h-10"
                    value={editReport.pointofsell ?? ''}
                    onChange={(e) => setEditReport({ ...editReport, pointofsell: e.target.value })}
                  >
                    <option value="" disabled>Selecciona un punto de venta</option>
                    {editReport.pointofsell && !uniquePoints.includes(editReport.pointofsell) && (
                      <option value={editReport.pointofsell}>
                        {editReport.pointofsell} (actual)
                      </option>
                    )}
                    {uniquePoints.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <strong>Cotización:</strong>
                  <input
                    className="w-full border rounded p-1 mt-1 h-10"
                    value={editReport.quotation || ''}
                    onChange={(e) => setEditReport({ ...editReport, quotation: e.target.value })}
                  />
                </div>
                <div>
                  <strong>Acta de Entrega:</strong>
                  <input
                    className="w-full border rounded p-1 mt-1 h-10"
                    value={editReport.deliverycertificate || ''}
                    onChange={(e) => setEditReport({ ...editReport, deliverycertificate: e.target.value })}
                  />
                </div>
                <div>
                  <strong>Factura:</strong>
                  <input
                    className="w-full border rounded p-1 mt-1 h-10"
                    value={editReport.bill || ''}
                    onChange={(e) => setEditReport({ ...editReport, bill: e.target.value })}
                  />
                </div>
              </div>

              {/* Columna 3 */}
              <div className="flex flex-col gap-2">
                <div>
                  <strong>Estado:</strong>
                  {(() => {
                    const k = pickStateKey(editReport.state) || 'N/A';
                    const st = derivedStylesMap[k];
                    return (
                      <select
                        className="w-full border rounded p-1 mt-1 h-10"
                        value={editReport.state || ''}
                        onChange={(e) => setEditReport({ ...editReport, state: e.target.value })}
                        required
                        style={{ backgroundColor: st.optBg, color: st.optText }}
                      >
                        <option value="" disabled style={{ backgroundColor: '#ffffff', color: '#111827' }}>
                          Selecciona un estado
                        </option>
                        {KNOWN_STATES.map((s) => {
                          const ds = derivedStylesMap[s];
                          return (
                            <option
                              key={s}
                              value={s}
                              style={{ backgroundColor: ds.optBg, color: ds.optText }}
                            >
                              {s}
                            </option>
                          );
                        })}
                      </select>
                    );
                  })()}
                </div>
                <div>
                  <strong>Nombre del Servicio:</strong>
                  <input
                    className="w-full border rounded p-1 mt-1 h-10"
                    value={editReport.servicename || ''}
                    onChange={(e) => setEditReport({ ...editReport, servicename: e.target.value })}
                  />
                </div>
                <div>
                  <strong>Descripción del Servicio:</strong>
                  <textarea
                    className="w-full border rounded p-1 mt-1 h-10 resize-none align-middle"
                    value={editReport.servicedescription || ''}
                    onChange={(e) => setEditReport({ ...editReport, servicedescription: e.target.value })}
                  />
                </div>
                <div>
                  <strong>Asesorías:</strong>
                  <textarea
                    className="w-full border rounded p-1 mt-1 h-10 resize-none align-middle"
                    value={editReport.asesorias || ''}
                    onChange={(e) => setEditReport({ ...editReport, asesorias: e.target.value })}
                    placeholder="Detalle de asesorías"
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="cursor-pointer px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 transition text-black"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  const res = await fetch('/api/admin-update-report', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      ...editReport,
                      userId: user?.uid,
                      userEmail: user?.email,
                    }),
                  });
                  if (res.ok) {
                    setShowModal(false);
                    let seconds = 2;
                    const successDiv = document.createElement('div');
                    successDiv.className =
                      'fixed bottom-4 right-4 bg-green-500 text-white p-4 rounded-lg shadow-lg flex items-center gap-2 opacity-0 transition-opacity duration-500 z-50';
                    successDiv.innerHTML = `
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.586-6.586a2 2 0 00-2.828 0l-10 10a2 2 0 000 2.828l3.172 3.172a2 2 0 002.828 0l10-10a2 2 0 000-2.828z"></path>
      </svg>
      <span>¡Reporte actualizado exitosamente! Actualizando en <span id="countdown">${seconds}</span>...</span>
    `;
                    document.body.appendChild(successDiv);
                    setTimeout(() => successDiv.classList.add('opacity-100'), 10);
                    const countdownInterval = setInterval(() => {
                      seconds -= 1;
                      const countdownSpan = successDiv.querySelector('#countdown');
                      if (countdownSpan) countdownSpan.textContent = String(seconds);
                      if (seconds <= 0) {
                        clearInterval(countdownInterval);
                        successDiv.classList.remove('opacity-100');
                        setTimeout(() => {
                          successDiv.remove();
                          window.location.reload();
                        }, 500);
                      }
                    }, 1000);
                  }
                }}
                className="cursor-pointer px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 transition text-white"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Configuración: Cambiar colores */}
      {showConfig && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-2xl w-[92%] max-w-3xl p-6">
            <h2 className="text-xl font-semibold text-black mb-1">Configuraciones</h2>
            <p className="text-sm text-gray-600 mb-4">Cambiar colores por estado</p>

            <div className="flex flex-col gap-3">
              {KNOWN_STATES.map((k) => {
                const base = stateBaseColors[k];
                const derived = derivedStylesMap[k];
                return (
                  <div key={k} className="grid grid-cols-1 md:grid-cols-12 items-center gap-2 border rounded-lg p-3">
                    <div className="md:col-span-3 text-sm font-medium text-gray-800">{k}</div>

                    {/* Vista previa */}
                    <div className="md:col-span-3">
                      <div className="rounded-md border text-xs" style={{ backgroundColor: derived.rowBg }}>
                        <div className="flex items-center justify-between px-2 py-1">
                          <span className="opacity-80">Fila</span>
                          <span className="px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: derived.badgeBg, color: derived.badgeText }}>
                            Chip
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Pickers */}
                    <div className="md:col-span-3 flex items-center gap-2">
                      <input
                        type="color"
                        value={normalizeHex(base)}
                        onChange={(e) => handleColorChange(k, e.target.value)}
                        className="w-10 h-10 p-0 border rounded cursor-pointer"
                        title="Elige un color base"
                      />
                      <input
                        type="text"
                        value={normalizeHex(base)}
                        onChange={(e) => handleHexTyping(k, e.target.value)}
                        onBlur={(e) => commitHex(k, e.target.value)}
                        className="flex-1 border rounded px-2 py-1 text-sm text-black"
                        placeholder="#RRGGBB"
                      />
                    </div>

                    {/* Reset */}
                    <div className="md:col-span-3 flex justify-end">
                      <button
                        onClick={() => resetOne(k)}
                        className="cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm px-3 py-2 rounded-md"
                      >
                        Restablecer
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-between">
              <button
                onClick={resetAll}
                className="cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm px-4 py-2 rounded-md"
              >
                Restablecer todos
              </button>
              <button
                onClick={() => setShowConfig(false)}
                className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-md"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Estilos globales */}
      <style jsx global>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeInDown { animation: fadeInDown 0.8s ease forwards; }

        .state-row {
          background-color: var(--row-bg);
          transition: background-color 0.15s ease;
        }
        .state-row:hover {
          background-color: var(--row-hover);
        }
      `}</style>
    </div>
  );

  /* ====== funciones locales ====== */

  function normalizeHex(v: string) {
    let s = v.trim();
    if (!s.startsWith('#')) s = `#${s}`;
    const ok = /^#[0-9a-fA-F]{6}$/.test(s) || /^#[0-9a-fA-F]{3}$/.test(s);
    if (!ok) return '#000000';
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      const r = s[1], g = s[2], b = s[3];
      s = `#${r}${r}${g}${g}${b}${b}`;
    }
    return s.toUpperCase();
  }

  async function persistColors(next: Record<BaseStateKey, string>) {
    if (!auth.currentUser) return;
    try {
      const idToken = await auth.currentUser.getIdToken();
      await fetch('/api/admin-user-prefs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ stateColors: next }),
      });
    } catch {
      // no bloquear UI si falla
    }
  }

  function handleColorChange(key: BaseStateKey, hex: string) {
    const n = normalizeHex(hex);
    setStateBaseColors((prev) => {
      const next = { ...prev, [key]: n };
      void persistColors(next);
      return next;
    });
  }

  function handleHexTyping(key: BaseStateKey, raw: string) {
    if (/^#?[0-9a-fA-F]{0,6}$/.test(raw.trim())) {
      if (/^#?[0-9a-fA-F]{6}$/.test(raw.trim())) {
        const n = normalizeHex(raw);
        setStateBaseColors((prev) => ({ ...prev, [key]: n }));
      }
    }
  }

  function commitHex(key: BaseStateKey, raw: string) {
    const n = normalizeHex(raw);
    setStateBaseColors((prev) => {
      const next = { ...prev, [key]: n };
      void persistColors(next);
      return next;
    });
  }

  function resetOne(key: BaseStateKey) {
    const def = DEFAULT_BASE_COLORS[key];
    setStateBaseColors((prev) => {
      const next = { ...prev, [key]: def };
      void persistColors(next);
      return next;
    });
  }

  function resetAll() {
    const all = { ...DEFAULT_BASE_COLORS };
    setStateBaseColors(all);
    void persistColors(all);
  }
}
