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
    const { selectedDate, onlyThatDay, userId, userEmail } = await req.json();
    if (!selectedDate) {
      return NextResponse.json({ success: false, error: 'Missing date' }, { status: 400 });
    }
    const db = getFirestore();
    const snapshot = await db.collection('reports').get();
    const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const selected = new Date(selectedDate);

    const filtered = reports.filter(r => {
      const rDate =
        typeof r.reportdate === 'object' && r.reportdate !== null && 'seconds' in r.reportdate
          ? new Date((r.reportdate.seconds || 0) * 1000)
          : r.reportdate
          ? new Date(r.reportdate)
          : new Date(0);
      if (onlyThatDay) {
        return rDate.toDateString() === selected.toDateString();
      } else {
        return rDate <= selected;
      }
    });

    // Log the export action en español
    await db.collection('logs').add({
      action: 'exportar_reportes',
      details: `Exportados ${filtered.length} reporte(s) ${onlyThatDay ? 'en' : 'hasta'} ${selectedDate}`,
      exportedCount: filtered.length,
      exportedDate: selectedDate,
      onlyThatDay: !!onlyThatDay,
      performedBy: userEmail || userId || 'desconocido',
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, reports: filtered });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}