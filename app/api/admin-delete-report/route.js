import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import serviceAccount from '../../../serviceAccountKey.json';

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

export async function POST(req) {
  try {
    const { reportId, userId, userEmail } = await req.json();
    if (!reportId) {
      return NextResponse.json({ success: false, error: 'Missing reportId' }, { status: 400 });
    }

    const db = getFirestore();
    await db.collection('reports').doc(reportId).delete();

    // Log the deletion
    await db.collection('logs').add({
      action: 'delete_report',
      details: `Deleted report with ID '${reportId}'`,
      reportId,
      performedBy: userEmail || userId || 'unknown',
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}