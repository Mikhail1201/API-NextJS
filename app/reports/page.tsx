'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react';
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
  const rowBg = lighten(baseHex, 0.4);
  const rowHover = lighten(baseHex, 0.2);
  const badgeBg = lighten(baseHex, 0.2);
  const badgeText = getContrastText(badgeBg);
  const optBg = lighten(baseHex, 0.2);
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

/* ================== Columnas base y orden ================== */
const BASE_COLS = [
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

type ColKey = typeof BASE_COLS[number]['key'];

/* Clave de almacenamiento local para orden de columnas */
const LOCAL_ORDER_KEY = 'reports_columnOrder_v1';

/* ================== Componente principal ================== */

export default function ReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [user, loading] = useAuthState(auth);
  const [roleChecked, setRoleChecked] = useState(false);

  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const reportsPerPage = 15;
  const [currentPage, setCurrentPage] = useState(1);

  const [filterField, setFilterField] = useState<FilterField | ''>('');
  const [filterValue, setFilterValue] = useState<string>('');

  const [textQuery, setTextQuery] = useState<string>('');

  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [editReport, setEditReport] = useState<Report | null>(null);
  const [showModal, setShowModal] = useState(false);

  const [showConfig, setShowConfig] = useState(false);
  const [configView, setConfigView] = useState<'menu' | 'colors' | 'organize'>('menu');

  // Colores base por estado (por usuario)
  const [stateBaseColors, setStateBaseColors] = useState<Record<BaseStateKey, string>>(
    { ...DEFAULT_BASE_COLORS }
  );

  // Borradores de texto para el input de HEX (permite teclear sin restricciones)
  const [hexDrafts, setHexDrafts] = useState<Record<BaseStateKey, string>>(() => {
    const o = {} as Record<BaseStateKey, string>;
    (KNOWN_STATES as readonly BaseStateKey[]).forEach(k => { o[k] = DEFAULT_BASE_COLORS[k]; });
    return o;
  });

  // Sincroniza borradores cuando cambian los colores confirmados
  useEffect(() => {
    setHexDrafts(prev => {
      const next = { ...prev };
      (KNOWN_STATES as readonly BaseStateKey[]).forEach(k => {
        next[k] = stateBaseColors[k];
      });
      return next;
    });
  }, [stateBaseColors]);

  // Orden de columnas (por usuario)
  const [columnOrder, setColumnOrder] = useState<ColKey[]>(
    () => BASE_COLS.map(c => c.key)
  );

  // Flags de "hay cambios sin guardar"
  const hasColorChangesRef = useRef(false);
  const hasOrderChangesRef = useRef(false);

  // Drag state para "Organizar"
  const [dragKey, setDragKey] = useState<ColKey | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverBefore, setHoverBefore] = useState<boolean>(true);
  const organizeScrollRef = useRef<HTMLDivElement | null>(null);
  const hScrollRef = useRef<HTMLDivElement | null>(null);
  const suppressHScrollRef = useRef<boolean>(false);
  const wScrollRef = useRef<HTMLDivElement | null>(null);
  const wSpacerRef = useRef<HTMLDivElement | null>(null);
  const isSyncingScrollRef = useRef(false);

  const db = getFirestore();

  /* ---------- Cargar orden de columnas desde localStorage al iniciar ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_ORDER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        const normalized = normalizeColumnOrder(parsed);
        setColumnOrder(normalized);
      }
    } catch {
      // ignore
    }
  }, []);

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
    } catch { }
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
      const data: UserDocData | undefined = userDoc.exists()
        ? (userDoc.data() as UserDocData)
        : undefined;
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
          const res = await fetch('/api/admin-user-prefs', {
            method: 'GET',
            headers: { Authorization: `Bearer ${idToken}` },
          });
          if (res.ok) {
            const json = (await res.json()) as {
              stateColors?: Record<string, string>;
              columnOrder?: string[];
            };

            // Colores
            const stored = json.stateColors || {};
            const merged: Record<BaseStateKey, string> = { ...DEFAULT_BASE_COLORS };
            (KNOWN_STATES as readonly BaseStateKey[]).forEach((k) => {
              const val = stored[k];
              merged[k] = typeof val === 'string' ? normalizeHex(val) : DEFAULT_BASE_COLORS[k];
            });
            setStateBaseColors(merged);

            // Orden de columnas (API tiene prioridad sobre localStorage)
            if (Array.isArray(json.columnOrder)) {
              const normalized = normalizeColumnOrder(json.columnOrder);
              setColumnOrder(normalized);
              try {
                localStorage.setItem(LOCAL_ORDER_KEY, JSON.stringify(normalized));
              } catch { }
            }
          }
        }
      } catch {
        // si falla, seguimos con defaults/local
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

  /* vertical scrollbar syncing effect moved below (after paginatedReports declaration) */

  /* ---------- Orden/filtrado ---------- */
  const sortKey: FilterField = (filterField || 'reportdate') as FilterField;
  const isNumericKey = (k: FilterField) => k === 'request' || k === 'number' || k === 'bill';
  const isDateKey = (k: FilterField) => k === 'reportdate';

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

  // Habilitación y placeholder del buscador (universal)
  const inputEnabled = !!filterField;
  const textPlaceholder = !filterField
    ? "Selecciona un campo para buscar…"
    : filterField === 'reportdate'
      ? 'Buscar por fecha (YYYY-MM-DD o DD/MM/AAAA)'
      : `Buscar en ${FIELD_LABELS[filterField]}…`;

  useEffect(() => {
    if (!filterField && textQuery) setTextQuery('');
  }, [filterField, textQuery]);

  // Construye el string indexable según campo (fecha soporta varios formatos)
  function getSearchString(r: Report, field: FilterField): string {
    if (field === 'reportdate') {
      const val = r.reportdate;
      let iso = '';
      let es = '';
      if (typeof val === 'string') {
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
          iso = d.toISOString().slice(0, 10);
          es = d.toLocaleDateString('es-CO');
        } else {
          iso = val;
        }
      } else if (val && typeof val === 'object' && 'seconds' in val) {
        const d = new Date(val.seconds * 1000);
        iso = d.toISOString().slice(0, 10);
        es = d.toLocaleDateString('es-CO');
      }
      return `${iso} ${es}`.trim().toLowerCase();
    }
    return String(r[field] ?? '').toLowerCase();
  }

  // Detecta si el evento proviene de un nodo con scroll vertical disponible
  // ¿Tiene scroll vertical real?
  function isVerticallyScrollable(el: HTMLElement) {
    const style = window.getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
  }

  // Sube desde el target hasta el contenedor horizontal buscando un ancestro con scroll vertical
  function findVertScrollableAncestor(start: HTMLElement, stopAt: HTMLElement) {
    let el: HTMLElement | null = start;
    while (el && el !== stopAt) {
      if (el instanceof HTMLElement && isVerticallyScrollable(el)) return el;
      el = el.parentElement as HTMLElement | null;
    }
    return null;
  }

  // Altura de línea en px (si line-height es 'normal', aproxima)
  function getLineHeightPx(el: HTMLElement) {
    const cs = window.getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    if (Number.isFinite(lh)) return lh;
    const fs = parseFloat(cs.fontSize) || 16;
    return Math.round(fs * 1.4); // aprox. leading-snug
  }


  function hasVertScrollableDesc(root: HTMLElement) {
    // Busca descendientes con overflow-y que realmente puedan hacer scroll
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode as HTMLElement | null;
    while (node) {
      const el = node as HTMLElement;
      const style = window.getComputedStyle(el);
      if (/(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) {
        return true;
      }
      node = walker.nextNode() as HTMLElement | null;
    }
    return false;
  }

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

    // Filtro de texto universal por campo (incluye fechas)
    if (filterField && textQuery.trim()) {
      const q = textQuery.trim().toLowerCase();
      filtered = filtered.filter((r) => getSearchString(r, filterField).includes(q));
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
    textQuery,
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

  // Sync vertical overlay scrollbar with the table container
  useEffect(() => {
    const main = hScrollRef.current;
    const w = wScrollRef.current;
    const spacer = wSpacerRef.current;
    if (!main || !w || !spacer) return;

    const syncSpacer = () => {
      try {
        spacer.style.width = `${main.scrollWidth}px`;
      } catch { }
    };

    const onMainScroll = () => {
      if (isSyncingScrollRef.current) return;
      isSyncingScrollRef.current = true;
      try {
        w.scrollLeft = main.scrollLeft;
      } finally {
        requestAnimationFrame(() => { isSyncingScrollRef.current = false; });
      }
    };

    const onWScroll = () => {
      if (isSyncingScrollRef.current) return;
      isSyncingScrollRef.current = true;
      try {
        main.scrollLeft = w.scrollLeft;
      } finally {
        requestAnimationFrame(() => { isSyncingScrollRef.current = false; });
      }
    };

    main.addEventListener('scroll', onMainScroll, { passive: true });
    w.addEventListener('scroll', onWScroll, { passive: true });

    const ro = new ResizeObserver(syncSpacer);
    ro.observe(main);
    // initial sync
    syncSpacer();

    return () => {
      main.removeEventListener('scroll', onMainScroll);
      w.removeEventListener('scroll', onWScroll);
      ro.disconnect();
    };
  }, [paginatedReports]);

  // Columnas realmente pintadas según preferencias
  const orderedCols = useMemo(() => {
    const baseKeys = BASE_COLS.map(c => c.key);
    const filtered = columnOrder.filter((k): k is ColKey => (baseKeys as string[]).includes(k));
    const missing = baseKeys.filter(k => !filtered.includes(k)) as ColKey[];
    const finalKeys = [...filtered, ...missing];
    return finalKeys.map(k => BASE_COLS.find(c => c.key === k)!);
  }, [columnOrder]);

  if (loading || !roleChecked) return null;

  // Tipo seguro para variables CSS personalizadas
  type RowStyle = CSSProperties & { ['--row-bg']?: string;['--row-hover']?: string };

  /* ================== Handlers de Config ================== */
  const handleOpenConfig = () => {
    setShowConfig(true);
    setConfigView('menu');
  };

  async function flushPrefsIfNeeded() {
    if (hasColorChangesRef.current || hasOrderChangesRef.current) {
      await persistAllPrefs(stateBaseColors, columnOrder);
      hasColorChangesRef.current = false;
      hasOrderChangesRef.current = false;
      try {
        localStorage.setItem(LOCAL_ORDER_KEY, JSON.stringify(columnOrder));
      } catch { }
    }
  }

  const handleBackFromSubview = async () => {
    await flushPrefsIfNeeded();
    setConfigView('menu');
  };

  const handleCloseConfig = async () => {
    await flushPrefsIfNeeded();
    setShowConfig(false);
  };

  /* ================== Render ================== */
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
        onClick={handleOpenConfig}
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
          disabled={!inputEnabled}
          className={`p-2 rounded-lg border border-gray-300 bg-white text-gray-800 flex-1 min-w-[220px] ${!inputEnabled ? 'opacity-50 cursor-not-allowed' : ''
            }`}
        />
      </div>

      {/* Tabla */}
      <div className="z-10 bg-white w-full max-w-6xl rounded-xl shadow-xl p-4 mt-2 h-[70vh] flex flex-col justify-between">
        <div className="flex-grow overflow-auto">
          <div
            ref={hScrollRef}
            className="overflow-x-auto cursor-grab"
            style={{
              WebkitOverflowScrolling: 'touch',
              scrollSnapType: 'x mandatory',
              overscrollBehaviorX: 'contain',
              overscrollBehaviorY: 'auto',
              touchAction: 'auto',
              overflowY: 'hidden',
              overflowX: 'hidden'
              //im tired of scrollbars showing when not needed
            }}
            // ➊ Primero, capturamos el wheel y, si el target está en una celda scrollable,
            //    hacemos el desplazamiento en pasos de UNA LÍNEA y frenamos la propagación.
            onWheelCapture={(e) => {
              const container = e.currentTarget as HTMLDivElement;
              const start = e.target as HTMLElement;
              const scrollEl = findVertScrollableAncestor(start, container);
              if (scrollEl) {
                const step = getLineHeightPx(scrollEl);
                const dir = e.deltaY > 0 ? 1 : -1;
                const maxTop = scrollEl.scrollHeight - scrollEl.clientHeight;
                const next = Math.max(0, Math.min(maxTop, scrollEl.scrollTop + dir * step));
                if (next !== scrollEl.scrollTop) {
                  scrollEl.scrollTop = next;
                }
                e.preventDefault();
                e.stopPropagation();
                return;
              }
            }}
          >
            <table className="min-w-[1400px] table-auto border-collapse text-sm text-gray-800">
              <thead className="bg-gray-100 text-gray-700">
                <tr>
                  {orderedCols.map((c) => (
                    <th key={c.key} className={c.className}>{c.label}</th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {paginatedReports.map((report) => {
                  const derived = styleForStateValue(report.state);

                  const rowMap: Record<ColKey, ReactNode> = {
                    request: report.request || '-',
                    number: report.number || '-',
                    reportdate: formatReportDate(report.reportdate),
                    description: report.description || '-'   ,
                    pointofsell: report.pointofsell || '-',
                    quotation: <LinkCell value={report.quotation} />,
                    deliverycertificate: report.deliverycertificate || '-',
                    state: (
                      <span
                        className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ backgroundColor: derived.badgeBg, color: derived.badgeText }}
                      >
                        {report.state || '-'}
                      </span>
                    ),
                    bill: report.bill || '-',
                    servicename: report.servicename || '-',
                    servicedescription: report.servicedescription || '-',
                    asesorias: <LinkCell value={report.asesorias} />,
                  };

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
                      {orderedCols.map((c) => (
                        <td
                          key={c.key}
                          className={c.className}
                          onMouseEnter={(e) => {
                            const td = e.currentTarget as HTMLTableCellElement;
                            suppressHScrollRef.current = hasVertScrollableDesc(td);
                          }}
                          onMouseLeave={() => {
                            suppressHScrollRef.current = false;
                          }}
                        >
                          {rowMap[c.key]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

        </div>

        {/* Horizontal scrollbar (outside the scrollable area so it stays visible) */}
        <div
          ref={wScrollRef}
          aria-hidden="true"
          style={{
            height: 36,
            overflowX: 'scroll',
            width: '100%',
            marginTop: 6,
          }}
        >
          <div ref={wSpacerRef} style={{ height: 3, width: 1 }} />
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
                      className={`px-3 py-1 rounded cursor-pointer text-black ${currentPage === page
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

      {/* Modal Editar */}
      {showModal && selectedReport && editReport && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-lg w-[75%] max-h-[90vh] overflow-y-auto min-w-3x1 p-6">
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
                    className="w-full border rounded p-1 mt-1 h-20 resize-none align-middle"
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
                    className="w-full border rounded p-1 mt-1 h-20 resize-none align-middle"
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

      {/* Modal Configuración: menú + vistas */}
      {showConfig && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-2xl w-[min(92vw,900px)] max-h-[88vh] flex flex-col">
            {/* Header */}
            <div className="px-6 pt-5 pb-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                {configView !== 'menu' && (
                  <button
                    onClick={handleBackFromSubview}
                    className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer"
                  >
                    Atrás
                  </button>
                )}
                <h2 className="text-lg font-semibold text-black">Configuraciones</h2>
              </div>
              <button
                onClick={handleCloseConfig}
                className="px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
              >
                Cerrar
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-4 overflow-y-auto">
              {configView === 'menu' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    onClick={() => setConfigView('colors')}
                    className="cursor-pointer text-left p-4 border rounded-xl hover:shadow-md transition bg-white"
                  >
                    <div className="font-medium text-gray-900">Colores de estado</div>
                    <div className="text-sm text-gray-600">Personaliza los colores de filas y los estados</div>
                  </button>

                  <button
                    onClick={() => setConfigView('organize')}
                    className="cursor-pointer text-left p-4 border rounded-xl hover:shadow-md transition bg-white"
                  >
                    <div className="font-medium text-gray-900">Organizar columnas</div>
                    <div className="text-sm text-gray-600">Reordena visualmente las columnas de la tabla</div>
                  </button>
                </div>
              )}

              {configView === 'colors' && (
                <div>
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
                                <span className="opacity-80 text-gray-700">Fila</span>
                                <span className="px-2 py-0.5 rounded-full"
                                  style={{ backgroundColor: derived.badgeBg, color: derived.badgeText }}>
                                  Chip
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Swatch + Hex */}
                          <div className="md:col-span-4 flex items-center gap-3">
                            <ColorSwatch
                              value={base}
                              onChange={(hex) => handleColorChange(k, hex)}
                            />
                            <input
                              type="text"
                              value={hexDrafts[k] ?? ''}
                              onChange={(e) => handleHexDraftChange(k, e.target.value)}
                              onBlur={() => commitHexDraft(k)}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
                              className="flex-1 border rounded px-2 py-1 text-sm text-black font-mono"
                              placeholder="#RRGGBB"
                              spellCheck={false}
                            />
                          </div>

                          {/* Reset */}
                          <div className="md:col-span-2 flex justify-end">
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

                  <div className="mt-5">
                    <button
                      onClick={resetAll}
                      className="cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm px-4 py-2 rounded-md"
                    >
                      Restablecer todos
                    </button>
                  </div>
                </div>
              )}

              {configView === 'organize' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Arrastra las columnas para cambiar el orden. Suelta cuando veas la línea guía entre elementos.
                  </p>

                  <div
                    ref={organizeScrollRef}
                    className="max-h-[50vh] overflow-y-auto border rounded-lg p-2 bg-white"
                    onDragOver={(e) => {
                      e.preventDefault();
                      const container = organizeScrollRef.current;
                      if (!container) return;
                      const rect = container.getBoundingClientRect();
                      const y = e.clientY;

                      // Auto-scroll suave
                      const edge = 36; // px
                      if (y - rect.top < edge) {
                        container.scrollBy({ top: -8, behavior: 'auto' });
                      } else if (rect.bottom - y < edge) {
                        container.scrollBy({ top: 8, behavior: 'auto' });
                      }
                    }}
                  >
                    {columnOrder.map((key, i) => {
                      const col = BASE_COLS.find(c => c.key === key)!;
                      return (
                        <div key={key} className="relative">
                          {/* Línea guía antes del item */}
                          {dragKey && hoverIndex === i && hoverBefore && (
                            <div className="absolute -top-1 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />
                          )}

                          <div
                            draggable
                            onDragStart={(e) => {
                              setDragKey(key);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', key);
                            }}
                            onDragEnd={() => {
                              setDragKey(null);
                              setHoverIndex(null);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (!dragKey) return;
                              const target = e.currentTarget as HTMLDivElement;
                              const rect = target.getBoundingClientRect();
                              const middle = rect.top + rect.height / 2;
                              setHoverIndex(i);
                              setHoverBefore(e.clientY < middle);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const movingKey = (e.dataTransfer.getData('text/plain') || dragKey) as ColKey | null;
                              if (!movingKey) return;

                              const fromIndex = columnOrder.indexOf(movingKey);
                              if (fromIndex === -1) return;

                              let toIndex = i + (hoverBefore ? 0 : 1);
                              if (toIndex > columnOrder.length) toIndex = columnOrder.length;

                              if (fromIndex === toIndex || fromIndex + 1 === toIndex) {
                                setDragKey(null);
                                setHoverIndex(null);
                                return;
                              }

                              const next = columnOrder.slice();
                              const [moved] = next.splice(fromIndex, 1);
                              const actualTo = fromIndex < toIndex ? toIndex - 1 : toIndex;
                              next.splice(actualTo, 0, moved as ColKey);

                              setColumnOrder(next);
                              hasOrderChangesRef.current = true;
                              setDragKey(null);
                              setHoverIndex(null);
                            }}
                            className={`flex items-center justify-between gap-3 rounded-md border p-2 mb-2 cursor-grab select-none ${dragKey === key ? 'opacity-80 ring-2 ring-blue-400 bg-blue-50' : 'bg-gray-50 hover:bg-gray-100'
                              }`}
                          >
                            <div className="flex items-center gap-3">
                              {/* Handle */}
                              <span className="text-gray-500">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                  <path d="M10 4H4V10H10V4Z M20 4H14V10H20V4Z M10 14H4V20H10V14Z M20 14H14V20H20V14Z" stroke="currentColor" strokeWidth="1" />
                                </svg>
                              </span>
                              <span className="font-medium text-gray-800">{col.label}</span>
                            </div>
                            <span className="text-xs text-gray-500">{key}</span>
                          </div>

                          {/* Línea guía después del item */}
                          {dragKey && hoverIndex === i && !hoverBefore && (
                            <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => {
                        setColumnOrder(BASE_COLS.map(c => c.key));
                        hasOrderChangesRef.current = true;
                      }}
                      className="cursor-pointer px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm"
                    >
                      Restablecer orden predeterminado
                    </button>
                    <button
                      onClick={handleBackFromSubview}
                      className="cursor-pointer px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm"
                    >
                      Guardar y volver
                    </button>
                  </div>
                </div>
              )}
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
    // Devuelve SIEMPRE #RRGGBB si es válido (#RGB expandido).
    let s = v.trim();
    if (!s.startsWith('#')) s = `#${s}`;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      const r = s[1], g = s[2], b = s[3];
      s = `#${r}${r}${g}${g}${b}${b}`;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
    return s.toUpperCase();
  }

  function normalizeColumnOrder(raw: string[]): ColKey[] {
    const baseKeys = BASE_COLS.map(c => c.key);
    const filtered = raw.filter((k): k is ColKey => (baseKeys as string[]).includes(k));
    const missing = baseKeys.filter(k => !filtered.includes(k as ColKey)) as ColKey[];
    return [...filtered, ...missing];
  }

  async function persistAllPrefs(nextColors: Record<BaseStateKey, string>, nextOrder: ColKey[]) {
    if (!auth.currentUser) return;
    try {
      const idToken = await auth.currentUser.getIdToken();
      await fetch('/api/admin-user-prefs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          stateColors: nextColors,
          columnOrder: nextOrder,
        }),
      });
    } catch {
      // no bloquear UI si falla
    }
  }

  // Marca sucio y actualiza, sin llamar a la API.
  function markColorsDirty() {
    hasColorChangesRef.current = true;
  }

  function handleColorChange(key: BaseStateKey, hex: string) {
    const n = normalizeHex(hex);
    setStateBaseColors((prev) => ({ ...prev, [key]: n }));
    markColorsDirty();
  }

  // Borrador de texto para el input HEX
  function handleHexDraftChange(key: BaseStateKey, raw: string) {
    const s = raw.replace(/\s/g, '');
    if (!/^#?[0-9a-fA-F]{0,6}$/.test(s)) return; // ignora caracteres inválidos
    const withHash = s.startsWith('#') ? s.toUpperCase() : ('#' + s.toUpperCase());
    setHexDrafts(prev => ({ ...prev, [key]: withHash }));
  }

  // Consolida el borrador cuando sea #RGB o #RRGGBB; si no es válido, restaura
  function commitHexDraft(key: BaseStateKey) {
    const s0 = (hexDrafts[key] || '').toUpperCase();
    const s = s0.startsWith('#') ? s0 : ('#' + s0);

    if (/^#[0-9A-F]{3}$/.test(s)) {
      const full = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
      setStateBaseColors(prev => ({ ...prev, [key]: full }));
      setHexDrafts(prev => ({ ...prev, [key]: full }));
      markColorsDirty();
    } else if (/^#[0-9A-F]{6}$/.test(s)) {
      setStateBaseColors(prev => ({ ...prev, [key]: s }));
      setHexDrafts(prev => ({ ...prev, [key]: s }));
      markColorsDirty();
    } else {
      // inválido: vuelve al valor confirmado actual
      setHexDrafts(prev => ({ ...prev, [key]: stateBaseColors[key] }));
    }
  }

  function resetOne(key: BaseStateKey) {
    const def = DEFAULT_BASE_COLORS[key];
    setStateBaseColors((prev) => ({ ...prev, [key]: def }));
    setHexDrafts(prev => ({ ...prev, [key]: def }));
    markColorsDirty();
  }

  function resetAll() {
    const all = { ...DEFAULT_BASE_COLORS };
    setStateBaseColors(all);
    setHexDrafts(all);
    markColorsDirty();
  }
}

/* ====== Componente: Swatch cuadrado ====== */
function ColorSwatch({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="flex items-center gap-2">
      {/* Botón cuadrado estilo muestra */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer inline-flex items-center justify-center w-8 h-8 rounded border border-gray-400 shadow-inner"
        style={{
          backgroundColor: value,
          boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.6)',
        }}
        title={value}
        aria-label="Elegir color"
      />
      {/* input color oculto visualmente pero accesible */}
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        aria-label="Selector de color"
      />
    </div>
  );
}
