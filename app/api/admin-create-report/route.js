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
    const userUid = decodedToken.uid;

    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(userUid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const userEmail = userData.email || userUid;
    const userRole = userData.role || '';

    // Only allow users with a role
    if (!userRole) {
      return new Response(JSON.stringify({ error: 'Forbidden: No role assigned' }), { status: 403 });
    }

    const reportData = await req.json();

    // Create the report
    const reportRef = await db.collection('reports').add({
      ...reportData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: userEmail,
    });

    // Log the action
    await db.collection('logs').add({
      action: 'create_report',
      details: `Created report with ID '${reportRef.id}'`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      performedBy: userEmail,
    });

    return new Response(JSON.stringify({ success: true, id: reportRef.id }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
}