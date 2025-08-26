import admin from 'firebase-admin';
import { getApps } from 'firebase-admin/app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

if (!getApps().length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT no está definido');
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

function requireBearer(req) {
  const authHeader = req.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    return { error: new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), { status: 401 }) };
  }
  return { idToken };
}
async function verifyAndLoadUser(idToken) {
  const decoded = await admin.auth().verifyIdToken(idToken);
  const uid = decoded.uid;
  const userDoc = await db.collection('users').doc(uid).get();
  const data = userDoc.exists ? userDoc.data() : {};
  return { uid, role: data?.role || '', email: data?.email || decoded.email || uid };
}
function daysInMonth(y, m1to12) { return new Date(y, m1to12, 0).getDate(); }
function monthMeta(monthStr) {
  const [Y, M] = monthStr.split('-'); const y = Number(Y), m = Number(M);
  const total = daysInMonth(y, m);
  const items = Array.from({ length: total }, (_, i) => {
    const d = new Date(y, m - 1, i + 1); const iso = d.toISOString().slice(0, 10);
    const dow = d.getDay(); const isWeekend = dow === 0 || dow === 6;
    return { iso, isWeekend };
  });
  return { items };
}
function computeTotals(daysMap, meta) {
  let P = 0, A = 0, T = 0, J = 0, laborables = 0;
  for (const it of meta.items) {
    if (it.isWeekend) continue;
    laborables++;
    const s = daysMap[it.iso];
    if (s === 'P') P++; else if (s === 'A') A++; else if (s === 'T') T++; else if (s === 'J') J++;
  }
  return { asistencia: laborables ? P / laborables : 0, ausencia: A, tardanza: T, justificacion: J, laborables };
}
function sanitizeDocId(s) { return String(s).trim().replace(/[\/#?[\]]/g, '_'); }

export async function GET(req) {
  try {
    const auth = requireBearer(req); if (auth.error) return auth.error;
    const { idToken } = auth;
    const actor = await verifyAndLoadUser(idToken);

    // ⬅️ Toda esta página requiere SUPERADMIN
    if (actor.role !== 'superadmin') {
      return new Response(JSON.stringify({ error: 'Forbidden: Insufficient permissions' }), { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);

    const assistantsSnap = await db.collection('assistants').orderBy('fullName').get();
    const assistants = assistantsSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));

    const assistSnap = await db.collection('assistance').where('month', '==', month).get();
    const assistance = assistSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));

    // Notas del mes (colección separada)
    const notesSnap = await db.collection('assistance_notes').where('month', '==', month).get();
    const notesByAssistant = {};
    notesSnap.forEach(doc => {
      const { assistantId, date, text } = doc.data() || {};
      if (!assistantId || !date) return;
      if (!notesByAssistant[assistantId]) notesByAssistant[assistantId] = {};
      if (text) notesByAssistant[assistantId][date] = String(text);
    });

    return new Response(JSON.stringify({ assistants, assistance, notesByAssistant }), { status: 200 });
  } catch (error) {
    console.error('GET admin-assistance error:', error);
    return new Response(JSON.stringify({ error: error.message || String(error) }), { status: 500 });
  }
}

export async function POST(req) {
  try {
    const auth = requireBearer(req); if (auth.error) return auth.error;
    const { idToken } = auth;
    const actor = await verifyAndLoadUser(idToken);

    // ⬅️ Todas las operaciones aquí exigen SUPERADMIN
    if (actor.role !== 'superadmin') {
      return new Response(JSON.stringify({ error: 'Forbidden: Insufficient permissions' }), { status: 403 });
    }

    const { searchParams } = new URL(req.url);

    // --- Crear asistente ---
    if (searchParams.get('createAssistant') === '1') {
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

    // --- Eliminar asistente (y sus datos asociados) ---
    if (searchParams.get('deleteAssistant') === '1') {
      const body = await req.json();
      const assistantId = sanitizeDocId(body.assistantId || '');
      if (!assistantId) return new Response(JSON.stringify({ error: 'assistantId requerido' }), { status: 400 });

      // borra doc principal
      await db.collection('assistants').doc(assistantId).delete();

      // borra assistance*
      const assistSnap = await db.collection('assistance').where('assistantId', '==', assistantId).get();
      const batch1 = db.batch();
      assistSnap.docs.forEach(d => batch1.delete(d.ref));
      await batch1.commit();

      // borra notes*
      const notesSnap = await db.collection('assistance_notes').where('assistantId', '==', assistantId).get();
      const batch2 = db.batch();
      notesSnap.docs.forEach(d => batch2.delete(d.ref));
      await batch2.commit();

      await db.collection('logs').add({
        action: 'eliminar_asistente',
        details: `Asistente '${assistantId}' eliminado (y sus datos asociados).`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        performedBy: actor.email,
        meta: { assistantId, page: 'asistencias' },
      });

      return new Response(JSON.stringify({ success: true, id: assistantId }), { status: 200 });
    }

    // --- Guardar nota ---
    const body = await req.json();
    const assistantId = sanitizeDocId(body.assistantId || '');
    const date = String(body.date || '').trim();
    const month = String(body.month || '').trim();
    if (!assistantId || !date || !month) {
      return new Response(JSON.stringify({ error: 'assistantId, date, month requeridos' }), { status: 400 });
    }

    if (typeof body.note !== 'undefined') {
      const text = String(body.note || '').trim();
      const noteId = `${assistantId}_${date}`;
      const noteRef = db.collection('assistance_notes').doc(noteId);
      if (text === '') await noteRef.delete();
      else await noteRef.set({
        assistantId, date, month, text,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: actor.email,
      }, { merge: true });

      await db.collection('logs').add({
        action: text ? 'guardar_nota' : 'borrar_nota',
        details: `${text ? 'Nota guardada' : 'Nota eliminada'} para ${assistantId} en ${date}`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        performedBy: actor.email,
        meta: { assistantId, date, month, page: 'asistencias' },
      });
      return new Response(JSON.stringify({ success: true, noteId }), { status: 200 });
    }

    // --- Marcar día (P/A/T/J) ---
    const status = String(body.status || '').trim();
    if (!status) return new Response(JSON.stringify({ error: 'status requerido' }), { status: 400 });

    const assistDocId = `${assistantId}_${month}`;
    const assistRef = db.collection('assistance').doc(assistDocId);
    await assistRef.set(
      {
        assistantId,
        month,
        days: { [date]: status === 'N' ? admin.firestore.FieldValue.delete() : status },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const snap = await assistRef.get();
    const data = snap.data() || {};
    const meta = monthMeta(month);
    const totals = computeTotals({ ...(data.days || {}) }, meta);
    await assistRef.set({ totals }, { merge: true });

    await db.collection('logs').add({
      action: 'marcar_asistencia',
      details: `Se marcó '${status}' para ${assistantId} en ${date}.`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      performedBy: actor.email,
      meta: { assistantId, date, status, month, page: 'asistencias' },
    });

    return new Response(JSON.stringify({ success: true, id: assistDocId, totals }), { status: 200 });
  } catch (error) {
    console.error('POST admin-assistance error:', error);
    return new Response(JSON.stringify({ error: error.message || String(error) }), { status: 500 });
  }
}
