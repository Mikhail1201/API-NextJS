import { NextResponse } from 'next/server';
import admin from 'firebase-admin';

// ---------- Firebase Admin singleton ----------
function initAdmin() {
  if (!admin.apps.length) {
    try {
      // 1) Service Account via GOOGLE_APPLICATION_CREDENTIALS
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    } catch {
      // 2) Or via env var SERVICE_ACCOUNT_JSON (stringified)
      const json = process.env.SERVICE_ACCOUNT_JSON
        ? JSON.parse(process.env.SERVICE_ACCOUNT_JSON)
        : null;
      if (!json) throw new Error('Firebase Admin no configurado');
      admin.initializeApp({ credential: admin.credential.cert(json) });
    }
  }
  return admin.firestore();
}
const db = initAdmin();

// ---------- Helpers ----------
function daysInMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}
function monthMeta(monthStr) {
  const [Y, M] = monthStr.split('-');
  const y = Number(Y), m = Number(M);
  const total = daysInMonth(y, m);
  const items = Array.from({ length: total }, (_, i) => {
    const day = i + 1;
    const d = new Date(y, m - 1, day);
    const dow = d.getDay(); // 0..6
    const isWeekend = dow === 0 || dow === 6;
    const iso = d.toISOString().slice(0, 10);
    return { day, iso, isWeekend };
  });
  return { y, m, total, items };
}
function computeTotals(daysMap, meta) {
  let P = 0, A = 0, T = 0, J = 0, laborables = 0;
  for (const it of meta.items) {
    if (it.isWeekend) continue;
    laborables++;
    const s = daysMap[it.iso];
    if (s === 'P') P++;
    else if (s === 'A') A++;
    else if (s === 'T') T++;
    else if (s === 'J') J++;
  }
  return {
    asistencia: laborables ? P / laborables : 0,
    ausencia: A,
    tardanza: T,
    justificacion: J,
    laborables,
  };
}

// ========== GET: assistants + assistance for a month ==========
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);

    // assistants
    const assistantsSnap = await db.collection('assistants').get();
    const assistants = assistantsSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() || {}),
    }));

    // assistance for that month
    const assistSnap = await db.collection('assistance').where('month', '==', month).get();
    const assistance = assistSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() || {}),
    }));

    return NextResponse.json({ assistants, assistance });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

// ========== POST: create assistant or update a day ==========
export async function POST(req) {
  try {
    const { searchParams } = new URL(req.url);

    // --- Create assistant ---
    if (searchParams.get('createAssistant') === '1') {
      const body = await req.json();
      const fullName = String(body.fullName || '').trim();
      const documentNumber = String(body.documentNumber || '').trim();
      if (!fullName || !documentNumber) {
        return NextResponse.json({ error: 'fullName y documentNumber son requeridos' }, { status: 400 });
      }

      // usa documentNumber como docId (estable y único)
      const ref = db.collection('assistants').doc(documentNumber);
      await ref.set(
        {
          fullName,
          documentNumber,
          active: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return NextResponse.json({ ok: true, id: ref.id });
    }

    // --- Update a single day ---
    const body = await req.json();
    const assistantId = String(body.assistantId || '').trim();
    const date = String(body.date || '').trim(); // YYYY-MM-DD
    const status = String(body.status || '').trim(); // 'P'|'A'|'T'|'J'|'N'
    const month = String(body.month || '').trim();   // YYYY-MM

    if (!assistantId || !date || !status || !month) {
      return NextResponse.json({ error: 'assistantId, date, status, month requeridos' }, { status: 400 });
    }

    const meta = monthMeta(month);
    const docId = `${assistantId}_${month}`;
    const ref = db.collection('assistance').doc(docId);

    // merge day
    await ref.set(
      {
        assistantId,
        month,
        days: { [date]: status === 'N' ? admin.firestore.FieldValue.delete() : status }, // no guardamos fines de semana
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // recompute totals
    const snap = await ref.get();
    const data = snap.data() || {};
    const daysMap = { ...(data.days || {}) };
    const totals = computeTotals(daysMap, meta);

    await ref.set({ totals }, { merge: true });

    return NextResponse.json({ ok: true, id: docId, totals });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
