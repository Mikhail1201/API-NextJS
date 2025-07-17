import admin from 'firebase-admin';
import { getApps } from 'firebase-admin/app';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  
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

    if (adminRole !== 'admin' && adminRole !== 'superadmin') {
      return new Response(JSON.stringify({ error: 'Forbidden: Insufficient permissions' }), { status: 403 });
    }

    const { uid, name, email, role } = await req.json();

    // Prevent deleting superadmins or self
    if (role === 'superadmin' || uid === adminUid) {
      return new Response(JSON.stringify({ error: 'Cannot delete this user.' }), { status: 403 });
    }

    // Delete from Auth
    await admin.auth().deleteUser(uid);

    // Delete from Firestore
    await db.collection('users').doc(uid).delete();

    // Log the action en español
    await db.collection('logs').add({
      action: 'eliminar_usuario',
      details: `Usuario '${name || email}' (rol: ${role}) eliminado`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      performedBy: adminDoc.data().email || adminUid,
    });

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
}