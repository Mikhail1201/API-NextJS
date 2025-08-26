'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '@/app/firebase/config';
import { useAuthState } from 'react-firebase-hooks/auth';

type Status = 'P' | 'A' | 'T' | 'J' | 'N';
type Assistant = { id: string; fullName: string; documentNumber: string; active?: boolean };
type AssistanceDoc = {
  assistantId: string;
  month: string; // YYYY-MM
  days: Record<string, Status | undefined>;
  totals?: { asistencia: number; ausencia: number; tardanza: number; justificacion: number; laborables: number };
};
type ApiGetResponse = { assistants: Assistant[]; assistance: AssistanceDoc[] };

const STATUS_ORDER: Status[] = ['P', 'A', 'T', 'J'];
const DOC_COL_W = 150;  // px
const NAME_COL_W = 260; // px

function toMonthString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
function daysInMonth(year: number, month1to12: number) {
  return new Date(year, month1to12, 0).getDate();
}
function monthMeta(monthStr: string) {
  const [yearS, monthS] = monthStr.split('-');
  const year = Number(yearS);
  const month = Number(monthS);
  const total = daysInMonth(year, month);
  const letters = ['D', 'L', 'M', 'M', 'J', 'V', 'S'] as const;
  const items = Array.from({ length: total }, (_, i) => {
    const day = i + 1;
    const d = new Date(year, month - 1, day);
    const dow = d.getDay(); // 0..6
    const isWeekend = dow === 0 || dow === 6;
    const iso = d.toISOString().slice(0, 10);
    return { day, iso, dow, letter: letters[dow], isWeekend };
  });
  return { year, month, total, items };
}
function computeTotals(map: Record<string, Status | undefined>, meta: ReturnType<typeof monthMeta>) {
  let P = 0, A = 0, T = 0, J = 0, laborables = 0;
  for (const it of meta.items) {
    if (it.isWeekend) continue;
    laborables++;
    const s = map[it.iso];
    if (s === 'P') P++; else if (s === 'A') A++; else if (s === 'T') T++; else if (s === 'J') J++;
  }
  return { asistencia: laborables ? P / laborables : 0, ausencia: A, tardanza: T, justificacion: J, laborables };
}

export default function AssistancePage() {
  const [month, setMonth] = useState<string>(toMonthString());
  const [mode, setMode] = useState<'table' | 'form'>('table');
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [assistMap, setAssistMap] = useState<Record<string, AssistanceDoc>>({});
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  // Auth state (espera a que cargue antes de hacer fetch)
  const [user, userLoading] = useAuthState(auth);

  // Form
  const [fullName, setFullName] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');

  const meta = useMemo(() => monthMeta(month), [month]);

  // ---- altura dinámica como en Reports ----
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [tableHeight, setTableHeight] = useState<number>(520); // fallback

  useEffect(() => {
    function recalc() {
      const el = cardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const bottomGap = 24; // px de respiración
      const h = Math.max(320, Math.floor(window.innerHeight - rect.top - bottomGap));
      setTableHeight(h);
    }
    recalc();
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, []);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = cardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const bottomGap = 24;
      const h = Math.max(320, Math.floor(window.innerHeight - rect.top - bottomGap));
      setTableHeight(h);
    });
    return () => cancelAnimationFrame(id);
  }, [mode, month, q]);

  // ===== Carga de asistentes/asistencias (GET) — espera a Auth =====
  useEffect(() => {
    let ignore = false;

    (async () => {
      if (userLoading) return; // espera a que Auth termine

      // si no hay usuario, limpia y no llames al backend
      if (!user) {
        setAssistants([]);
        setAssistMap({});
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const idToken = await user.getIdToken(); // ← token del user
        const res = await fetch(`/api/admin-assistance?month=${month}`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${idToken}` },
        });

        if (!res.ok) {
          const msg = await res.text();
          throw new Error(`GET /admin-assistance ${res.status}: ${msg}`);
        }

        const data: ApiGetResponse = await res.json();
        if (ignore) return;

        setAssistants(data.assistants || []);
        const map: Record<string, AssistanceDoc> = {};
        for (const a of data.assistants || []) {
          map[a.id] = {
            assistantId: a.id,
            month,
            days: {},
            ...(data.assistance || []).find((d) => d.assistantId === a.id),
          };
        }
        setAssistMap(map);
      } catch (e) {
        console.error(e);
        setAssistants([]);
        setAssistMap({});
      } finally {
        if (!ignore) setLoading(false);
      }
    })();

    return () => { ignore = true; };
  }, [month, user, userLoading]);

  async function saveDay(assistantId: string, isoDate: string, status: Status) {
    // actualización optimista en UI
    setAssistMap((prev) => {
      const next = { ...prev };
      const doc = { ...next[assistantId] };
      doc.days = { ...doc.days, [isoDate]: status };
      doc.totals = computeTotals(doc.days, meta);
      next[assistantId] = doc;
      return next;
    });

    try {
      if (userLoading) return;
      if (!user) throw new Error('Sesión no válida');

      const idToken = await user.getIdToken();

      await fetch('/api/admin-assistance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ assistantId, date: isoDate, status, month }),
      });
    } catch (e) {
      console.error(e);
    }
  }

  /* =================== Fin de semana editable por columna =================== */
  // columnas de fin de semana desbloqueadas (por ISO: YYYY-MM-DD)
  const [unlockedWeekendCols, setUnlockedWeekendCols] = useState<Record<string, boolean>>({});
  function isWeekendEditable(iso: string) {
    return !!unlockedWeekendCols[iso];
  }
  function toggleWeekend(iso: string) {
    setUnlockedWeekendCols(prev => ({ ...prev, [iso]: !prev[iso] }));
  }

  function cycleStatus(current: Status | undefined, isWeekend: boolean, iso: string): Status {
    // si es fin de semana pero la columna está bloqueada: no se edita
    if (isWeekend && !isWeekendEditable(iso)) return 'N';
    const i = STATUS_ORDER.indexOf((current as Status) || '');
    return i < 0 ? 'P' : STATUS_ORDER[(i + 1) % STATUS_ORDER.length];
  }

  async function handleCellClick(aid: string, iso: string, isWeekend: boolean) {
    const current = assistMap[aid]?.days?.[iso];
    const next = cycleStatus(current, isWeekend, iso);
    if (next === 'N') return;
    await saveDay(aid, iso, next);
  }

  // ===== Crear asistente (POST) — espera a Auth y usa token del user =====
  async function handleCreateAssistant(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !documentNumber.trim()) return;

    try {
      if (userLoading) return;              // espera a Auth
      if (!user) throw new Error('Sesión no válida');

      const idToken = await user.getIdToken();

      const payload = {
        fullName: fullName.trim(),
        documentNumber: documentNumber.trim(),
      };

      const res = await fetch('/api/admin-assistance?createAssistant=1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`, // ⬅️ obligatorio
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const msg = await res.text();
        console.error('Error al crear asistente:', msg);
        alert('No se pudo crear el asistente.\n\n' + msg);
        return; // no muestres success si falla
      }

      // limpiar y refrescar
      setFullName('');
      setDocumentNumber('');
      setMode('table');
      setMonth((m) => m); // re-dispara el GET

      // SuccessDiv
      let seconds = 2;
      const successDiv = document.createElement('div');
      successDiv.className =
        'fixed bottom-4 right-4 bg-green-500 text-white p-4 rounded-lg shadow-lg ' +
        'flex items-center gap-2 opacity-0 transition-opacity duration-500 z-50';
      successDiv.innerHTML = `
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M9 12l2 2 4-4m5.586-6.586a2 2 0 00-2.828 0l-10 10a2 2 0 000 2.828l3.172 3.172a2 2 0 002.828 0l10-10a2 2 0 000-2.828z"></path>
        </svg>
        <span>¡Asistente agregado exitosamente! Actualizando en <span id="countdown">${seconds}</span>…</span>
      `;
      document.body.appendChild(successDiv);
      setTimeout(() => successDiv.classList.add('opacity-100'), 10);

      const countdownInterval = setInterval(() => {
        seconds -= 1;
        const span = successDiv.querySelector('#countdown');
        if (span) span.textContent = String(seconds);
        if (seconds <= 0) {
          clearInterval(countdownInterval);
          successDiv.classList.remove('opacity-100');
          setTimeout(() => successDiv.remove(), 400);
        }
      }, 1000);
    } catch (err) {
      console.error(err);
      alert('Ocurrió un error inesperado al crear el asistente.');
    }
  }

  // 🔍 Filtro (nombre o documento)
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return assistants;
    return assistants.filter(a =>
      a.fullName.toLowerCase().includes(t) || a.documentNumber?.toLowerCase().includes(t)
    );
  }, [assistants, q]);

  return (
    <div className="relative z-10 px-4 py-6">
      {/* Título y filtros (NO sticky) */}
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold text-white text-center drop-shadow">Asistencias</h1>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <input
            type="search"
            placeholder="Buscar por nombre o documento…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-72 bg-white text-gray-800 border border-gray-300 rounded px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <div className="flex items-center gap-2">
            <span className="text-sm text-white/80">Mes:</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="bg-white text-gray-800 border border-gray-300 rounded px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            onClick={() => setMode(mode === 'table' ? 'form' : 'table')}
            className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            {mode === 'table' ? 'Agregar asistente' : 'Volver a la tabla'}
          </button>
        </div>
      </div>

      {mode === 'form' ? (
        <div className="mt-6 flex justify-center">
          <form
            onSubmit={handleCreateAssistant}
            className="w-full max-w-md space-y-4 bg-white/95 p-6 rounded-xl shadow-xl text-gray-900"
          >
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                Nombre completo
              </label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nombre completo"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 placeholder-gray-400
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                Nº Documento
              </label>
              <input
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                placeholder="Nº Documento"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 placeholder-gray-400
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>

            <button
              type="submit"
              disabled={userLoading || !user}
              className="block mx-auto px-5 py-2.5 rounded-lg bg-green-600 text-white font-medium
                hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60"
            >
              Guardar
            </button>
          </form>
        </div>
      ) : (
        <div ref={cardRef} className="bg-white rounded-xl shadow-xl overflow-hidden relative z-10 mt-6">
          {/* Scroll horizontal */}
          <div className="overflow-x-auto">
            {/* Altura ajustada a pantalla + scroll vertical interno */}
            <div className="overflow-y-auto" style={{ height: tableHeight }}>
              <table className="min-w-[1100px] w-full text-sm text-gray-800">
                <thead>
                  {/* Fila 1: títulos (número del día) */}
                  <tr className="bg-gray-100 text-gray-700">
                    <th
                      className="px-2 py-2 text-left sticky left-0 bg-gray-100 z-10"
                      style={{ width: DOC_COL_W, minWidth: DOC_COL_W }}
                    >
                      Nº Documento
                    </th>
                    <th
                      className="px-2 py-2 text-left sticky bg-gray-100 z-10"
                      style={{ left: DOC_COL_W, width: NAME_COL_W, minWidth: NAME_COL_W }}
                    >
                      Nombres y Apellidos
                    </th>
                    {meta.items.map((d) => (
                      <th key={d.iso} className="px-1 py-2 text-center w-8">
                        <button
                          type="button"
                          onClick={() => d.isWeekend && toggleWeekend(d.iso)}
                          className={`w-8 h-8 rounded text-xs font-semibold ${d.isWeekend ? 'hover:bg-gray-200' : ''}`}
                          title={
                            d.isWeekend
                              ? (isWeekendEditable(d.iso) ? 'Bloquear columna' : 'Desbloquear columna')
                              : undefined
                          }
                        >
                          {d.day}
                          {d.isWeekend ? (isWeekendEditable(d.iso) ? ' 🔓' : ' 🔒') : ''}
                        </button>
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center">ASISTENCIA</th>
                    <th className="px-2 py-2 text-center">AUSENCIA</th>
                    <th className="px-2 py-2 text-center">TARDANZA</th>
                    <th className="px-2 py-2 text-center">JUSTIFICACIÓN</th>
                  </tr>

                  {/* Fila 2: letra del día (sticky dentro del scroll vertical) */}
                  <tr className="bg-gray-50 text-gray-700 sticky top-0 z-10">
                    <th
                      className="px-2 py-1 sticky left-0 bg-gray-50 z-10"
                      style={{ width: DOC_COL_W, minWidth: DOC_COL_W }}
                    ></th>
                    <th
                      className="px-2 py-1 sticky bg-gray-50 z-10"
                      style={{ left: DOC_COL_W, width: NAME_COL_W, minWidth: NAME_COL_W }}
                    ></th>
                    {meta.items.map((d) => (
                      <th key={d.iso} className="px-1 py-1 text-center w-8">
                        <button
                          type="button"
                          onClick={() => d.isWeekend && toggleWeekend(d.iso)}
                          className={`w-8 h-6 rounded text-xs ${d.isWeekend ? 'hover:bg-gray-200' : ''}`}
                          title={
                            d.isWeekend
                              ? (isWeekendEditable(d.iso) ? 'Bloquear columna' : 'Desbloquear columna')
                              : undefined
                          }
                        >
                          {d.letter}
                        </button>
                      </th>
                    ))}
                    <th className="px-2 py-1"></th>
                    <th className="px-2 py-1"></th>
                    <th className="px-2 py-1"></th>
                    <th className="px-2 py-1"></th>
                  </tr>
                </thead>

                <tbody className="align-middle">
                  {loading && (
                    <tr>
                      <td colSpan={meta.total + 6} className="text-center py-6 text-gray-500">Cargando…</td>
                    </tr>
                  )}

                  {!loading && filtered.map((a) => {
                    const doc = assistMap[a.id] || { assistantId: a.id, month, days: {} };
                    const totals = computeTotals(doc.days, meta);
                    return (
                      <tr key={a.id} className="border-t">
                        {/* stickies */}
                        <td
                          className="px-2 py-1 sticky left-0 bg-white z-10 text-gray-800"
                          style={{ width: DOC_COL_W, minWidth: DOC_COL_W }}
                        >
                          {a.documentNumber}
                        </td>
                        <td
                          className="px-2 py-1 sticky bg-white z-10 text-gray-900 font-medium"
                          style={{ left: DOC_COL_W, width: NAME_COL_W, minWidth: NAME_COL_W }}
                        >
                          {a.fullName}
                        </td>

                        {/* días */}
                        {meta.items.map((d) => {
                          const weekendLocked = d.isWeekend && !isWeekendEditable(d.iso);
                          const s = weekendLocked ? 'N' : (doc.days[d.iso] as Status | undefined);

                          const color =
                            s === 'P' ? 'bg-green-500 text-white' :
                            s === 'A' ? 'bg-red-500 text-white' :
                            s === 'T' ? 'bg-amber-500 text-white' :
                            s === 'J' ? 'bg-blue-500 text-white' :
                            weekendLocked ? 'bg-gray-200 text-gray-500' : 'bg-gray-100 text-gray-700';

                          const label =
                            s === 'P' ? 'P' : s === 'A' ? 'A' : s === 'T' ? 'T' : s === 'J' ? 'J' : '—';

                          return (
                            <td key={d.iso} className="px-0.5 py-1 text-center">
                              <button
                                type="button"
                                className={`w-7 h-7 rounded text-xs font-bold ${color}`}
                                onClick={() => handleCellClick(a.id, d.iso, d.isWeekend)}
                                title={d.isWeekend ? (weekendLocked ? 'Fin de semana (bloqueado)' : 'Fin de semana (editable)') : 'Clic para cambiar estado'}
                              >
                                {label}
                              </button>
                            </td>
                          );
                        })}

                        {/* totales */}
                        <td className="px-2 py-1 text-center font-medium">{Math.round(totals.asistencia * 100)}%</td>
                        <td className="px-2 py-1 text-center">{totals.ausencia}</td>
                        <td className="px-2 py-1 text-center">{totals.tardanza}</td>
                        <td className="px-2 py-1 text-center">{totals.justificacion}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
