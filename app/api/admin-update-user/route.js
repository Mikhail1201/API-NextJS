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

    if (adminRole !== 'admin' && adminRole !== 'superadmin') {
      return new Response(JSON.stringify({ error: 'Forbidden: Insufficient permissions' }), { status: 403 });
    }

    const { uid, name, password, role } = await req.json();

    // Validate required fields
    if (!uid) {
      return new Response(JSON.stringify({ error: 'Missing user ID' }), { status: 400 });
    }

    // Prevent privilege escalation: only superadmin can promote to superadmin
    if (role === 'superadmin' && adminRole !== 'superadmin') {
      return new Response(JSON.stringify({ error: 'Only superadmin can assign superadmin role' }), { status: 403 });
    }

    // Optionally: validate password format here

    // Update Auth user
    const updateData = {};
    if (name) updateData.displayName = name;
    if (password) updateData.password = password;
    if (Object.keys(updateData).length > 0) {
      await admin.auth().updateUser(uid, updateData);
    }

    // Update Firestore user doc
    const userDocData = {};
    if (name) userDocData.name = name;
    if (role) userDocData.role = role;
    if (Object.keys(userDocData).length > 0) {
      await db.collection('users').doc(uid).update(userDocData);
    }

    // After updating user and/or Firestore doc
    let logDetails = '';
    if (password) {
      logDetails = `Contraseña cambiada para el usuario '${uid}'`;
    } else if (name || role) {
      logDetails = `Usuario '${uid}' actualizado: ${name ? `nombre = '${name}'` : ''}${name && role ? ', ' : ''}${role ? `rol = '${role}'` : ''}`;
    }
    if (logDetails) {
      await db.collection('logs').add({
        action: 'actualizar',
        details: logDetails,
        timestamp: new Date(),
        performedBy: adminDoc.data().email || adminUid,
      });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
}