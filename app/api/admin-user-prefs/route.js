import admin from 'firebase-admin';
import { getApps } from 'firebase-admin/app';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Estados válidos (deben coincidir con el cliente)
const KNOWN_STATES = [
  'En Programación',
  'En Espera Aprobación',
  'pndte cotización',
  'En Ejecución',
  'Ejecutado',
  'N/A',
];

// Claves válidas de columnas (DEBEN coincidir con el cliente)
const ALLOWED_COL_KEYS = [
  'request',
  'number',
  'reportdate',
  'description',
  'pointofsell',
  'quotation',
  'deliverycertificate',
  'state',
  'bill',
  'servicename',
  'servicedescription',
  'asesorias',
];

// Utilidades HEX
const HEX_FULL_RE = /^#?[0-9a-fA-F]{6}$/;
const HEX_SHORT_RE = /^#?[0-9a-fA-F]{3}$/;

function normalizeHex(v) {
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s.startsWith('#')) s = `#${s}`;
  if (HEX_FULL_RE.test(s)) return s.toUpperCase();
  if (HEX_SHORT_RE.test(s)) {
    // #RGB -> #RRGGBB
    const r = s[1], g = s[2], b = s[3];
    return (`#${r}${r}${g}${g}${b}${b}`).toUpperCase();
  }
  return null;
}

async function getUserFromRequest(req) {
  const authHeader = req.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;
  if (!idToken) return { error: 'Missing or invalid Authorization header', status: 401 };

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userUid = decodedToken.uid;

    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(userUid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const userEmail = userData.email || userUid;
    const userRole = userData.role || '';

    if (!userRole) {
      return { error: 'Forbidden: No role assigned', status: 403 };
    }

    return { userUid, userEmail, userRole };
  } catch (error) {
    return { error: error.message || 'Unauthorized', status: 401 };
  }
}

// Sanitiza y completa el orden de columnas
function sanitizeColumnOrder(input) {
  if (!Array.isArray(input)) return null;
  const seen = new Set();
  const cleaned = [];
  for (const key of input) {
    if (typeof key !== 'string') continue;
    if (!ALLOWED_COL_KEYS.includes(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(key);
  }
  // Completar faltantes respetando orden base
  for (const baseKey of ALLOWED_COL_KEYS) {
    if (!seen.has(baseKey)) cleaned.push(baseKey);
  }
  return cleaned;
}

/**
 * GET: Lee las preferencias (colores + orden columnas) del usuario autenticado
 * Devuelve: { stateColors: { [estado]: "#RRGGBB" }, columnOrder?: string[] }
 * (sin logs de lectura)
 */
export async function GET(req) {
  const auth = await getUserFromRequest(req);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), { status: auth.status });
  }

  const { userUid } = auth;
  const db = admin.firestore();

  try {
    const snap = await db.collection('user_prefs').doc(userUid).get();
    const data = snap.exists ? snap.data() : {};
    const rawColors = data?.stateColors || {};
    const rawOrder = data?.columnOrder;

    // Sanitizar: solo estados conocidos y HEX válidos
    const stateColors = {};
    for (const k of KNOWN_STATES) {
      const v = normalizeHex(rawColors[k]);
      if (v) stateColors[k] = v;
    }

    // Sanitizar orden de columnas (si existe)
    const columnOrder = sanitizeColumnOrder(rawOrder) || undefined;

    return new Response(JSON.stringify({ stateColors, columnOrder }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
}

/**
 * POST: Actualiza las preferencias del usuario autenticado
 * Body: {
 *   stateColors?: { [estado]: "#RRGGBB" },
 *   columnOrder?: string[]
 * }
 * Log: actualizar_preferencias_usuario
 */
export async function POST(req) {
  const auth = await getUserFromRequest(req);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), { status: auth.status });
  }

  const { userUid, userEmail } = auth;
  const db = admin.firestore();

  try {
    const body = await req.json();

    // --- Colores ---
    const incomingColors = body?.stateColors || {};
    const toSaveColors = {};
    for (const [key, val] of Object.entries(incomingColors)) {
      if (!KNOWN_STATES.includes(key)) continue;
      const hex = normalizeHex(val);
      if (hex) toSaveColors[key] = hex;
    }

    // --- Orden de columnas ---
    const incomingOrder = Array.isArray(body?.columnOrder) ? body.columnOrder : null;
    const toSaveOrder = sanitizeColumnOrder(incomingOrder);

    // Nada que guardar -> OK sin cambios
    if (Object.keys(toSaveColors).length === 0 && !toSaveOrder) {
      return new Response(JSON.stringify({ success: true, noop: true }), { status: 200 });
    }

    const payload = {};
    if (Object.keys(toSaveColors).length > 0) payload.stateColors = toSaveColors;
    if (toSaveOrder) payload.columnOrder = toSaveOrder;

    await db.collection('user_prefs').doc(userUid).set(payload, { merge: true });

    // Log de actualización
    const updatedColorKeys = Object.keys(toSaveColors);
    const detailsParts = [];
    if (updatedColorKeys.length > 0) {
      detailsParts.push(
        `Colores actualizados (${updatedColorKeys.length}): ${updatedColorKeys.join(', ')}`
      );
    }
    if (toSaveOrder) {
      detailsParts.push(`columnOrder actualizado (${toSaveOrder.length} columnas)`);
    }
    const details =
      detailsParts.length > 0
        ? detailsParts.join(' | ')
        : 'Se intentó actualizar preferencias, pero no hubo cambios válidos.';

    await db.collection('logs').add({
      action: 'actualizar_preferencias_usuario',
      details,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      performedBy: userEmail,
    });

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
}
