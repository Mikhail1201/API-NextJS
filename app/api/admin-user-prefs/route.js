// app/api/user-prefs/route.js
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

/**
 * GET: Lee las preferencias de colores del usuario autenticado
 * Devuelve: { stateColors: { [estado]: "#RRGGBB" } }
 * Log: leer_preferencias_usuario
 */
export async function GET(req) {
  const auth = await getUserFromRequest(req);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), { status: auth.status });
  }

  const { userUid, userEmail } = auth;
  const db = admin.firestore();

  try {
    const snap = await db.collection('user_prefs').doc(userUid).get();
    const data = snap.exists ? snap.data() : {};
    const rawColors = data?.stateColors || {};

    // Sanitizar: solo estados conocidos y HEX válidos
    const stateColors = {};
    for (const k of KNOWN_STATES) {
      const v = normalizeHex(rawColors[k]);
      if (v) stateColors[k] = v;
    }

    // Log de lectura
    await db.collection('logs').add({
      action: 'leer_preferencias_usuario',
      details: `Preferencias de colores leídas para el usuario '${userEmail}'`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      performedBy: userEmail,
    });

    return new Response(JSON.stringify({ stateColors }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
}

/**
 * POST: Actualiza las preferencias de colores del usuario autenticado
 * Body: { stateColors: { [estado]: "#RRGGBB" } }
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
    const incoming = body?.stateColors || {};

    // Validación: sólo estados conocidos y HEX válidos
    const toSave = {};
    for (const [key, val] of Object.entries(incoming)) {
      if (!KNOWN_STATES.includes(key)) continue;
      const hex = normalizeHex(val);
      if (hex) toSave[key] = hex;
    }

    // Guardar (merge)
    await db.collection('user_prefs').doc(userUid).set(
      { stateColors: toSave },
      { merge: true }
    );

    // Log de actualización
    const updatedKeys = Object.keys(toSave);
    await db.collection('logs').add({
      action: 'actualizar_preferencias_usuario',
      details:
        updatedKeys.length > 0
          ? `Colores actualizados para ${updatedKeys.length} estado(s): ${updatedKeys.join(', ')}`
          : 'Se intentó actualizar preferencias, pero no hubo cambios válidos.',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      performedBy: userEmail,
    });

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
}
