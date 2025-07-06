import admin from 'firebase-admin';
import { getApps } from 'firebase-admin/app';
import serviceAccount from '../../../serviceAccountKey.json';

if (!getApps().length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export async function POST(req) {
  const authHeader = req.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;
  if (!idToken) {
    return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), { status: 401 });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const adminUid = decodedToken.uid;

    const db = admin.firestore();
    const adminDoc = await db.collection('users').doc(adminUid).get();
    const adminRole = adminDoc.exists ? adminDoc.data().role : null;
    const adminEmail = adminDoc.exists ? adminDoc.data().email : null;

    if (adminRole !== 'admin' && adminRole !== 'superadmin') {
      return new Response(JSON.stringify({ error: 'Forbidden: Insufficient permissions' }), { status: 403 });
    }

    const { name } = await req.json();
    if (!name || !name.trim()) {
      return new Response(JSON.stringify({ error: 'Name is required' }), { status: 400 });
    }

    await db.collection('point of sell').add({
      name: name.trim(),
      createdAt: new Date(),
    });

    // Log the action in Spanish
    await db.collection('logs').add({
      action: 'agregar_punto_de_venta',
      details: `Punto de venta '${name.trim()}' agregado`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      performedBy: adminEmail || adminUid,
    });

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
}