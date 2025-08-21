import admin from 'firebase-admin';
import { getApps } from 'firebase-admin/app';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

// Convierte 'YYYY-MM-DD' a Timestamp a las 00:00:00 (-05:00)
function toBogotaTimestamp(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return null;
  const d = new Date(`${iso}T00:00:00.000-05:00`);
  return admin.firestore.Timestamp.fromDate(d);
}

export async function POST(req) {
  // --- Auth al estilo de tu crear_reporte ---
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

    // Solo superadmin puede importar
    if (userRole !== 'superadmin') {
      return new Response(JSON.stringify({ error: 'Forbidden: Solo superadmin puede importar' }), { status: 403 });
    }

    // --- Body ---
    const body = await req.json().catch(() => ({}));
    const reports = Array.isArray(body?.reports) ? body.reports : Array.isArray(body?.rows) ? body.rows : [];
    if (!reports.length) {
      return new Response(JSON.stringify({ error: 'No hay reportes para importar' }), { status: 400 });
    }

    // === 1) Asegurar Puntos de Venta ===
    const posSet = new Set(
      reports
        .map((r) => (r?.pointofsell || '').toString().trim())
        .filter(Boolean)
    );

    const existingPOSSnap = await db.collection('point of sell').get();
    const existingNames = new Set(
      existingPOSSnap.docs.map((d) => ((d.data() || {}).name || '').toString().trim()).filter(Boolean)
    );

    let createdPOS = 0;
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

    // === 2) Detectar solicitudes existentes para evitar duplicados ===
    const requestSet = new Set(
      reports
        .map((r) => (r?.request || '').toString().trim())
        .filter(Boolean)
    );
    const requestList = Array.from(requestSet);

    // Firestore 'in' está limitado a 10 elementos -> chunqueamos
    const chunk = (arr, n) => arr.reduce((a, _, i) => (i % n ? a : [...a, arr.slice(i, i + n)]), []);
    const chunks = chunk(requestList, 10);

    const existingRequests = new Set();
    for (const c of chunks) {
      const snap = await db.collection('reports').where('request', 'in', c).get().catch(() => null);
      if (snap) {
        snap.forEach((doc) => {
          const v = (doc.data().request || '').toString().trim();
          if (v) existingRequests.add(v);
        });
      }
    }

    // === 3) Validar y crear reportes ===
    let importedCount = 0;
    const skippedExistingRequests = [];
    const invalidRows = []; // faltan campos obligatorios o fecha inválida

    for (const r of reports) {
      const request = (r?.request || '').toString().trim();
      const pointofsell = (r?.pointofsell || '').toString().trim();
      const state = (r?.state || '').toString().trim();
      const reportdateISO = (r?.reportdate || '').toString().trim();

      // Reglas: deben existir POS, request, state y fecha válida
      const ts = toBogotaTimestamp(reportdateISO);
      if (!pointofsell || !request || !state || !ts) {
        invalidRows.push({ request, reason: `Faltan campos obligatorios o fecha inválida` });
        continue;
      }

      // Duplicado por request -> saltar
      if (existingRequests.has(request)) {
        skippedExistingRequests.push(request);
        continue;
      }

      // Crear reporte (estilo add + createdAt/createdBy)
      await db.collection('reports').add({
        request,
        number: (r?.number || '').toString().trim(),
        reportdate: ts, // Timestamp “fecha pura”
        description: (r?.description || '').toString().trim(),
        pointofsell,
        quotation: (r?.quotation || '').toString().trim(),
        deliverycertificate: (r?.deliverycertificate || '').toString().trim(),
        state,
        bill: (r?.bill || '').toString().trim(),
        servicename: (r?.servicename || '').toString().trim(),
        servicedescription: (r?.servicedescription || '').toString().trim(),
        asesorias: (r?.asesorias || '').toString().trim(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: userEmail,
      });

      importedCount++;
      existingRequests.add(request); // evitar duplicados dentro del mismo lote
    }

    // === 4) Log ===
    await db.collection('logs').add({
      action: 'importar_reportes',
      details: `Importados ${importedCount} reportes. POS nuevos: ${createdPOS}. Duplicados: ${skippedExistingRequests.length}. Inválidos: ${invalidRows.length}.`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      performedBy: userEmail,
    });

    return new Response(
      JSON.stringify({
        success: true,
        importedCount,
        createdPOS,
        skippedExistingRequests,
        invalidRows,
      }),
      { status: 200 }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Import failed' }), { status: 400 });
  }
}
