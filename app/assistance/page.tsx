'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/app/firebase/config';
import { useAuthState } from 'react-firebase-hooks/auth';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

type Status = 'P' | 'A' | 'T' | 'J' | 'N';
type Assistant = { id: string; fullName: string; documentNumber: string; active?: boolean };
type AssistanceDoc = {
    assistantId: string;
    month: string; // YYYY-MM
    days: Record<string, Status | undefined>;
    notes?: Record<string, string | undefined>;
    totals?: { asistencia: number; ausencia: number; tardanza: number; justificacion: number; laborables: number };
};
type ApiGetResponse = {
    assistants: Assistant[];
    assistance: AssistanceDoc[];
    notesByAssistant?: Record<string, Record<string, string>>;
};
type UserDoc = {
    role: string;
    // add other fields if needed
};

const STATUS_ORDER: Status[] = ['P', 'A', 'T', 'J'];
const DOC_COL_W = 150;
const NAME_COL_W = 260;

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
        const dow = d.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const iso = d.toISOString().slice(0, 10);
        return { day, iso, dow, letter: letters[dow], isWeekend };
    });
    return { year, month, total, items };
}
function computeTotals(
    map: Record<string, Status | undefined>,
    meta: ReturnType<typeof monthMeta>,
    unlockedWeekendCols: Record<string, boolean>
) {
    let P = 0, A = 0, T = 0, J = 0, laborables = 0;
    for (const it of meta.items) {
        if (it.isWeekend && !unlockedWeekendCols[it.iso]) continue;
        laborables++;
        const s = map[it.iso];
        if (s === 'P') P++; else if (s === 'A') A++; else if (s === 'T') T++; else if (s === 'J') J++;
    }
    return { asistencia: laborables ? P / laborables : 0, ausencia: A, tardanza: T, justificacion: J, laborables };
}

export default function AssistancePage() {
    const router = useRouter();
    const db = getFirestore();

    // auth + guardia superadmin (cliente)
    const [user, userLoading] = useAuthState(auth);
    const [roleChecked, setRoleChecked] = useState(false);

    useEffect(() => {
        (async () => {
            if (userLoading) return;
            if (!user) { router.push('/'); return; }
            const snap = await getDoc(doc(db, 'users', user.uid));
            const role = snap.exists() ? (snap.data() as UserDoc).role : '';
            if (role !== 'superadmin') { router.push('/'); return; }
            setRoleChecked(true);
        })();
    }, [user, userLoading, db, router]);

    // estado general
    const [month, setMonth] = useState<string>(toMonthString());
    const [mode, setMode] = useState<'table' | 'add' | 'delete'>('table');
    const [assistants, setAssistants] = useState<Assistant[]>([]);
    const [assistMap, setAssistMap] = useState<Record<string, AssistanceDoc>>({});
    const [loading, setLoading] = useState(false);
    const [q, setQ] = useState('');

    // forms
    const [fullName, setFullName] = useState('');
    const [documentNumber, setDocumentNumber] = useState('');
    const [assistantToDelete, setAssistantToDelete] = useState('');

    // confirmación de eliminación (con contraseña)
    const [showConfirm, setShowConfirm] = useState(false);
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [showSuccess, setShowSuccess] = useState(false);

    const meta = useMemo(() => monthMeta(month), [month]);

    // altura como Reports
    const cardRef = useRef<HTMLDivElement | null>(null);
    const [tableHeight, setTableHeight] = useState<number>(520);
    useEffect(() => {
        function recalc() {
            const el = cardRef.current; if (!el) return;
            const rect = el.getBoundingClientRect();
            setTableHeight(Math.max(320, Math.floor(window.innerHeight - rect.top - 24)));
        }
        recalc();
        window.addEventListener('resize', recalc);
        return () => window.removeEventListener('resize', recalc);
    }, []);
    useEffect(() => {
        if (!roleChecked || mode !== 'table') return;

        const measure = () => {
            const el = cardRef.current; if (!el) return;
            const rect = el.getBoundingClientRect();
            setTableHeight(Math.max(320, Math.floor(window.innerHeight - rect.top - 24)));
        };

        // mide inmediatamente y luego en el próximo frame
        measure();
        const id = requestAnimationFrame(measure);
        return () => cancelAnimationFrame(id);
    }, [roleChecked, mode, month, q, assistants.length]);


    // cargar datos (servidor también exige superadmin; si responde 403 → home)
    useEffect(() => {
        let ignore = false;
        (async () => {
            if (!roleChecked) return;
            setLoading(true);
            try {
                const idToken = await user!.getIdToken();
                const res = await fetch(`/api/admin-assistance?month=${month}`, {
                    cache: 'no-store',
                    headers: { Authorization: `Bearer ${idToken}` },
                });
                if (res.status === 403) { router.push('/'); return; }
                if (!res.ok) throw new Error(await res.text());
                const data: ApiGetResponse = await res.json();
                if (ignore) return;
                const notesByAssistant = data.notesByAssistant || {};
                setAssistants(data.assistants || []);
                const map: Record<string, AssistanceDoc> = {};
                const allAssistance = data.assistance || [];
                for (const a of data.assistants || []) {
                    const found = allAssistance.find((d) => d.assistantId === a.id) as AssistanceDoc | undefined;
                    map[a.id] = {
                        assistantId: a.id,
                        month,
                        days: found?.days ?? {},
                        notes: notesByAssistant[a.id] ?? {},
                        totals: found?.totals,
                    };
                }
                setAssistMap(map);
            } catch (e) {
                console.error(e);
                setAssistants([]); setAssistMap({});
            } finally { if (!ignore) setLoading(false); }
        })();
        return () => { ignore = true; };
    }, [month, roleChecked, router, user]);

    // fines de semana desbloqueables
    const [unlockedWeekendCols, setUnlockedWeekendCols] = useState<Record<string, boolean>>({});
    const isWeekendEditable = (iso: string) => !!unlockedWeekendCols[iso];
    const toggleWeekend = (iso: string) => setUnlockedWeekendCols(p => ({ ...p, [iso]: !p[iso] }));
    useEffect(() => {
        setAssistMap(prev => {
            const next: typeof prev = {};
            for (const [aid, doc] of Object.entries(prev)) {
                const clone = { ...doc };
                clone.totals = computeTotals(clone.days || {}, meta, unlockedWeekendCols);
                next[aid] = clone;
            }
            return next;
        });
    }, [unlockedWeekendCols, meta]);

    // guardar estados
    async function saveDay(assistantId: string, isoDate: string, status: Status) {
        setAssistMap(prev => {
            const next = { ...prev };
            const doc = { ...next[assistantId] };
            doc.days = { ...doc.days, [isoDate]: status };
            doc.totals = computeTotals(doc.days, meta, unlockedWeekendCols);
            next[assistantId] = doc;
            return next;
        });
        try {
            const idToken = await user!.getIdToken();
            await fetch('/api/admin-assistance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({ assistantId, date: isoDate, status, month }),
            });
        } catch (e) { console.error(e); }
    }
    function cycleStatus(current: Status | undefined, isWeekend: boolean, iso: string): Status {
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

    // agregar asistente
    async function handleCreateAssistant(e: React.FormEvent) {
        e.preventDefault();
        if (!fullName.trim() || !documentNumber.trim()) return;
        try {
            const idToken = await user!.getIdToken();
            const resp = await fetch('/api/admin-assistance?createAssistant=1', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({ fullName: fullName.trim(), documentNumber: documentNumber.trim() }),
            });
            if (!resp.ok) { alert(await resp.text()); return; }
            setFullName(''); setDocumentNumber(''); setMode('table'); setMonth(m => m);
            setShowSuccess(true); setTimeout(() => setShowSuccess(false), 2000);
        } catch (err) { console.error(err); alert('Error al crear asistente'); }
    }

    // eliminar asistente (con confirmación de contraseña)
    async function doDeleteAssistant() {
        try {
            setPasswordError('');
            if (!user?.email) { setPasswordError('Sesión inválida.'); return; }
            // re-autenticar
            await signInWithEmailAndPassword(auth, user.email, confirmPassword);
            const idToken = await user.getIdToken();
            const resp = await fetch('/api/admin-assistance?deleteAssistant=1', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({ assistantId: assistantToDelete }),
            });
            if (!resp.ok) { setPasswordError(await resp.text()); return; }
            // actualizar UI
            setAssistants(prev => prev.filter(a => a.id !== assistantToDelete));
            setAssistMap(prev => {
                const n = { ...prev } as Record<string, AssistanceDoc>;
                delete n[assistantToDelete];
                return n;
            });
            setAssistantToDelete('');
            setShowConfirm(false);
            setConfirmPassword('');
            setMode('table');
            setShowSuccess(true); setTimeout(() => setShowSuccess(false), 2000);
        } catch {
            setPasswordError('Contraseña incorrecta. Inténtelo de nuevo.');
        }
    }

    // notas (context menu)
    type NoteEditor = { assistantId: string; iso: string; x: number; y: number; value: string };
    const [noteEditor, setNoteEditor] = useState<NoteEditor | null>(null);
    function openNoteEditor(e: React.MouseEvent, aid: string, iso: string) {
        e.preventDefault();
        const current = assistMap[aid]?.notes?.[iso] ?? '';
        setNoteEditor({ assistantId: aid, iso, x: e.clientX, y: e.clientY, value: String(current) });
    }
    useEffect(() => {
        if (!noteEditor) return;
        const latest = assistMap[noteEditor.assistantId]?.notes?.[noteEditor.iso] ?? '';
        if (latest !== noteEditor.value) setNoteEditor({ ...noteEditor, value: String(latest) });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assistMap]);
    async function saveNote(aid: string, iso: string, text: string) {
        setAssistMap(prev => {
            const next = { ...prev };
            const doc = { ...next[aid] };
            const notes = { ...(doc.notes || {}) };
            if (text.trim() === '') delete notes[iso]; else notes[iso] = text;
            doc.notes = notes; next[aid] = doc; return next;
        });
        try {
            const idToken = await user!.getIdToken();
            await fetch('/api/admin-assistance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({ assistantId: aid, date: iso, note: text, month }),
            });
        } catch (err) { console.error(err); }
    }
    useEffect(() => {
        function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setNoteEditor(null); }
        function onClick(e: MouseEvent) {
            const n = document.getElementById('note-popover');
            if (n && !n.contains(e.target as Node)) setNoteEditor(null);
        }
        if (noteEditor) { window.addEventListener('keydown', onKey); window.addEventListener('mousedown', onClick); }
        return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick); };
    }, [noteEditor]);

    const filtered = useMemo(() => {
        const t = q.trim().toLowerCase();
        if (!t) return assistants;
        return assistants.filter(a => a.fullName.toLowerCase().includes(t) || a.documentNumber?.toLowerCase().includes(t));
    }, [assistants, q]);

    if (userLoading || !roleChecked) return null;

    return (
        <div className="relative h-screen px-4 py-6 overflow-hidden">
            {/* Botón REGRESAR idéntico al de Reports */}
            <button
                onClick={() => router.push('/')}
                className="absolute top-4 left-4 z-20 bg-white/90 hover:bg-white text-blue-600 p-3 rounded-full shadow-md transition cursor-pointer"
                aria-label="Volver al inicio"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
            </button>

            {/* éxito */}
            {showSuccess && (
                <div className="fixed bottom-4 right-4 bg-green-500 text-white p-4 rounded-lg shadow-lg flex items-center gap-2 z-50 animate-fadeInDown">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.586-6.586a2 2 0 00-2.828 0l-10 10a2 2 0 000 2.828l3.172 3.172a2 2 0 002.828 0l10-10a2 2 0 000-2.828z" />
                    </svg>
                    <span>¡Operación exitosa!</span>
                </div>
            )}

            {/* Header y acciones */}
            <div className="space-y-3">
                <h1 className="text-2xl sm:text-3xl font-semibold text-white text-center drop-shadow">Asistencias</h1>
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

                    {mode === 'table' ? (
                        <>
                            <button onClick={() => setMode('add')} className="cursor-pointer px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">
                                Agregar asistente
                            </button>
                            <button onClick={() => setMode('delete')} className="cursor-pointer px-3 py-2 rounded bg-rose-600 text-white hover:bg-rose-700">
                                Eliminar asistente
                            </button>
                        </>
                    ) : (
                        <button onClick={() => setMode('table')} className="cursor-pointer px-3 py-2 rounded bg-slate-600 text-white hover:bg-slate-700">
                            Volver a la tabla
                        </button>
                    )}
                </div>
            </div>

            {/* Form agregar */}
            {mode === 'add' && (
                <div className="mt-6 flex justify-center">
                    <form onSubmit={handleCreateAssistant} className="w-full max-w-md space-y-4 bg-white/95 p-6 rounded-2xl shadow-xl text-gray-900">
                        <div>
                            <label className="block text-sm font-semibold text-gray-800 mb-1">Nombre completo</label>
                            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre completo"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" required />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-800 mb-1">Nº Documento</label>
                            <input value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} placeholder="Nº Documento"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" required />
                        </div>
                        <button type="submit" className="cursor-pointer block mx-auto px-5 py-2.5 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
                            Guardar
                        </button>
                    </form>
                </div>
            )}

            {/* Form eliminar */}
            {mode === 'delete' && (
                <div className="mt-6 flex justify-center">
                    <form
                        onSubmit={(e) => { e.preventDefault(); if (assistantToDelete) setShowConfirm(true); }}
                        className="w-full max-w-md space-y-4 bg-white/95 p-6 rounded-2xl shadow-xl text-gray-900"
                    >
                        <div>
                            <label className="block text-sm font-semibold text-gray-800 mb-1">Seleccione asistente</label>
                            <select
                                value={assistantToDelete}
                                onChange={(e) => setAssistantToDelete(e.target.value)}
                                className="w-full p-3 rounded-lg border border-gray-300 text-gray-900 bg-white"
                                required
                            >
                                <option value="" disabled>— Elige un asistente —</option>
                                {assistants.map(a => (
                                    <option key={a.id} value={a.id}>{a.fullName} — {a.documentNumber}</option>
                                ))}
                            </select>
                        </div>
                        <button type="submit" className="cursor-pointer w-full bg-rose-600 hover:bg-rose-700 text-white font-semibold py-3 rounded-lg transition">
                            Eliminar asistente
                        </button>
                    </form>
                </div>
            )}

            {/* Tabla */}
            {mode === 'table' && (
                <div ref={cardRef} className="bg-white rounded-xl shadow-xl overflow-hidden relative z-10 mt-6">
                    <div className="overflow-x-auto">
                        <div className="overflow-y-auto" style={{ height: tableHeight }}>
                            <table className="min-w-[1100px] w-full text-sm text-gray-800">
                                <thead>
                                    <tr className="bg-gray-100 text-gray-700">
                                        <th className="px-2 py-2 text-left sticky left-0 bg-gray-100 z-10" style={{ width: DOC_COL_W, minWidth: DOC_COL_W }}>Nº Documento</th>
                                        <th className="px-2 py-2 text-left sticky bg-gray-100 z-10" style={{ left: DOC_COL_W, width: NAME_COL_W, minWidth: NAME_COL_W }}>Nombres y Apellidos</th>
                                        {meta.items.map((d) => (
                                            <th key={d.iso} className="px-1 py-2 text-center w-8">
                                                <button type="button" onClick={() => d.isWeekend && toggleWeekend(d.iso)}
                                                    className={`cursor-pointer w-8 h-8 rounded text-xs font-semibold ${d.isWeekend ? 'hover:bg-gray-200' : ''}`}
                                                    title={d.isWeekend ? (isWeekendEditable(d.iso) ? 'Bloquear columna' : 'Desbloquear columna') : undefined}>
                                                    {d.day}{d.isWeekend ? (isWeekendEditable(d.iso) ? ' 🔓' : ' 🔒') : ''}
                                                </button>
                                            </th>
                                        ))}
                                        <th className="px-2 py-2 text-center">ASISTENCIA</th>
                                        <th className="px-2 py-2 text-center">AUSENCIA</th>
                                        <th className="px-2 py-2 text-center">TARDANZA</th>
                                        <th className="px-2 py-2 text-center">JUSTIFICACIÓN</th>
                                    </tr>
                                    <tr className="bg-gray-50 text-gray-700 sticky top-0 z-10">
                                        <th className="px-2 py-1 sticky left-0 bg-gray-50 z-10" style={{ width: DOC_COL_W, minWidth: DOC_COL_W }}></th>
                                        <th className="px-2 py-1 sticky bg-gray-50 z-10" style={{ left: DOC_COL_W, width: NAME_COL_W, minWidth: NAME_COL_W }}></th>
                                        {meta.items.map((d) => (
                                            <th key={d.iso} className="px-1 py-1 text-center w-8">
                                                <button type="button" onClick={() => d.isWeekend && toggleWeekend(d.iso)}
                                                    className={`cursor-pointer w-8 h-6 rounded text-xs ${d.isWeekend ? 'hover:bg-gray-200' : ''}`}
                                                    title={d.isWeekend ? (isWeekendEditable(d.iso) ? 'Bloquear columna' : 'Desbloquear columna') : undefined}>
                                                    {d.letter}
                                                </button>
                                            </th>
                                        ))}
                                        <th className="px-2 py-1"></th><th className="px-2 py-1"></th><th className="px-2 py-1"></th><th className="px-2 py-1"></th>
                                    </tr>
                                </thead>
                                <tbody className="align-middle">
                                    {loading && <tr><td colSpan={meta.total + 6} className="text-center py-6 text-gray-500">Cargando…</td></tr>}
                                    {!loading && filtered.map((a) => {
                                        const docu = assistMap[a.id] || { assistantId: a.id, month, days: {}, notes: {} };
                                        const totals = computeTotals(docu.days, meta, unlockedWeekendCols);
                                        return (
                                            <tr key={a.id} className="border-t">
                                                <td className="px-2 py-1 sticky left-0 bg-white z-10 text-gray-800" style={{ width: DOC_COL_W, minWidth: DOC_COL_W }}>{a.documentNumber}</td>
                                                <td className="px-2 py-1 sticky bg-white z-10 text-gray-900 font-medium" style={{ left: DOC_COL_W, width: NAME_COL_W, minWidth: NAME_COL_W }}>{a.fullName}</td>
                                                {meta.items.map((d) => {
                                                    const weekendLocked = d.isWeekend && !isWeekendEditable(d.iso);
                                                    const s = weekendLocked ? 'N' : (docu.days[d.iso] as Status | undefined);
                                                    const color =
                                                        s === 'P' ? 'bg-green-500 text-white' :
                                                            s === 'A' ? 'bg-red-500 text-white' :
                                                                s === 'T' ? 'bg-amber-500 text-white' :
                                                                    s === 'J' ? 'bg-blue-500 text-white' :
                                                                        weekendLocked ? 'bg-gray-200 text-gray-500' : 'bg-gray-100 text-gray-700';
                                                    const label = s === 'P' ? 'P' : s === 'A' ? 'A' : s === 'T' ? 'T' : s === 'J' ? 'J' : '—';
                                                    const noteText = docu.notes?.[d.iso];
                                                    const baseTitle = d.isWeekend
                                                        ? (weekendLocked ? 'Fin de semana (bloqueado)' : 'Fin de semana (editable)')
                                                        : 'Clic izquierdo: cambiar estado · Clic derecho: nota';
                                                    const fullTitle = noteText && noteText.trim() ? `${baseTitle}\nNota: ${noteText.trim()}` : baseTitle;
                                                    return (
                                                        <td key={d.iso} className="px-0.5 py-1 text-center">
                                                            <span className="relative inline-block">
                                                                <button
                                                                    type="button"
                                                                    className={`cursor-pointer w-7 h-7 rounded text-xs font-bold ${color}`}
                                                                    onClick={() => handleCellClick(a.id, d.iso, d.isWeekend)}
                                                                    onContextMenu={(e) => openNoteEditor(e, a.id, d.iso)}
                                                                    title={fullTitle}
                                                                    aria-label={fullTitle}
                                                                >
                                                                    {label}
                                                                </button>
                                                                {noteText && <span className="absolute -right-0.5 -bottom-0.5 w-1.5 h-1.5 rounded-full bg-blue-600" title="Hay una nota" />}
                                                            </span>
                                                        </td>
                                                    );
                                                })}
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

            {/* Popover de notas */}
            {noteEditor && (
                <div
                    id="note-popover"
                    className="fixed z-50 bg-white rounded-lg shadow-xl border p-3 w-[260px]"
                    style={{ top: Math.min(noteEditor.y, window.innerHeight - 200), left: Math.min(noteEditor.x, window.innerWidth - 280) }}
                >
                    <div className="text-xs font-medium mb-1 text-gray-700">Descripción para {noteEditor.iso}</div>
                    <textarea
                        className="w-full h-24 border rounded p-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={noteEditor.value}
                        onChange={(e) => setNoteEditor({ ...noteEditor, value: e.target.value })}
                        placeholder="Escribe una descripción…"
                    />
                    <div className="mt-2 flex items-center justify-between">
                        <button className="cursor-pointer px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
                            onClick={async () => { await saveNote(noteEditor.assistantId, noteEditor.iso, noteEditor.value.trim()); setNoteEditor(null); }}>
                            Guardar
                        </button>
                        <div className="flex items-center gap-2">
                            <button className="cursor-pointer px-2 py-1.5 rounded bg-gray-100 text-gray-700 text-sm hover:bg-gray-200" onClick={() => setNoteEditor(null)}>
                                Cancelar
                            </button>
                            <button className="cursor-pointer px-2 py-1.5 rounded bg-red-100 text-red-700 text-sm hover:bg-red-200"
                                onClick={async () => { await saveNote(noteEditor.assistantId, noteEditor.iso, ''); setNoteEditor(null); }}
                                title="Eliminar nota">
                                Borrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de confirmación de eliminación (igual patrón que Reports) */}
            {showConfirm && (
                <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
                    <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-sm">
                        <h2 className="text-lg font-semibold mb-2 text-black">Confirmar Eliminación</h2>
                        <p className="text-sm text-gray-700 mb-4">
                            ¿Está seguro que desea eliminar este asistente? Se eliminarán también sus asistencias y notas.
                        </p>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Confirme su contraseña</label>
                        <input
                            type="password"
                            placeholder="Ingrese su contraseña"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            className="w-full p-2 mb-2 border border-gray-300 rounded text-black"
                        />
                        {passwordError && <div className="text-red-600 text-sm mb-2">{passwordError}</div>}
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => { setShowConfirm(false); setConfirmPassword(''); setPasswordError(''); }}
                                className="cursor-pointer px-4 py-2 rounded bg-gray-300 hover:bg-gray-400 text-gray-800 transition"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={doDeleteAssistant}
                                className="cursor-pointer px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white font-semibold transition"
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style jsx global>{`
        @keyframes fadeInDown { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fadeInDown { animation: fadeInDown 0.8s ease forwards; opacity: 1 !important; }
      `}</style>
        </div>
    );
}
