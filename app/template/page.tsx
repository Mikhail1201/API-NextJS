'use client';

import { useEffect, useState } from 'react';
import { useRouter, notFound } from 'next/navigation';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { auth } from '@/app/firebase/config';
import { useAuthState } from 'react-firebase-hooks/auth';
import * as XLSX from 'xlsx';

const DEFAULT_FIELDS: string[] = [
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

const FIELD_LABELS: Record<string, string> = {
  request: 'Solicitud/Aviso',
  number: 'Presupuesto',
  reportdate: 'Fecha de Reporte',
  description: 'Descripción',
  pointofsell: 'Punto de Venta',
  quotation: 'Cotización',
  deliverycertificate: 'Acta de Entrega',
  state: 'Estado',
  bill: 'Factura',
  servicename: 'Nombre del Servicio',
  servicedescription: 'Descripción del Servicio',
  asesorias: 'Asesorías',
};

export default function TemplatePage() {
  const router = useRouter();
  const [user, loading] = useAuthState(auth);
  const [roleChecked, setRoleChecked] = useState(false);
  const [columnOrder, setColumnOrder] = useState<string[]>(DEFAULT_FIELDS);
  const db = getFirestore();

  useEffect(() => {
    const checkRoleAndPrefs = async () => {
      if (!user) return;
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userRole = userDoc.exists() ? (userDoc.data() as { role?: string }).role : null;
      if (userRole !== 'superadmin') {
        notFound();
        return;
      }
      // Get user-prefs for columns
      const prefsDoc = await getDoc(doc(db, 'user-prefs', user.uid));
      let columns: string[] = DEFAULT_FIELDS;
      if (prefsDoc.exists()) {
        const prefs = prefsDoc.data() as { columns?: string[] };
        if (prefs.columns && Array.isArray(prefs.columns) && prefs.columns.length > 0) {
          columns = prefs.columns.filter(f => DEFAULT_FIELDS.includes(f));
          // Add missing fields at the end
          columns = [...columns, ...DEFAULT_FIELDS.filter(f => !columns.includes(f))];
        }
      }
      setColumnOrder(columns);
      setRoleChecked(true);
    };

    if (!loading && user) checkRoleAndPrefs();
  }, [user, loading, db]);

  if (loading || !roleChecked) return null;

  const handleDownload = () => {
    // First row: labels in preferred order
    const headerRow = columnOrder.map((key) => FIELD_LABELS[key] || key);
    const ws = XLSX.utils.aoa_to_sheet([headerRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 overflow-hidden">
      {/* Volver */}
      <button
        onClick={() => router.push('/')}
        className="absolute top-4 left-4 z-20 bg-white/90 hover:bg-white text-blue-600 p-3 rounded-full shadow-md transition cursor-pointer"
        aria-label="Volver al inicio"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Card principal */}
      <div className="z-10 bg-white w-full max-w-md p-6 rounded-2xl shadow-xl relative">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Descargar Plantilla (Excel)</h1>

        <button
          type="button"
          onClick={handleDownload}
          className="cursor-pointer w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition"
        >
          Descargar plantilla
        </button>
      </div>
    </div>
  );
}
