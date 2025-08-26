// app/api/admin-assistance/route.js
import admin from 'firebase-admin';
import { getApps } from 'firebase-admin/app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------- Firebase Admin ----------
if (!getApps().length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT no está definido');
  }
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

// ---------- Utils ----------
function requireBearer(req) {
  const authHeader = req.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : null;
  if (!idToken) {
    return { error: new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), { status: 401 }) };
  }
  return { idToken };
}

async function verifyAndLoadUser(idToken) {
  const decoded = await admin.auth().verifyIdToken(idToken);
  const uid = decoded.uid;
  const userDoc = await db.collection('users').doc(uid).get();
  const userData = userDoc.exists ? userDoc.data() : {};
  const role = userData?.role || '';
  const email = userData?.email || decoded.email || uid;
  return { uid, role, email };
}

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

/**
 * Totales:
 * - Días hábiles (L-V) SIEMPRE cuentan en "laborables".
 * - Fines de semana SOLO cuentan si ese día tiene un valor en "days" (lo interpretamos como "desbloqueado/registrado").
 */
function computeTotals(daysMap, meta) {
  let P = 0, A = 0, T = 0, J = 0, laborables = 0;
  for (const it of meta.items) {
    const v = daysMap[it.iso];
    if (it.isWeekend && typeof v === 'undefined') {
      // sábado/domingo sin valor: no cuenta
      continue;
    }
    laborables++;
    if (v === 'P') P++;
    else if (v === 'A') A++;
    else if (v === 'T') T++;
    else if (v === 'J') J++;
  }
  return {
    asistencia: laborables ? P / laborables : 0,
    ausencia: A,
    tardanza: T,
    justificacion: J,
    laborables,
  };
}

function sanitizeDocId(s) {
  return String(s).trim().replace(/[\/#?[\]]/g, '_');
}

// ---------- GET: assistants + assistance (mes) ----------
export async function GET(req) {
  try {
    const auth = requireBearer(req);
    if (auth.error) return auth.error;
    const { idToken } = auth;

    const { role } = await verifyAndLoadUser(idToken);
    if (!role) {
      return new Response(JSON.stringify({ error: 'Forbidden: No role assigned' }), { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);

    const assistantsSnap = await db.collection('assistants').orderBy('fullName').get();
    const assistants = assistantsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

    const assistSnap = await db.collection('assistance').where('month', '==', month).get();
    const assistance = assistSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

    return new Response(JSON.stringify({ assistants, assistance }), { status: 200 });
  } catch (error) {
    console.error('GET admin-assistance error:', error);
    return new Response(JSON.stringify({ error: error.message || String(error) }), { status: 500 });
  }
}

// ---------- POST: crear asistente / marcar día / guardar nota ----------
export async function POST(req) {
  try {
    const auth = requireBearer(req);
    if (auth.error) return auth.error;
    const { idToken } = auth;

    const actor = await verifyAndLoadUser(idToken);
    if (!actor.role) {
      return new Response(JSON.stringify({ error: 'Forbidden: No role assigned' }), { status: 403 });
    }

    const { searchParams } = new URL(req.url);

    // --- Crear asistente ---
    if (searchParams.get('createAssistant') === '1') {
      // Solo admin/superadmin crean asistentes
      if (actor.role !== 'admin' && actor.role !== 'superadmin') {
        return new Response(JSON.stringify({ error: 'Forbidden: Insufficient permissions' }), { status: 403 });
      }

      const body = await req.json();
      const fullName = String(body.fullName || '').trim();
      const documentNumberRaw = String(body.documentNumber || '').trim();
      if (!fullName || !documentNumberRaw) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
      }

      const docId = sanitizeDocId(documentNumberRaw);
      const ref = db.collection('assistants').doc(docId);

      const exists = await ref.get();
      if (exists.exists) {
        return new Response(JSON.stringify({ error: 'Assistant already exists' }), { status: 409 });
      }

      await ref.set({
        fullName,
        documentNumber: documentNumberRaw,
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: actor.email,
      });

      await db.collection('logs').add({
        action: 'crear_asistente',
        details: `Asistente '${fullName}' creado (doc: ${docId}).`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        performedBy: actor.email,
        meta: { assistantId: docId, documentNumber: documentNumberRaw, page: 'asistencias' },
      });

      return new Response(JSON.stringify({ success: true, id: docId }), { status: 200 });
    }

    // --- Marcar un día y/o guardar nota ---
    // También exigimos admin/superadmin para marcar/editar (ajústalo si necesitas)
    if (actor.role !== 'admin' && actor.role !== 'superadmin') {
      return new Response(JSON.stringify({ error: 'Forbidden: Insufficient permissions' }), { status: 403 });
    }

    const body = await req.json();
    const assistantId = sanitizeDocId(body.assistantId || '');
    const date = String(body.date || '').trim();   // YYYY-MM-DD
    const month = String(body.month || '').trim(); // YYYY-MM
    const statusRaw = typeof body.status === 'string' ? String(body.status).trim() : undefined; // 'P'|'A'|'T'|'J'|'N'|undefined
    const noteRaw = typeof body.note !== 'undefined' ? String(body.note) : undefined;            // string|''|undefined

    if (!assistantId || !date || !month) {
      return new Response(JSON.stringify({ error: 'assistantId, date y month son requeridos' }), { status: 400 });
    }
    if (typeof statusRaw === 'undefined' && typeof noteRaw === 'undefined') {
      return new Response(JSON.stringify({ error: 'Debe enviarse status y/o note' }), { status: 400 });
    }

    const assistDocId = `${assistantId}_${month}`;
    const assistRef = db.collection('assistance').doc(assistDocId);

    const updates = {
      assistantId,
      month,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: actor.email,
    };

    // status (si vino)
    if (typeof statusRaw !== 'undefined') {
      const valid = new Set(['P', 'A', 'T', 'J', 'N']);
      if (!valid.has(statusRaw)) {
        return new Response(JSON.stringify({ error: 'status inválido' }), { status: 400 });
      }
      updates[`days.${date}`] = statusRaw === 'N'
        ? admin.firestore.FieldValue.delete()
        : statusRaw;

      await db.collection('logs').add({
        action: 'marcar_asistencia',
        details: `Se marcó '${statusRaw}' para ${assistantId} en ${date}.`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        performedBy: actor.email,
        meta: { assistantId, date, status: statusRaw, month, page: 'asistencias' },
      });
    }

    // note (si vino)
    if (typeof noteRaw !== 'undefined') {
      if (String(noteRaw).trim() === '') {
        updates[`notes.${date}`] = admin.firestore.FieldValue.delete();
      } else {
        updates[`notes.${date}`] = String(noteRaw);
      }
      await db.collection('logs').add({
        action: 'asistencia_actualizar_nota',
        details: `Nota para ${assistantId} en ${date} (${month})`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        performedBy: actor.email,
        meta: { assistantId, date, month, note: String(noteRaw).slice(0, 120), page: 'asistencias' },
      });
    }

    // guardar cambios
    await assistRef.set(updates, { merge: true });

    // recomputa totales con nueva política (fines de semana cuentan si tienen valor)
    const meta = monthMeta(month);
    const snap = await assistRef.get();
    const data = snap.data() || {};
    const daysMap = { ...(data.days || {}) };
    const totals = computeTotals(daysMap, meta);
    await assistRef.set({ totals }, { merge: true });

    return new Response(JSON.stringify({ success: true, id: assistDocId, totals }), { status: 200 });
  } catch (error) {
    console.error('POST admin-assistance error:', error);
    return new Response(JSON.stringify({ error: error.message || String(error) }), { status: 500 });
  }
}
