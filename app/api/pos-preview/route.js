// app/api/admin-import-reports/pos-preview/route.js
import admin from 'firebase-admin';
import { getApps } from 'firebase-admin/app';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

export async function POST(req) {
  const authHeader = req.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;
  if (!idToken) {
    return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), { status: 401 });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(uid).get();
    const role = (userDoc.exists ? userDoc.data() : {})?.role || '';

    // por consistencia con import: sólo superadmin
    if (role !== 'superadmin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const raw = Array.isArray(body?.names) ? body.names : [];
    const incoming = Array.from(
      new Set(
        raw
          .map((s) => (s ?? '').toString().trim())
          .filter((s) => s.length > 0)
      )
    );

    if (incoming.length === 0) {
      return new Response(JSON.stringify({ success: true, totalUnique: 0, newCount: 0, newNames: [] }), { status: 200 });
    }

    // cargar todos los existentes (mismo enfoque que tu import)
    const snap = await db.collection('point of sell').get();
    const existing = new Set(snap.docs.map((d) => ((d.data() || {}).name || '').toString().trim()).filter(Boolean));

    const newNames = incoming.filter((n) => !existing.has(n));
    return new Response(
      JSON.stringify({ success: true, totalUnique: incoming.length, newCount: newNames.length, newNames }),
      { status: 200 }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'Preview failed' }), { status: 400 });
  }
}
