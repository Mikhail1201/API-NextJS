import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  
  initializeApp({
    credential: cert(serviceAccount),
  });
}

export async function POST(req) {
  try {
    const data = await req.json();
    const { id, userId, userEmail, ...fields } = data;
    if (!id) return NextResponse.json({ success: false, error: 'Missing report id' }, { status: 400 });

    const db = getFirestore();
    await db.collection('reports').doc(id).update(fields);

    // Consistent log entry
    await db.collection('logs').add({
      action: 'actualizar_reporte',
      details: `Reporte actualizado con ID '${id}'`,
      reportId: id,
      updatedFields: fields,
      performedBy: userEmail || userId || 'desconocido',
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}