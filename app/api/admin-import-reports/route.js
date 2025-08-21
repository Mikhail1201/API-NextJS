import admin from 'firebase-admin';
import { getApps } from 'firebase-admin/app';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

function toBogotaTimestamp(iso) {
  // Espera 'YYYY-MM-DD' y lo convierte a 00:00:00 (UTC-5)
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00.000-05:00`);
  return admin.firestore.Timestamp.fromDate(d);
}

export async function POST(req) {
  // ---- Auth idéntico al estilo que usas ----
  const authHeader = req.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ')
    ? authHeader.replace('Bearer ', '')
    : null;

  if (!idToken) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid Authorization header' }),
      { status: 401 }
    );
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userUid = decodedToken.uid;

    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(userUid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const userEmail = userData.email || userUid;
    const userRole = userData.role || '';

    // Solo SUPERADMIN puede importar
    if (userRole !== 'superadmin') {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Solo superadmin puede importar' }),
        { status: 403 }
      );
    }

    // ---- Body ----
    const body = await req.json().catch(() => ({}));
    // Acepta 'reports' o 'rows' para que tu página actual funcione sin cambios
    const reports = Array.isArray(body?.reports)
      ? body.reports
      : Array.isArray(body?.rows)
      ? body.rows
      : [];

    if (!reports.length) {
      return new Response(
        JSON.stringify({ error: 'No hay reportes para importar' }),
        { status: 400 }
      );
    }

    // ---- 1) Asegurar puntos de venta (point of sell) ----
    const posSet = new Set(
      reports
        .map((r) => (r?.pointofsell || '').toString().trim())
        .filter(Boolean)
    );

    // Cargamos existentes una sola vez
    const existingSnap = await db.collection('point of sell').get();
    const existingNames = new Set(
      existingSnap.docs
        .map((d) => ((d.data() || {}).name || '').toString().trim())
        .filter(Boolean)
    );

    let createdPOS = 0;
    // Similar a tu estilo (add + serverTimestamp)
    for (const name of posSet) {
      if (!existingNames.has(name)) {
        await db.collection('point of sell').add({
          name,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        existingNames.add(name);
        createdPOS++;
      }
    }

    // ---- 2) Importar reportes (add por compatibilidad con tu estilo) ----
    let importedCount = 0;

    for (const r of reports) {
      const docData = {
        request: r?.request || '',
        number: r?.number || '',
        reportdate: toBogotaTimestamp(r?.reportdate) ?? null, // YYYY-MM-DD → Timestamp 00:00
        description: r?.description || '',
        pointofsell: r?.pointofsell || '',
        quotation: r?.quotation || '',
        deliverycertificate: r?.deliverycertificate || '',
        state: r?.state || '',
        bill: r?.bill || '',
        servicename: r?.servicename || '',
        servicedescription: r?.servicedescription || '',
        asesorias: r?.asesorias || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: userEmail,
      };

      await db.collection('reports').add(docData);
      importedCount++;
    }

    // ---- 3) Log de la importación ----
    await db.collection('logs').add({
      action: 'importar_reportes',
      details: `Importados ${importedCount} reportes. POS nuevos: ${createdPOS}.`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      performedBy: userEmail,
    });

    return new Response(
      JSON.stringify({ success: true, importedCount, createdPOS }),
      { status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || 'Import failed' }),
      { status: 400 }
    );
  }
}
