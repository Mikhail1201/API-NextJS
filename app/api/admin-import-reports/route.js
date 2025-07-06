import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import serviceAccount from '../../../serviceAccountKey.json';
import * as XLSX from 'xlsx';

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

export async function POST(req) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const idToken = authHeader.split('Bearer ')[1];
    await getAuth().verifyIdToken(idToken);

    const { reports, userEmail, userId } = await req.json();
    if (!reports || !Array.isArray(reports)) {
      return NextResponse.json({ success: false, error: 'No reports provided' }, { status: 400 });
    }

    const db = getFirestore();
    let importedCount = 0;
    let skipped = [];

    for (const report of reports) {
      if (!report.request || typeof report.request !== 'string' || !report.request.trim()) {
        skipped.push('(missing request)');
        continue;
      }
      // Normalize the request value
      const requestValue = report.request.replace(/\s+/g, '').toUpperCase();

      // Query for possible matches (same length, first/last chars, etc. to reduce reads)
      const qSnap = await db.collection('reports')
        .where('request', '>=', report.request[0])
        .where('request', '<=', report.request[0] + '\uf8ff')
        .get();

      // Check for duplicates in a normalized way
      const isDuplicate = qSnap.docs.some(doc =>
        (doc.data().request || '').replace(/\s+/g, '').toUpperCase() === requestValue
      );
      if (isDuplicate) {
        skipped.push(report.request);
        continue;
      }
      await db.collection('reports').add({
        ...report,
        reportdate: FieldValue.serverTimestamp(),
      });
      importedCount++;
    }

    await db.collection('logs').add({
      action: 'import_reports',
      details: `Imported ${importedCount} report(s) from Excel, skipped ${skipped.length} duplicate(s)`,
      importedCount,
      skippedCount: skipped.length,
      performedBy: userEmail || userId || 'unknown',
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, importedCount, skipped });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}